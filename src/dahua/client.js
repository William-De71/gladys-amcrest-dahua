// -----------------------------------------------------------------------------
// Client of the Dahua CGI API (/cgi-bin/*.cgi), shared by Dahua, Amcrest,
// Lorex, Imou and the other brands built on Dahua firmware.
//
// Three things matter more than the requests themselves:
//   - the LOCKOUT: a Dahua camera blocks an account for 30 minutes after five
//     refused logins. A wrong password must therefore stop the client instead
//     of being retried on every poll (AUTH_PAUSE_MS);
//   - the NONCE RACE: several requests answered with the same challenge can be
//     refused one by one while the password is right. A 401 is only a wrong
//     password when it answers a challenge received during the same call;
//   - a few requests at a time: a camera serves its web interface, the NVR it
//     records to and Gladys with a small HTTP server.
// -----------------------------------------------------------------------------

import { send as httpSend } from './transport.js';
import { authorization, pickChallenge } from './digest.js';
import { parseKeyValues, isErrorBody } from './kv.js';

/** How long a refused password keeps the client quiet (below the 30 min lock). */
export const AUTH_PAUSE_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_IN_FLIGHT = 2;

/** The password was refused (or the account is locked by the camera). */
export class DahuaAuthError extends Error {
  /**
   * @param {string} message - What happened.
   * @param {object} [options] - `{ paused }`: refused without asking the camera.
   */
  constructor(message, { paused = false } = {}) {
    super(message);
    this.name = 'DahuaAuthError';
    this.code = 'DAHUA_AUTH';
    this.paused = paused;
  }
}

/** The camera answered, with an error status or an `Error` body. */
export class DahuaHttpError extends Error {
  /**
   * @param {number} status - The HTTP status.
   * @param {string} body - The start of the body.
   * @param {string} path - The request path (without query secrets).
   */
  constructor(status, body, path) {
    super(`HTTP ${status} on ${path}: ${String(body).trim().slice(0, 80)}`);
    this.name = 'DahuaHttpError';
    this.code = 'DAHUA_HTTP';
    this.status = status;
    this.body = body;
  }
}

/** The camera did not answer (refused, timeout, unreachable address). */
export class DahuaUnreachableError extends Error {
  /**
   * @param {string} message - What happened.
   * @param {string} [cause] - The network code.
   */
  constructor(message, cause) {
    super(message);
    this.name = 'DahuaUnreachableError';
    this.code = 'DAHUA_UNREACHABLE';
    this.networkCode = cause;
  }
}

/**
 * The client of one camera (or one NVR) and one account.
 */
export class DahuaClient {
  /**
   * @param {object} options - Where and who.
   * @param {string} options.host - The address.
   * @param {number} [options.port] - The HTTP(S) port (80 / 443 by default).
   * @param {string} [options.scheme] - `http` (default) or `https`.
   * @param {string} options.username - The user.
   * @param {string} options.password - Its password.
   * @param {Function} [options.send] - The transport (tests).
   * @param {Function} [options.now] - The clock (tests).
   * @param {number} [options.timeoutMs] - Per request.
   */
  constructor({
    host,
    port,
    scheme = 'http',
    username,
    password,
    send = httpSend,
    now = Date.now,
    timeoutMs,
  }) {
    this.host = host;
    this.scheme = scheme === 'https' ? 'https' : 'http';
    this.port = Number(port) || (this.scheme === 'https' ? 443 : 80);
    this.username = username;
    this.password = password;
    this.send = send;
    this.now = now;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.challenge = null;
    this.nc = 0;
    this.authFailedAt = null;
    this.inFlight = 0;
    this.waiting = [];
  }

  /** @returns {string} `host:port`, for the logs and the keys. */
  get address() {
    return `${this.host}:${this.port}`;
  }

  /**
   * Wait for a free slot (at most MAX_IN_FLIGHT requests at a time).
   * @returns {Promise<Function>} The release function.
   * @example
   * const release = await client.slot();
   */
  async slot() {
    if (this.inFlight >= MAX_IN_FLIGHT) {
      await new Promise((resolve) => this.waiting.push(resolve));
    }
    this.inFlight += 1;
    return () => {
      this.inFlight -= 1;
      this.waiting.shift()?.();
    };
  }

  /**
   * Build the headers of one attempt.
   * @param {string} method - The method.
   * @param {string} path - The path.
   * @returns {Record<string, string>} The headers.
   * @example
   * client.headersFor('GET', '/cgi-bin/snapshot.cgi?channel=1');
   */
  headersFor(method, path) {
    if (!this.challenge) {
      return {};
    }
    this.nc += 1;
    return {
      Authorization: authorization({
        challenge: this.challenge,
        method,
        uri: path,
        username: this.username,
        password: this.password,
        nc: this.nc,
      }),
    };
  }

