// -----------------------------------------------------------------------------
// What a camera, a doorbell or a recorder is, and what each of its channels
// can do — read once per scan, then kept in the device params.
//
// Only the identity (getSystemInfo) is required: every other read is optional
// because the same CGI does not exist on every firmware (an Amcrest has no
// SmartMotionDetect, a Dahua no LeLensMask, an NVR no RTSP table…). A refused
// password, on the other hand, always stops the probe: retrying it with the
// next request would bring the camera closer to its 30-minute lockout.
// -----------------------------------------------------------------------------

import { DahuaAuthError } from './client.js';
import { indexedTable, toBool } from './kv.js';

/** Classes of the devices that record other cameras (one channel per camera). */
const RECORDER_CLASSES = new Set(['NVR', 'DVR', 'XVR', 'HCVR', 'HVR', 'IVSS', 'EVS']);
/** Classes without any camera: indoor monitors, access controllers. */
const NO_VIDEO_CLASSES = new Set(['VTH', 'VTS', 'ASC', 'ASI', 'ARC']);
const MAX_CHANNELS = 64;

/**
 * Run an optional read: a refusal of the camera or a timeout gives null, a
 * refused password goes through.
 * @param {Promise<any>} promise - The read.
 * @returns {Promise<any>} Its value, or null.
 * @example
 * const vendor = await optional(client.values('/cgi-bin/magicBox.cgi?action=getVendor'));
 */
export async function optional(promise) {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof DahuaAuthError) {
      throw error;
    }
    return null;
  }
}

/**
 * Tell whether a model is a doorbell (VTO, Amcrest AD110/AD410, Imou DB61i,
 * EmpireTech DB2X, Avaloid Goliath). The prefixes follow the rroller/dahua
 * Home Assistant integration (MIT), where they were collected from owners.
 * @param {string} model - The device type.
 * @param {string} deviceClass - The class it reports.
 * @returns {boolean} True for a doorbell.
 * @example
 * isDoorbell('AD410', 'IPC'); // true
 */
export function isDoorbell(model, deviceClass) {
  if (String(deviceClass).toUpperCase() === 'VTO') {
    return true;
  }
  const m = String(model ?? '').toUpperCase();
  return (
    /^(DHI?[-_])?VTO/.test(m) ||
    m.includes('-VTO') ||
    m.includes('_VTO') ||
    /^AD\d/.test(m) ||
    m.startsWith('DB6') ||
    m.startsWith('DB2X') ||
    m.startsWith('AV-V')
  );
}

/**
 * Tell whether a device records other cameras.
 * @param {string} model - The device type.
 * @param {string} deviceClass - The class it reports.
 * @returns {boolean} True for an NVR, a DVR…
 * @example
 * isRecorder('DHI-NVR5464-16P-EI', 'NVR'); // true
 */
export function isRecorder(model, deviceClass) {
  if (RECORDER_CLASSES.has(String(deviceClass).toUpperCase())) {
    return true;
  }
  return /^(DHI?[-_])?(NVR|DVR|XVR|HCVR|IVSS)/.test(String(model ?? '').toUpperCase());
}

/**
 * The channels to publish, 0-based.
 *
 * On a recorder, the channels with a camera enabled in `RemoteDevice` (the
 * other ones exist but show nothing); elsewhere, the video inputs.
 * @param {object} reads - `{ recorder, collect, remote }`.
 * @returns {number[]} The channel indexes.
 * @example
 * channelIndexes({ recorder: false, collect: { result: '1' } }); // [0]
 */
export function channelIndexes({ recorder, collect, remote }) {
  if (recorder && remote) {
    const enabled = new Set();
    for (const [key, value] of Object.entries(remote)) {
      // table.RemoteDevice.uuid:System_CONFIG_NETCAMERA_INFO_3.Enable=true
      const match = /INFO_(\d+)\.Enable$/.exec(key);
      if (match && toBool(value) === true && Number(match[1]) < MAX_CHANNELS) {
        enabled.add(Number(match[1]));
      }
    }
    if (enabled.size > 0) {
      return [...enabled].sort((a, b) => a - b);
    }
  }
  const count = Math.min(MAX_CHANNELS, Math.max(1, Number(collect?.result) || 1));
  return Array.from({ length: count }, (_, index) => index);
}

/**
 * The analytics rules of a channel (IVS): tripwire and intrusion.
 * @param {Record<string, string> | undefined} row - `VideoAnalyseRule[channel]` entries.
 * @returns {{ tripwire: boolean, intrusion: boolean }} What is configured.
 * @example
 * ivsRules({ '[0].Type': 'CrossLineDetection', '[0].Enable': 'true' });
 */
export function ivsRules(row) {
  const rules = { tripwire: false, intrusion: false };
  for (const [key, value] of Object.entries(row ?? {})) {
    const match = /^\[(\d+)\]\.Type$/.exec(key);
    if (!match) {
      continue;
    }
    // A rule switched off still counts: the user may switch it on in the
    // camera later, and a feature cannot be added without a new scan.
    if (value === 'CrossLineDetection') {
      rules.tripwire = true;
    } else if (value === 'CrossRegionDetection') {
      rules.intrusion = true;
    }
  }
  return rules;
}

