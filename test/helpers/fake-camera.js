// -----------------------------------------------------------------------------
// A fake network of Dahua devices, behind the transport contract of
// src/dahua/transport.js (`send(request)`), so the tests never touch the
// network. It follows the documented CGI behaviour: Digest challenge on every
// request, `key=value` answers, `Error` bodies with a 400 for an unknown
// table, `OK` for writes, the multipart event stream with heartbeats, and the
// `dhav` trailer some devices append to their snapshots.
//
// scripts/lab-camera.mjs serves the same fake over real HTTP for a manual
// end-to-end check of the real transport.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseChallenge, verifyDigest } from '../../src/dahua/digest.js';

/** A real (tiny) JPEG, so the image validators of the SDK can read its header. */
const FRAME = readFileSync(new URL('../fixtures/frame.jpg', import.meta.url));

/**
 * A real JPEG of a given size: the tiny frame, padded with comment segments
 * (the size is what the code checks: the 150 KB of Gladys, the re-encoding).
 * @param {number} size - Total bytes (at least the frame).
 * @param {boolean} [trailer] - Append a `dhav` block after the end marker.
 * @returns {Buffer} The bytes.
 */
export function fakeJpeg(size = 20_000, trailer = false) {
  const segments = [];
  let missing = Math.max(0, size - FRAME.length);
  while (missing > 0) {
    // A COM segment: FF FE + 2-byte length (itself included) + payload.
    const payload = Math.min(65533, Math.max(0, missing - 4));
    const segment = Buffer.alloc(4 + payload, 0x20);
    segment.writeUInt16BE(0xfffe, 0);
    segment.writeUInt16BE(payload + 2, 2);
    segments.push(segment);
    missing -= segment.length;
  }
  const jpeg = Buffer.concat([FRAME.subarray(0, 2), ...segments, FRAME.subarray(2)]);
  return trailer ? Buffer.concat([jpeg, Buffer.from('dhav\x01\x02\x03\x04', 'latin1')]) : jpeg;
}

/**
 * One fake device.
 * @param {object} [options] - What it is.
 * @returns {object} The device: `handle(request)`, `emit(body)`, `state`.
 */
