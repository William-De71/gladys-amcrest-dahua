// -----------------------------------------------------------------------------
// HTTP authentication of the Dahua CGI API (RFC 7616 Digest, Basic fallback).
//
// Current Dahua and Amcrest firmwares answer every /cgi-bin/ request with a
// `401` and a `WWW-Authenticate: Digest realm=…, qop="auth", nonce=…` header;
// older ones accept Basic. Pure functions only: the client (client.js) keeps
// the last challenge per camera and counts the requests made with its nonce.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

/**
 * Split an authentication header into its scheme and parameters.
 * @param {string} header - The `WWW-Authenticate` value.
 * @returns {{ scheme: string, params: Record<string, string> } | null} The challenge.
 * @example
 * parseChallenge('Digest realm="Login to 4L0", qop="auth", nonce="123"');
 */
export function parseChallenge(header) {
  const text = String(header ?? '').trim();
  const match = /^(\w+)\s*(.*)$/s.exec(text);
  if (!match) {
    return null;
  }
  const params = {};
  const pattern = /([\w-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
  let found;
  while ((found = pattern.exec(match[2])) !== null) {
    params[found[1].toLowerCase()] =
      found[2] !== undefined ? found[2].replace(/\\(.)/g, '$1') : found[3];
  }
  return { scheme: match[1].toLowerCase(), params };
}

/**
 * Pick the challenge to answer among several `WWW-Authenticate` headers.
 *
 * Digest wins over Basic: a camera that offers both expects the stronger one,
 * and Basic would send the password readable on the network.
 * @param {string | string[]} headers - One header or several.
 * @returns {{ scheme: string, params: Record<string, string> } | null} The challenge.
 * @example
 * pickChallenge(['Basic realm="x"', 'Digest realm="x", nonce="1"']);
 */
export function pickChallenge(headers) {
  const list = (Array.isArray(headers) ? headers : [headers]).map(parseChallenge).filter(Boolean);
  return (
    list.find((entry) => entry.scheme === 'digest') ??
    list.find((entry) => entry.scheme === 'basic') ??
    null
  );
}

const HASHES = { md5: 'md5', 'sha-256': 'sha256' };

/**
 * Hash a string with the algorithm of the challenge.
 * @param {string} algorithm - `MD5` or `SHA-256` (with or without `-sess`).
 * @param {string} text - The text.
 * @returns {string} The lowercase hex digest.
 * @example
 * hash('MD5', 'admin:realm:password');
 */
function hash(algorithm, text) {
  const name =
    HASHES[
      String(algorithm || 'MD5')
        .toLowerCase()
        .replace(/-sess$/, '')
    ] ?? 'md5';
  return createHash(name).update(text, 'utf8').digest('hex');
}

/**
 * Build the `Authorization` header answering a challenge.
 * @param {object} options - The request and the account.
 * @param {{ scheme: string, params: Record<string, string> }} options.challenge - The challenge.
 * @param {string} options.method - The HTTP method.
 * @param {string} options.uri - The path and query of the request.
 * @param {string} options.username - The user.
 * @param {string} options.password - Its password.
 * @param {number} [options.nc] - The request counter for this nonce (starts at 1).
 * @param {string} [options.cnonce] - The client nonce (random when absent).
 * @returns {string} The header value.
 * @example
 * authorization({ challenge, method: 'GET', uri: '/cgi-bin/snapshot.cgi', username, password, nc: 1 });
 */
export function authorization({ challenge, method, uri, username, password, nc = 1, cnonce }) {
  if (challenge.scheme === 'basic') {
    return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
  }
  const { realm = '', nonce = '', opaque, algorithm } = challenge.params;
  // A challenge may offer several qop values: "auth" is the one Dahua uses,
  // "auth-int" would need a hash of the body we do not send.
  const qops = String(challenge.params.qop ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const qop = qops.includes('auth') ? 'auth' : null;
  const clientNonce = cnonce ?? randomBytes(8).toString('hex');
  const count = nc.toString(16).padStart(8, '0');
  let ha1 = hash(algorithm, `${username}:${realm}:${password}`);
  if (/-sess$/i.test(algorithm ?? '')) {
    ha1 = hash(algorithm, `${ha1}:${nonce}:${clientNonce}`);
  }
  const ha2 = hash(algorithm, `${method}:${uri}`);
  const response = qop
    ? hash(algorithm, `${ha1}:${nonce}:${count}:${clientNonce}:${qop}:${ha2}`)
    : hash(algorithm, `${ha1}:${nonce}:${ha2}`);
  const quote = (value) => `"${String(value).replace(/(["\\])/g, '\\$1')}"`;
  const parts = [
    `username=${quote(username)}`,
    `realm=${quote(realm)}`,
    `nonce=${quote(nonce)}`,
    `uri=${quote(uri)}`,
    `response=${quote(response)}`,
  ];
  if (algorithm) {
    parts.push(`algorithm=${algorithm}`);
  }
  if (opaque !== undefined) {
    parts.push(`opaque=${quote(opaque)}`);
  }
  if (qop) {
    parts.push(`qop=${qop}`, `nc=${count}`, `cnonce=${quote(clientNonce)}`);
  }
  return `Digest ${parts.join(', ')}`;
}

/**
 * Check an `Authorization` header against an account (used by the fake camera
 * of the tests and of the lab, so both sides of the exchange are exercised).
 * @param {object} options - What the camera knows.
 * @param {string} options.header - The `Authorization` value received.
 * @param {string} options.method - The HTTP method.
 * @param {string} options.realm - The realm of the camera.
 * @param {string} options.nonce - The nonce it issued.
 * @param {string} options.username - The expected user.
 * @param {string} options.password - Its password.
 * @returns {boolean} True when the header proves the password.
 * @example
 * verifyDigest({ header, method: 'GET', realm, nonce, username, password });
 */
export function verifyDigest({ header, method, realm, nonce, username, password }) {
  const parsed = parseChallenge(header);
  if (!parsed || parsed.scheme !== 'digest') {
    return false;
  }
  const p = parsed.params;
  if (p.username !== username || p.realm !== realm || p.nonce !== nonce || !p.uri) {
    return false;
  }
  const expected = authorization({
    challenge: { scheme: 'digest', params: { realm, nonce, qop: p.qop, algorithm: p.algorithm } },
    method,
    uri: p.uri,
    username,
    password,
    nc: p.nc ? parseInt(p.nc, 16) : 1,
    cnonce: p.cnonce,
  });
  return parseChallenge(expected).params.response === p.response;
}