/**
 * The PTZ abilities of a channel.
 * @param {import('./client.js').DahuaClient} client - The client.
 * @param {number} number - The channel number (1-based).
 * @returns {Promise<{ pan: boolean, tilt: boolean, zoom: boolean, presets: Array<{ index: number, name: string }> } | null>} Null without PTZ.
 * @example
 * await readPtz(client, 1);
 */
export async function readPtz(client, number) {
  const caps = await optional(
    client.values(`/cgi-bin/ptz.cgi?action=getCurrentProtocolCaps&channel=${number}`),
  );
  let ptz = null;
  if (caps && Object.keys(caps).length > 0) {
    const pan = toBool(caps['caps.Pan']) === true;
    // "Tile" is how the firmware spells tilt.
    const tilt = toBool(caps['caps.Tile'] ?? caps['caps.Tilt']) === true;
    const zoom = toBool(caps['caps.Zoom']) === true;
    if (pan || tilt || zoom) {
      ptz = { pan, tilt, zoom };
    }
  }
  if (!ptz) {
    return null;
  }
  const values = await optional(
    client.values(`/cgi-bin/ptz.cgi?action=getPresets&channel=${number}`),
  );
  const presets = indexedTable(values ?? {}, 'presets')
    .filter(Boolean)
    .map((row) => ({ index: Number(row.Index), name: String(row.Name ?? '').trim() }))
    .filter((preset) => Number.isInteger(preset.index) && preset.index > 0 && preset.index < 1000);
  return { ...ptz, presets };
}

/**
 * Identify a device and read the abilities of its channels.
 * @param {import('./client.js').DahuaClient} client - The client of the device.
 * @param {object} [hint] - What the discovery already knows (`serial`, `model`, `deviceClass`, `name`).
 * @param {object} [options] - `{ force }`: ask even after a refused password.
 * @returns {Promise<object>} The host description.
 * @example
 * const host = await probeHost(client, reply);
 */
export async function probeHost(client, hint = {}, { force = false } = {}) {
  const system = await client.values('/cgi-bin/magicBox.cgi?action=getSystemInfo', { force });
  const serial = system.serialNumber || hint.serial;
  if (!serial) {
    throw new Error(`${client.address}: no serial number in getSystemInfo`);
  }
  const model = system.deviceType || system.updateSerial || hint.model || '';
  const [classInfo, machine, software, vendorInfo, rtsp] = await Promise.all([
    optional(client.values('/cgi-bin/magicBox.cgi?action=getDeviceClass')),
    optional(client.values('/cgi-bin/magicBox.cgi?action=getMachineName')),
    optional(client.values('/cgi-bin/magicBox.cgi?action=getSoftwareVersion')),
    optional(client.values('/cgi-bin/magicBox.cgi?action=getVendor')),
    optional(client.getConfig('RTSP')),
  ]);
  const deviceClass = (classInfo?.type || hint.deviceClass || '').toUpperCase();
  const recorder = isRecorder(model, deviceClass);
  const doorbell = !recorder && isDoorbell(model, deviceClass);
  const host = {
    serial,
    model,
    deviceClass,
    vendor: vendorInfo?.vendor || hint.vendor || '',
    firmware: String(software?.version ?? '').split(',')[0],
    name: machine?.name || hint.name || model || serial,
    rtspPort: Number(rtsp?.['table.RTSP.Port']) || 554,
    recorder,
    doorbell,
    channels: [],
  };
  if (NO_VIDEO_CLASSES.has(deviceClass)) {
    return host;
  }

  const [collect, remote, titles, motion, smart, analyse, lensMask] = await Promise.all([
    optional(client.values('/cgi-bin/devVideoInput.cgi?action=getCollect')),
    recorder ? optional(client.getConfig('RemoteDevice')) : null,
    optional(client.getConfig('ChannelTitle')),
    optional(client.getConfig('MotionDetect')),
    optional(client.getConfig('SmartMotionDetect')),
    optional(client.getConfig('VideoAnalyseRule')),
    // The privacy mode of Amcrest and Imou cameras (the lens turns away).
    recorder ? null : optional(client.getConfig('LeLensMask')),
  ]);
  const titleRows = indexedTable(titles ?? {}, 'ChannelTitle');
  const motionRows = indexedTable(motion ?? {}, 'MotionDetect');
  const smartRows = indexedTable(smart ?? {}, 'SmartMotionDetect');
  const analyseRows = indexedTable(analyse ?? {}, 'VideoAnalyseRule');
  const maskRows = indexedTable(lensMask ?? {}, 'LeLensMask');

  for (const index of channelIndexes({ recorder, collect, remote })) {
    const number = index + 1;
    const title = String(titleRows[index]?.Name ?? '').trim();
    const ptz = doorbell ? null : await readPtz(client, number);
    host.channels.push({
      index,
      number,
      title,
      motionDetection: toBool(motionRows[index]?.Enable),
      smartMotion: smartRows[index] !== undefined && toBool(smartRows[index].Enable) !== null,
      ...ivsRules(analyseRows[index]),
      privacy: maskRows[index] !== undefined ? toBool(maskRows[index].Enable) : null,
      ptz,
    });
  }
  return host;
}