export function createFakeDevice(options = {}) {
  const device = {
    serial: options.serial ?? '4X7C5A1ZAG21L3F',
    model: options.model ?? 'IPC-HDW5442TM-AS',
    deviceClass: options.deviceClass ?? 'IPC',
    vendor: options.vendor ?? 'Dahua',
    name: options.name ?? 'IPC',
    username: options.username ?? 'admin',
    password: options.password ?? 'secret',
    realm: options.realm ?? 'Login to 4X7C5A1ZAG21L3F',
    channels: options.channels ?? 1,
    ptz: options.ptz ?? null,
    presets: options.presets ?? [],
    snapshotSize: options.snapshotSize ?? 20_000,
    snapshotTrailer: options.snapshotTrailer ?? false,
    noClass: options.noClass ?? false,
    config: structuredClone(
      options.config ?? {
        RTSP: { 'RTSP.Port': '554', 'RTSP.Enable': 'true' },
        ChannelTitle: { 'ChannelTitle[0].Name': 'Gate' },
        MotionDetect: { 'MotionDetect[0].Enable': 'true', 'MotionDetect[0].Level': '3' },
      },
    ),
    storage: options.storage ?? null,
    nonce: randomBytes(8).toString('hex'),
    requests: [],
    commands: [],
    authFailures: 0,
    streams: new Set(),
  };

  const text = (status, body) => ({
    status,
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    challenges: [],
    body: Buffer.from(body, 'utf8'),
  });
  const ok = () => text(200, 'OK\r\n');
  const bad = () => text(400, 'Error\r\nBad Request!\r\n');
  const lines = (entries) =>
    text(
      200,
      `${Object.entries(entries)
        .map(([key, value]) => `${key}=${value}`)
        .join('\r\n')}\r\n`,
    );

  /**
   * Answer the challenge part: 401 without or with a wrong Authorization.
   * @param {object} request - The request.
   * @returns {object | null} The 401 answer, or null when authenticated.
   */
  function authenticate(request) {
    const header = request.headers?.Authorization;
    if (
      header &&
      verifyDigest({
        header,
        method: request.method,
        realm: device.realm,
        nonce: device.nonce,
        username: device.username,
        password: device.password,
      })
    ) {
      return null;
    }
    if (header && parseChallenge(header)?.params.nonce === device.nonce) {
      device.authFailures += 1;
    }
    return {
      status: 401,
      headers: {},
      challenges: [
        `Digest realm="${device.realm}", qop="auth", nonce="${device.nonce}", opaque="5ccc069c403ebaf9f0171e9517f40e41"`,
      ],
      body: Buffer.from('Unauthorized'),
    };
  }

  /**
   * Open an event stream.
   * @returns {object} The streaming answer.
   */
  function openStream() {
    const queue = [];
    let wake = null;
    let closed = false;
    const stream = {
      push(chunk) {
        queue.push(Buffer.from(chunk, 'utf8'));
        wake?.();
      },
      close() {
        closed = true;
        wake?.();
      },
    };
    device.streams.add(stream);
    const chunks = {
      async *[Symbol.asyncIterator]() {
        while (!closed) {
          if (queue.length === 0) {
            await new Promise((resolve) => (wake = resolve));
            wake = null;
            continue;
          }
          yield queue.shift();
        }
      },
    };
    return {
      status: 200,
      headers: { 'content-type': 'multipart/x-mixed-replace; boundary=myboundary' },
      challenges: [],
      chunks,
      close: () => {
        stream.close();
        device.streams.delete(stream);
      },
    };
  }

  /**
   * Answer one request.
   * @param {object} request - What the transport sends.
   * @returns {object} The answer.
   */
  device.handle = (request) => {
    device.requests.push(request.path);
    const denied = authenticate(request);
    if (denied) {
      return denied;
    }
    const url = new URL(request.path, 'http://camera');
    const query = Object.fromEntries(url.searchParams);
    const action = query.action;
    switch (url.pathname) {
      case '/cgi-bin/magicBox.cgi':
        if (action === 'getSystemInfo') {
          return lines({
            deviceType: device.model,
            serialNumber: device.serial,
            processor: 'S3LM',
          });
        }
        if (action === 'getDeviceClass') {
          return device.noClass ? bad() : lines({ type: device.deviceClass });
        }
        if (action === 'getMachineName') return lines({ name: device.name });
        if (action === 'getSoftwareVersion') {
          return lines({ version: '2.800.0000000.17.R,build:2024-03-01' });
        }
        if (action === 'getVendor') return lines({ vendor: device.vendor });
        if (action === 'reboot') {
          device.commands.push('reboot');
          return ok();
        }
        return bad();
      case '/cgi-bin/configManager.cgi': {
        if (action === 'getConfig') {
          const table = device.config[query.name];
          if (!table) return bad();
          return lines(
            Object.fromEntries(Object.entries(table).map(([k, v]) => [`table.${k}`, v])),
          );
        }
        if (action === 'setConfig') {
          for (const [key, value] of Object.entries(query)) {
            if (key === 'action') continue;
            const name = key.split(/[[.]/)[0];
            device.config[name] = device.config[name] ?? {};
            device.config[name][key] = value;
            device.commands.push(`set ${key}=${value}`);
          }
          return ok();
        }
        return bad();
      }
      case '/cgi-bin/devVideoInput.cgi':
        return action === 'getCollect' ? lines({ result: device.channels }) : bad();
      case '/cgi-bin/ptz.cgi':
        if (!device.ptz) return bad();
        if (action === 'getCurrentProtocolCaps') {
          return lines({
            'caps.Pan': String(device.ptz.pan),
            'caps.Tile': String(device.ptz.tilt),
            'caps.Zoom': String(device.ptz.zoom),
            'caps.Preset': 'true',
          });
        }
        if (action === 'getPresets') {
          const entries = {};
          device.presets.forEach((preset, index) => {
            entries[`presets[${index}].Index`] = preset.index;
            entries[`presets[${index}].Name`] = preset.name;
          });
          return lines(entries);
        }
        if (action === 'start' || action === 'stop') {
          device.commands.push(`ptz ${action} ${query.code} ${query.arg2} ch${query.channel}`);
          return ok();
        }
        return bad();
      case '/cgi-bin/snapshot.cgi':
        if (Number(query.channel) < 1 || Number(query.channel) > device.channels) return bad();
        return {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
          challenges: [],
          body: fakeJpeg(device.snapshotSize, device.snapshotTrailer),
        };
      case '/cgi-bin/eventManager.cgi':
        return action === 'attach' ? openStream() : bad();
      case '/cgi-bin/storageDevice.cgi':
        if (action !== 'getDeviceAllInfo' || !device.storage) return bad();
        return lines(device.storage);
      case '/cgi-bin/accessControl.cgi':
        if (action === 'openDoor' && device.deviceClass === 'VTO') {
          device.commands.push(`open door ${query.channel}`);
          return ok();
        }
        return bad();
      default:
        return text(404, 'Not Found');
    }
  };

  /**
   * Push one event on every open stream, as the camera does.
   * @param {string} body - `Code=…;action=…;index=…`.
   * @param {object} [options] - `{ split }`: cut the part in two chunks.
   */
  device.emit = (body, { split = false } = {}) => {
    const part = `--myboundary\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(
      body,
    )}\r\n\r\n${body}\r\n\r\n`;
    for (const stream of device.streams) {
      if (split) {
        const middle = Math.floor(part.length / 2);
        stream.push(part.slice(0, middle));
        stream.push(part.slice(middle));
      } else {
        stream.push(part);
      }
    }
  };

  /** Heartbeat on every stream. */
  device.heartbeat = () => device.emit('Heartbeat');

  /** Cut every stream (power cut). */
  device.drop = () => {
    for (const stream of device.streams) stream.close();
    device.streams.clear();
  };

  return device;
}

/**
 * A fake network: `send` dispatches by address, an unknown one is refused.
 * @param {Record<string, object>} devices - `{ '192.168.1.108': device }` or with `:port`.
 * @returns {{ send: Function, devices: Record<string, object>, down: Set<string> }} The network.
 */
export function createFakeNetwork(devices) {
  const down = new Set();
  return {
    devices,
    down,
    send: async (request) => {
      const key = devices[`${request.host}:${request.port}`]
        ? `${request.host}:${request.port}`
        : request.port === 80
          ? request.host
          : null;
      const device = key ? devices[key] : null;
      if (!device || down.has(request.host)) {
        throw Object.assign(new Error(`connect ECONNREFUSED ${request.host}:${request.port}`), {
          code: 'ECONNREFUSED',
        });
      }
      return device.handle(request);
    },
  };
}

/**
 * A DHIP reply, as Gladys relays it.
 * @param {object} device - The fake device.
 * @param {string} ip - Its address.
 * @param {number} [httpPort] - Its HTTP port.
 * @returns {{ source_ip: string, source_port: number, payload_base64: string }} The raw result.
 */
export function dhipReply(device, ip, httpPort = 80) {
  const body = JSON.stringify({
    mac: '3c:ef:8c:00:00:01',
    method: 'client.notifyDevInfo',
    params: {
      deviceInfo: {
        DeviceClass: device.deviceClass,
        DeviceType: device.model,
        HttpPort: httpPort,
        IPv4Address: { IPAddress: ip, SubnetMask: '255.255.255.0', DhcpEnable: true },
        MachineName: device.name,
        SerialNo: device.serial,
        Vendor: device.vendor,
        VideoInputChannels: device.channels,
      },
    },
  });
  const header = Buffer.alloc(32);
  header.writeUInt32LE(32, 0);
  header.write('DHIP', 4, 'ascii');
  header.writeBigUInt64LE(BigInt(body.length), 16);
  header.writeBigUInt64LE(BigInt(body.length), 24);
  return {
    source_ip: ip,
    source_port: 37810,
    payload_base64: Buffer.concat([header, Buffer.from(body)]).toString('base64'),
  };
}