  /**
   * Send a request, answering the challenge of the camera.
   * @param {string} path - `/cgi-bin/…`.
   * @param {object} [options] - `{ stream, timeoutMs, force }`; `force` asks the
   *   camera even during the pause after a refused password (the "Test the
   *   connection" button, after the user fixed it).
   * @returns {Promise<object>} The transport answer, status < 400.
   * @example
   * const answer = await client.request('/cgi-bin/magicBox.cgi?action=getSystemInfo');
   */
  async request(path, { stream = false, timeoutMs, force = false } = {}) {
    if (!force && this.authFailedAt !== null && this.now() - this.authFailedAt < AUTH_PAUSE_MS) {
      throw new DahuaAuthError(
        `${this.address}: password refused recently, waiting before trying again`,
        {
          paused: true,
        },
      );
    }
    const release = stream ? () => {} : await this.slot();
    try {
      let fresh = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let answer;
        try {
          answer = await this.send({
            scheme: this.scheme,
            host: this.host,
            port: this.port,
            method: 'GET',
            path,
            headers: this.headersFor('GET', path),
            timeoutMs: timeoutMs ?? this.timeoutMs,
            stream,
          });
        } catch (error) {
          throw new DahuaUnreachableError(`${this.address}: ${error.message}`, error.code);
        }
        if (answer.status !== 401) {
          if (answer.status >= 400) {
            throw new DahuaHttpError(
              answer.status,
              answer.body?.toString('utf8') ?? '',
              path.split('?')[0],
            );
          }
          this.authFailedAt = null;
          return answer;
        }
        // A 401 answering a challenge received during this very call is a
        // refused password; any other one is a stale or raced nonce.
        if (fresh) {
          break;
        }
        const challenge = pickChallenge(answer.challenges ?? answer.headers?.['www-authenticate']);
        if (!challenge) {
          break;
        }
        this.challenge = challenge;
        this.nc = 0;
        fresh = true;
      }
      this.authFailedAt = this.now();
      // The next attempt starts without credentials: answering a remembered
      // challenge with a wrong password would cost a second failed login.
      this.challenge = null;
      throw new DahuaAuthError(`${this.address}: user "${this.username}" refused`);
    } finally {
      release();
    }
  }

  /**
   * GET a text answer, refusals turned into errors.
   * @param {string} path - `/cgi-bin/…`.
   * @param {object} [options] - See request().
   * @returns {Promise<string>} The body.
   * @example
   * await client.text('/cgi-bin/magicBox.cgi?action=getDeviceType');
   */
  async text(path, options) {
    const answer = await this.request(path, options);
    const body = answer.body.toString('utf8');
    if (isErrorBody(body)) {
      throw new DahuaHttpError(answer.status, body, path.split('?')[0]);
    }
    return body;
  }

  /**
   * GET a `key=value` answer.
   * @param {string} path - `/cgi-bin/…`.
   * @param {object} [options] - See request().
   * @returns {Promise<Record<string, string>>} The values.
   * @example
   * const info = await client.values('/cgi-bin/magicBox.cgi?action=getSystemInfo');
   */
  async values(path, options) {
    return parseKeyValues(await this.text(path, options));
  }

  /**
   * Read a configuration table.
   * @param {string} name - `MotionDetect`, `ChannelTitle`…
   * @param {object} [options] - See request().
   * @returns {Promise<Record<string, string>>} The values (`table.<name>…` keys).
   * @example
   * await client.getConfig('MotionDetect');
   */
  async getConfig(name, options) {
    return this.values(
      `/cgi-bin/configManager.cgi?action=getConfig&name=${encodeURIComponent(name)}`,
      options,
    );
  }

  /**
   * Write configuration values.
   * @param {Record<string, string | number | boolean>} entries - `{ 'MotionDetect[0].Enable': true }`.
   * @returns {Promise<void>} Resolves on `OK`.
   * @example
   * await client.setConfig({ 'LeLensMask[0].Enable': false });
   */
  async setConfig(entries) {
    const query = Object.entries(entries)
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
      .join('&');
    await this.command(`/cgi-bin/configManager.cgi?action=setConfig&${query}`);
  }

  /**
   * Send a command that answers `OK`.
   * @param {string} path - `/cgi-bin/…`.
   * @returns {Promise<void>} Resolves on `OK`.
   * @example
   * await client.command('/cgi-bin/ptz.cgi?action=stop&channel=1&code=Left&arg1=0&arg2=4&arg3=0');
   */
  async command(path) {
    const body = await this.text(path);
    if (!/^\s*OK\b/i.test(body)) {
      throw new DahuaHttpError(200, body, path.split('?')[0]);
    }
  }

  /**
   * GET binary data (a snapshot).
   * @param {string} path - `/cgi-bin/…`.
   * @param {object} [options] - See request().
   * @returns {Promise<Buffer>} The bytes.
   * @example
   * await client.bytes('/cgi-bin/snapshot.cgi?channel=1');
   */
  async bytes(path, options) {
    const answer = await this.request(path, options);
    if (isErrorBody(answer.body.subarray(0, 16).toString('latin1'))) {
      throw new DahuaHttpError(answer.status, answer.body.toString('utf8'), path.split('?')[0]);
    }
    return answer.body;
  }
}

/**
 * One client per camera address and account, kept across requests so the
 * challenge and the refused-password pause survive between polls.
 */
export class ClientPool {
  /**
   * @param {object} [options] - `{ send, now }` for the tests.
   */
  constructor(options = {}) {
    this.options = options;
    this.clients = new Map();
  }

  /**
   * The client of an address.
   * @param {object} target - `{ host, port, scheme, username, password }`.
   * @returns {DahuaClient} The client.
   * @example
   * pool.get({ host: '192.168.1.108', port: 80, scheme: 'http', username: 'admin', password: 'x' });
   */
  get(target) {
    const key = [target.scheme, target.host, target.port, target.username, target.password].join(
      '\u0000',
    );
    let client = this.clients.get(key);
    if (!client) {
      client = new DahuaClient({ ...target, ...this.options });
      this.clients.set(key, client);
    }
    return client;
  }

  /** Forget every client (credentials changed). */
  clear() {
    this.clients.clear();
  }
}
