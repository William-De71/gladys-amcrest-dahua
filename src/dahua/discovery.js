// -----------------------------------------------------------------------------
// DHIP discovery: the `DHDiscover.search` request of Dahua's ConfigTool.
//
// Sent in UDP to port 37810, without any password, it makes every Dahua
// device of the network answer with its serial number, model, class and HTTP
// port. Gladys broadcasts it for us (`udp-active-broadcast`: the container
// cannot reach the LAN in broadcast) and hands the raw unicast replies back.
//
// The request MUST carry the 32-byte DHIP header: bare JSON gets no answer, and
// a byte-reversed magic only makes some devices answer (measured by the
// rroller/dahua Home Assistant integration, MIT, on a VTO, an NVR and VTHs):
//
//   0..4    header size, little endian (32)
//   4..8    the ASCII bytes "DHIP"
//   8..16   session and request id, zero here
//   16..24  payload length, little endian 64 bit
//   24..32  payload length again
// -----------------------------------------------------------------------------

export const DISCOVERY_PORT = 37810;
const HEADER_SIZE = 32;

/**
 * The discovery request.
 * @returns {Buffer} The datagram (header + JSON).
 * @example
 * gladys.scanNetwork('udp-active-broadcast', { port: 37810, payload: buildProbe(), timeoutSeconds: 4 });
 */
export function buildProbe() {
  const body = Buffer.from(
    JSON.stringify({ method: 'DHDiscover.search', params: { mac: '', uni: 1 } }),
    'utf8',
  );
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32LE(HEADER_SIZE, 0);
  header.write('DHIP', 4, 'ascii');
  header.writeBigUInt64LE(BigInt(body.length), 16);
  header.writeBigUInt64LE(BigInt(body.length), 24);
  return Buffer.concat([header, body]);
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const port = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number < 65536 ? number : null;
};

/**
 * Read one reply. The JSON is searched rather than sliced at offset 32: the
 * header length varies between firmwares.
 * @param {Buffer} raw - The datagram.
 * @param {string} sourceIp - Who sent it (the reliable address).
 * @returns {object | null} `{ host, httpPort, httpsPort, serial, model, deviceClass, vendor, name, channels }`.
 * @example
 * parseReply(Buffer.from(reply.payload_base64, 'base64'), reply.source_ip);
 */
export function parseReply(raw, sourceIp) {
  if (!Buffer.isBuffer(raw) || raw.length === 0) {
    return null;
  }
  const start = raw.indexOf('{');
  if (start < 0) {
    return null;
  }
  let message;
  try {
    message = JSON.parse(raw.subarray(start).toString('utf8').replace(/\0+$/, '').trim());
  } catch {
    return null;
  }
  const info = message?.params?.deviceInfo;
  if (!info || typeof info !== 'object') {
    return null;
  }
  const serial = text(info.SerialNo);
  if (!serial) {
    return null;
  }
  const announced = text(info.IPv4Address?.IPAddress);
  return {
    // The source of the datagram is where the device answers from; the address
    // it announces may be a stale static one.
    host: text(sourceIp) || announced,
    httpPort: port(info.HttpPort) ?? 80,
    httpsPort: port(info.HttpsPort),
    serial,
    model: text(info.DeviceType),
    deviceClass: text(info.DeviceClass),
    vendor: text(info.Vendor) || text(info.Manufacturer),
    name: text(info.MachineName),
    channels: Number(info.VideoInputChannels) || Number(info.RemoteVideoInputChannels) || null,
  };
}

/**
 * Read every reply of a scan, one entry per device (a device may answer twice).
 * @param {Array<{ source_ip: string, payload_base64: string }>} replies - The raw results.
 * @returns {object[]} The devices, by serial.
 * @example
 * parseReplies(await gladys.scanNetwork('udp-active-broadcast', options));
 */
export function parseReplies(replies) {
  const bySerial = new Map();
  for (const reply of replies ?? []) {
    const device = parseReply(
      Buffer.from(String(reply?.payload_base64 ?? ''), 'base64'),
      reply?.source_ip,
    );
    if (device && !bySerial.has(device.serial)) {
      bySerial.set(device.serial, device);
    }
  }
  return [...bySerial.values()];
}
