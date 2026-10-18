// -----------------------------------------------------------------------------
// The event stream of a camera or a recorder (eventManager.cgi?action=attach).
//
// One long HTTP request per address: the device answers in
// `multipart/x-mixed-replace`, one part per event —
//
//   --myboundary
//   Content-Type: text/plain
//   Content-Length: 36
//
//   Code=VideoMotion;action=Start;index=0
//
// — plus a `Heartbeat` part every `heartbeat` seconds, which is what tells a
// silent but healthy stream from a dead socket. Some events carry a JSON
// payload after `;data=`, over several lines (the IVS rule name, the object
// type, the call state of a doorbell). `index` is the 0-based channel.
// -----------------------------------------------------------------------------

import { logger as sdkLogger } from '@gladysassistant/integration-sdk';

/** The codes asked for: everything the integration turns into a state or an event. */
export const EVENT_CODES = [
  'VideoMotion',
  'SmartMotionHuman',
  'SmartMotionVehicle',
  'CrossLineDetection',
  'CrossRegionDetection',
  'AudioMutation',
  'AudioAnomaly',
  'VideoBlind',
  'VideoLoss',
  'AlarmLocal',
  'StorageFailure',
  'StorageLowSpace',
  'StorageNotExist',
  'BackKeyLight',
  'PhoneCallDetect',
];
export const HEARTBEAT_SECONDS = 5;
/** Without any part (a heartbeat comes every 5 s) the socket is considered dead. */
export const STREAM_IDLE_MS = 30_000;
const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
/** A stream that lived this long resets the backoff. */
const HEALTHY_MS = 60_000;
const MAX_BUFFER = 256 * 1024;

/**
 * The path of the subscription.
 * @returns {string} `/cgi-bin/eventManager.cgi?action=attach&codes=[…]&heartbeat=5`.
 * @example
 * client.request(attachPath(), { stream: true });
 */
export function attachPath() {
  return `/cgi-bin/eventManager.cgi?action=attach&codes=[${EVENT_CODES.join(',')}]&heartbeat=${HEARTBEAT_SECONDS}`;
}

/**
 * Parse the body of one event.
 * @param {string} body - `Code=…;action=…;index=…[;data={…}]`.
 * @returns {{ code: string, action: string, index: number, data: object } | null} The event.
 * @example
 * parseEvent('Code=VideoMotion;action=Start;index=0');
 */
export function parseEvent(body) {
  const text = String(body ?? '').trim();
  if (!text.startsWith('Code=')) {
    return null;
  }
  const dataAt = text.search(/;\s*data=/i);
  const head = dataAt >= 0 ? text.slice(0, dataAt) : text;
  const fields = {};
  for (const part of head.split(';')) {
    const at = part.indexOf('=');
    if (at > 0) {
      fields[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
    }
  }
  let data = {};
  if (dataAt >= 0) {
    const raw = text.slice(text.indexOf('=', dataAt) + 1).trim();
    try {
      const parsed = JSON.parse(raw);
      data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      // A truncated payload must not lose the event itself.
      data = {};
    }
  }
  if (!fields.code) {
    return null;
  }
  const index = Number.parseInt(fields.index ?? '0', 10);
  return {
    code: fields.code,
    action: fields.action ?? '',
    index: Number.isInteger(index) && index >= 0 ? index : 0,
    data,
  };
}

/**
 * Split the body of a part into its events (some firmwares put several in one).
 * @param {string} body - The part body.
 * @returns {object[]} The events.
 * @example
 * parsePartBody('Code=A;action=Start;index=0\r\nCode=B;action=Stop;index=0');
 */
export function parsePartBody(body) {
  return String(body ?? '')
    .split(/\r?\n(?=Code=)/)
    .map(parseEvent)
    .filter(Boolean);
}

/**
 * Reassembles the multipart stream: TCP chunks cut parts anywhere, a boundary
 * included.
 */
export class MultipartParser {
  /**
   * @param {string} [boundary] - The boundary of the Content-Type, without `--`.
   */
  constructor(boundary = 'myboundary') {
    this.marker = Buffer.from(`--${boundary}`, 'latin1');
    // Bytes, not text: Content-Length counts bytes, and a TCP chunk may end in
    // the middle of a multi-byte character.
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Add a chunk.
   * @param {Buffer | string} chunk - What arrived.
   * @returns {{ events: object[], heartbeats: number }} What it completed.
   * @example
   * parser.push(chunk);
   */
  push(chunk) {
    this.buffer = Buffer.concat([
      this.buffer,
      typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk,
    ]);
    let events = [];
    let heartbeats = 0;
    for (;;) {
      const first = this.buffer.indexOf(this.marker);
      if (first < 0) {
        break;
      }
      const start = first + this.marker.length;
      const next = this.buffer.indexOf(this.marker, start);
      if (next < 0) {
        // The last part may be complete already: its Content-Length tells.
        const complete = completeByLength(this.buffer.subarray(start));
        if (complete === null) {
          break;
        }
        this.buffer = this.buffer.subarray(start + complete.length);
        ({ events, heartbeats } = collect(complete.body, events, heartbeats));
        continue;
      }
      const part = this.buffer.subarray(start, next).toString('utf8');
      this.buffer = this.buffer.subarray(next);
      ({ events, heartbeats } = collect(bodyOf(part), events, heartbeats));
    }
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer = this.buffer.subarray(-4096);
    }
    return { events, heartbeats };
  }
}

/**
 * The body of a part: what follows the blank line after its headers.
 * @param {string} part - The part, boundary excluded.
 * @returns {string} The body.
 * @example
 * bodyOf('\r\nContent-Type: text/plain\r\n\r\nHeartbeat\r\n');
 */
function bodyOf(part) {
  const text = part.replace(/^\r?\n/, '');
  // Without headers (seen on old firmwares) the whole part is the body.
  if (!/^[\w-]+:\s?/.test(text)) {
    return text.trim();
  }
  const at = text.search(/\r?\n\r?\n/);
  return at < 0 ? '' : text.slice(at).trim();
}

/**
 * Cut a part by its Content-Length, when all of it arrived.
 * @param {Buffer} part - What follows the boundary.
 * @returns {{ body: string, length: number } | null} The body and the bytes consumed.
 * @example
 * completeByLength(Buffer.from('\r\nContent-Length: 9\r\n\r\nHeartbeat'));
 */
function completeByLength(part) {
  const head = part.toString('latin1');
  const match = /^(\r?\n)?([\s\S]*?)\r?\n\r?\n/.exec(head);
  if (!match) {
    return null;
  }
  const length = /content-length:\s*(\d+)/i.exec(match[2]);
  if (!length) {
    return null;
  }
  // latin1 maps one byte to one character: the offset is a byte offset.
  const offset = match[0].length;
  const wanted = Number(length[1]);
  if (part.length < offset + wanted) {
    return null;
  }
  return {
    body: part
      .subarray(offset, offset + wanted)
      .toString('utf8')
      .trim(),
    length: offset + wanted,
  };
}

/**
 * Add the content of one body to the results.
 * @param {string} body - The body.
 * @param {object[]} events - The events so far.
 * @param {number} heartbeats - The heartbeats so far.
 * @returns {{ events: object[], heartbeats: number }} The results.
 * @example
 * collect('Heartbeat', [], 0);
 */
function collect(body, events, heartbeats) {
  if (/^heartbeat$/i.test(body)) {
    return { events, heartbeats: heartbeats + 1 };
  }
  return { events: [...events, ...parsePartBody(body)], heartbeats };
}

/**
 * The subscription of one address, kept open for life: reconnected with a
 * backoff, restarted when no part arrives for STREAM_IDLE_MS.
 */
export class EventStream {
  /**
   * @param {object} options - What to watch and whom to tell.
   * @param {import('./client.js').DahuaClient} options.client - The client of the address.
   * @param {Function} options.onEvent - `(event) => void`.
   * @param {Function} [options.onStatus] - `(connected, error?) => void`, on changes only.
   * @param {Function} [options.sleep] - The wait (tests).
   * @param {object} [options.logger] - The logger.
   */
  constructor({ client, onEvent, onStatus = () => {}, sleep, logger = sdkLogger }) {
    this.client = client;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.logger = logger;
    this.stopped = false;
    this.connected = null;
    this.answer = null;
    this.timer = null;
    this.wake = null;
    this.sleep =
      sleep ??
      ((ms) =>
        new Promise((resolve) => {
          this.timer = setTimeout(resolve, ms);
          this.wake = resolve;
        }));
  }

  /**
   * Report a change of connection.
   * @param {boolean} connected - Whether events flow.
   * @param {Error} [error] - Why not.
   */
  setConnected(connected, error) {
    if (this.connected !== connected) {
      this.connected = connected;
      this.onStatus(connected, error);
    }
  }

  /**
   * Run until stop(): connect, read, reconnect.
   * @returns {Promise<void>} Resolves once stopped.
   * @example
   * stream.start();
   */
  async start() {
    let backoff = BACKOFF_MIN_MS;
    while (!this.stopped) {
      const startedAt = Date.now();
      try {
        await this.readOnce();
        throw new Error('stream closed by the device');
      } catch (error) {
        if (this.stopped) {
          break;
        }
        this.setConnected(false, error);
        this.logger.debug(`Event stream of ${this.client.address}: ${error.message}`);
      }
      backoff =
        Date.now() - startedAt > HEALTHY_MS
          ? BACKOFF_MIN_MS
          : Math.min(backoff * 2, BACKOFF_MAX_MS);
      await this.sleep(backoff);
    }
  }

  /**
   * One subscription, until it ends.
   * @returns {Promise<void>} Resolves when the device closes it.
   */
  async readOnce() {
    const answer = await this.client.request(attachPath(), {
      stream: true,
      timeoutMs: STREAM_IDLE_MS,
    });
    this.answer = answer;
    try {
      const type = String(answer.headers?.['content-type'] ?? '');
      const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1] ?? 'myboundary';
      const parser = new MultipartParser(boundary.replace(/^--/, ''));
      this.setConnected(true);
      for await (const chunk of answer.chunks) {
        if (this.stopped) {
          return;
        }
        const { events } = parser.push(chunk);
        for (const event of events) {
          try {
            this.onEvent(event);
          } catch (error) {
            this.logger.warn(
              `Event ${event.code} of ${this.client.address} not handled: ${error.message}`,
            );
          }
        }
      }
    } finally {
      this.answer = null;
      answer.close?.();
    }
  }

  /** Stop for good. */
  stop() {
    this.stopped = true;
    this.answer?.close?.();
    clearTimeout(this.timer);
    this.wake?.();
  }
}
