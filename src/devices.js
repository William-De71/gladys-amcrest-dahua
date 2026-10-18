// -----------------------------------------------------------------------------
// Probed hosts -> Gladys devices: one device per camera, i.e. one per channel
// (a camera or a doorbell has one, a recorder one per camera it records).
//
// Everything needed to reach the camera again lives in the device params
// (address, port, scheme, channel, abilities), so a poll, an image or a
// command never waits for a scan.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { CAMERA_MOVE } from './dahua/commands.js';
import { STREAMS } from './config.js';

/** The external id type of a camera. */
export const DEVICE_TYPE = 'camera';

/** Feature keys: part of the external ids, forever. */
export const FEATURES = {
  IMAGE: 'image',
  MOTION: 'motion',
  PERSON: 'person',
  VEHICLE: 'vehicle',
  TRIPWIRE: 'tripwire',
  INTRUSION: 'intrusion',
  DOORBELL: 'doorbell',
  MOTION_DETECTION: 'motion-detection',
  ENABLED: 'enabled',
  PTZ_MOVE: 'ptz-move',
  PTZ_PRESET: 'ptz-preset',
};

/** Device params: names forever too (scenes and the live view read them). */
export const PARAMS = {
  CAMERA_URL: 'CAMERA_URL',
  CAMERA_ROTATION: 'CAMERA_ROTATION',
  HOST: 'DAHUA_HOST',
  PORT: 'DAHUA_PORT',
  SCHEME: 'DAHUA_SCHEME',
  CHANNEL: 'DAHUA_CHANNEL',
  SERIAL: 'DAHUA_SERIAL',
  MODEL: 'DAHUA_MODEL',
  KIND: 'DAHUA_KIND',
  CAPABILITIES: 'DAHUA_CAPABILITIES',
};

/** What a channel can do, stored in `DAHUA_CAPABILITIES`. */
export const CAPABILITIES = {
  SMART_MOTION: 'smart-motion',
  TRIPWIRE: 'tripwire',
  INTRUSION: 'intrusion',
  DOORBELL: 'doorbell',
  MOTION_DETECTION: 'motion-detection',
  PRIVACY: 'privacy',
  PAN: 'pan',
  TILT: 'tilt',
  ZOOM: 'zoom',
  PRESETS: 'presets',
};

export const KINDS = { CAMERA: 'camera', DOORBELL: 'doorbell', RECORDER: 'recorder' };

const MOVE_LABELS = {
  [CAMERA_MOVE.PAN_LEFT]: 'Pan left',
  [CAMERA_MOVE.PAN_RIGHT]: 'Pan right',
  [CAMERA_MOVE.TILT_UP]: 'Tilt up',
  [CAMERA_MOVE.TILT_DOWN]: 'Tilt down',
  [CAMERA_MOVE.ZOOM_IN]: 'Zoom in',
  [CAMERA_MOVE.ZOOM_OUT]: 'Zoom out',
};

/**
 * The platform id of a channel: the serial of the device, plus the channel on
 * a recorder (its cameras share the serial).
 * @param {object} host - The probed host.
 * @param {object} channel - One of its channels.
 * @returns {string} The id.
 * @example
 * platformId({ serial: 'ABC', recorder: false, channels: [{}] }, { number: 1 }); // 'ABC'
 */
export function platformId(host, channel) {
  return host.recorder || host.channels.length > 1
    ? `${host.serial}-ch${channel.number}`
    : host.serial;
}

/**
 * The capabilities of a channel.
 * @param {object} host - The probed host.
 * @param {object} channel - The channel.
 * @returns {string[]} CAPABILITIES values.
 * @example
 * capabilitiesOf(host, host.channels[0]);
 */
export function capabilitiesOf(host, channel) {
  const list = [];
  if (channel.smartMotion) list.push(CAPABILITIES.SMART_MOTION);
  if (channel.tripwire) list.push(CAPABILITIES.TRIPWIRE);
  if (channel.intrusion) list.push(CAPABILITIES.INTRUSION);
  if (host.doorbell) list.push(CAPABILITIES.DOORBELL);
  if (channel.motionDetection !== null && channel.motionDetection !== undefined) {
    list.push(CAPABILITIES.MOTION_DETECTION);
  }
  if (channel.privacy !== null && channel.privacy !== undefined) list.push(CAPABILITIES.PRIVACY);
  if (channel.ptz?.pan) list.push(CAPABILITIES.PAN);
  if (channel.ptz?.tilt) list.push(CAPABILITIES.TILT);
  if (channel.ptz?.zoom) list.push(CAPABILITIES.ZOOM);
  if (channel.ptz?.presets?.length) list.push(CAPABILITIES.PRESETS);
  return list;
}

/**
 * The name of a channel's device.
 * @param {object} host - The probed host.
 * @param {object} channel - The channel.
 * @returns {string} The name.
 * @example
 * deviceName(host, channel);
 */
export function deviceName(host, channel) {
  const title = String(channel.title ?? '').trim();
  if (host.recorder || host.channels.length > 1) {
    return title || `${host.name} ${channel.number}`;
  }
  return title || host.name;
}

/**
 * The RTSP URL of the live view (read by the camera service of Gladys).
 * @param {object} options - `{ host, rtspPort, channel, stream, username, password }`.
 * @returns {string} The URL.
 * @example
 * rtspUrl({ host: '192.168.1.108', rtspPort: 554, channel: 1, stream: 'main', username: 'admin', password: 'x' });
 */
export function rtspUrl({ host, rtspPort, channel, stream, username, password }) {
  const auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  const address = host.includes(':') ? `[${host}]` : host;
  return `rtsp://${auth}${address}:${rtspPort}/cam/realmonitor?channel=${channel}&subtype=${
    stream === STREAMS.SUB ? 1 : 0
  }`;
}

const binary = (name, externalId, category, type, extra = {}) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  keep_history: true,
  has_feedback: false,
  min: 0,
  max: 1,
  ...extra,
});

/**
 * The features of a channel.
 * @param {object} ids - `gladys.externalIds(…)`.
 * @param {string} name - The device name.
 * @param {string[]} capabilities - Its capabilities.
 * @param {Array<{ index: number, name: string }>} presets - Its PTZ presets.
 * @returns {object[]} The features.
 * @example
 * buildFeatures(ids, 'Gate', ['smart-motion'], []);
 */
export function buildFeatures(ids, name, capabilities, presets = []) {
  const has = (capability) => capabilities.includes(capability);
  const motion = (key, label) =>
    binary(
      `${name} - ${label}`,
      ids.feature(key),
      DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
      DEVICE_FEATURE_TYPES.SENSOR.BINARY,
    );
  const features = [
    {
      name,
      external_id: ids.feature(FEATURES.IMAGE),
      category: DEVICE_FEATURE_CATEGORIES.CAMERA,
      type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
      read_only: false,
      keep_history: false,
      has_feedback: false,
      min: 0,
      max: 0,
    },
    motion(FEATURES.MOTION, 'Motion'),
  ];
  // Person and vehicle as motion sensors: Gladys displays, records and offers
  // them in scenes properly, which a presence sensor does not do yet.
  if (has(CAPABILITIES.SMART_MOTION)) {
    features.push(motion(FEATURES.PERSON, 'Person'), motion(FEATURES.VEHICLE, 'Vehicle'));
  }
  if (has(CAPABILITIES.TRIPWIRE)) {
    features.push(motion(FEATURES.TRIPWIRE, 'Tripwire'));
  }
  if (has(CAPABILITIES.INTRUSION)) {
    features.push(motion(FEATURES.INTRUSION, 'Intrusion'));
  }
  if (has(CAPABILITIES.DOORBELL)) {
    // A 1 -> 0 pulse: the dashboard shows "Ringing" then the last ring.
    features.push(
      binary(
        `${name} - Doorbell`,
        ids.feature(FEATURES.DOORBELL),
        DEVICE_FEATURE_CATEGORIES.DOORBELL,
        DEVICE_FEATURE_TYPES.DOORBELL.RING,
      ),
    );
  }
  if (has(CAPABILITIES.MOTION_DETECTION)) {
    features.push({
      ...binary(
        `${name} - Motion detection`,
        ids.feature(FEATURES.MOTION_DETECTION),
        DEVICE_FEATURE_CATEGORIES.SWITCH,
        DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      ),
      read_only: false,
      // Read again on every poll: the web interface can change it too.
      has_feedback: true,
    });
  }
  if (has(CAPABILITIES.PRIVACY)) {
    // 1 = the camera films, 0 = privacy mode (the opposite of LeLensMask).
    features.push({
      ...binary(
        `${name} - Camera enabled`,
        ids.feature(FEATURES.ENABLED),
        DEVICE_FEATURE_CATEGORIES.CAMERA,
        DEVICE_FEATURE_TYPES.CAMERA.ENABLED,
      ),
      read_only: false,
      has_feedback: true,
    });
  }
  const moves = [];
  if (has(CAPABILITIES.PAN)) moves.push(CAMERA_MOVE.PAN_LEFT, CAMERA_MOVE.PAN_RIGHT);
  if (has(CAPABILITIES.TILT)) moves.push(CAMERA_MOVE.TILT_UP, CAMERA_MOVE.TILT_DOWN);
  if (has(CAPABILITIES.ZOOM)) moves.push(CAMERA_MOVE.ZOOM_IN, CAMERA_MOVE.ZOOM_OUT);
  if (moves.length > 0) {
    features.push({
      name: `${name} - Move`,
      external_id: ids.feature(FEATURES.PTZ_MOVE),
      category: DEVICE_FEATURE_CATEGORIES.CAMERA,
      type: DEVICE_FEATURE_TYPES.CAMERA.MOVE,
      read_only: false,
      keep_history: false,
      has_feedback: false,
      min: CAMERA_MOVE.STOP,
      max: CAMERA_MOVE.ZOOM_OUT,
      supported_options: moves.map((value, index) => ({
        value,
        label: MOVE_LABELS[value],
        sort_order: index,
      })),
    });
  }
  if (has(CAPABILITIES.PRESETS) && presets.length > 0) {
    // The option value IS the preset number of the camera.
    const seen = new Set();
    const options = presets
      .filter((preset) => !seen.has(preset.index) && seen.add(preset.index))
      .map((preset, index) => ({
        value: preset.index,
        // Never empty nor duplicated: Gladys refuses the whole device otherwise.
        label: `${preset.index} · ${preset.name || 'Preset'}`.slice(0, 60),
        sort_order: index,
      }));
    features.push({
      name: `${name} - Preset`,
      external_id: ids.feature(FEATURES.PTZ_PRESET),
      category: DEVICE_FEATURE_CATEGORIES.CAMERA,
      type: DEVICE_FEATURE_TYPES.CAMERA.PRESET,
      read_only: false,
      keep_history: false,
      has_feedback: false,
      min: Math.min(...options.map((option) => option.value)),
      max: Math.max(...options.map((option) => option.value)),
      supported_options: options,
    });
  }
  return features;
}

/**
 * The devices of a probed host.
 * @param {object} gladys - The SDK client (ids).
 * @param {object} host - The probed host.
 * @param {object} target - How it was reached: `{ host, port, scheme, username, password }`.
 * @param {string} stream - `main` or `sub`, for the live view.
 * @returns {object[]} The devices.
 * @example
 * buildDevices(gladys, host, target, 'main');
 */
export function buildDevices(gladys, host, target, stream) {
  const kind = host.recorder ? KINDS.RECORDER : host.doorbell ? KINDS.DOORBELL : KINDS.CAMERA;
  return host.channels.map((channel) => {
    const ids = gladys.externalIds(DEVICE_TYPE, platformId(host, channel));
    const name = deviceName(host, channel);
    const capabilities = capabilitiesOf(host, channel);
    return {
      name,
      external_id: ids.device,
      model: host.model || null,
      // The dashboard camera box shows the last PUBLISHED image: the poll keeps
      // it fresh and reads the switches the web interface may have changed.
      should_poll: true,
      poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
      features: buildFeatures(ids, name, capabilities, channel.ptz?.presets ?? []),
      params: [
        {
          name: PARAMS.CAMERA_URL,
          value: rtspUrl({
            host: target.host,
            rtspPort: host.rtspPort,
            channel: channel.number,
            stream,
            username: target.username,
            password: target.password,
          }),
        },
        { name: PARAMS.CAMERA_ROTATION, value: '0' },
        { name: PARAMS.HOST, value: target.host },
        { name: PARAMS.PORT, value: String(target.port) },
        { name: PARAMS.SCHEME, value: target.scheme },
        { name: PARAMS.CHANNEL, value: String(channel.number) },
        { name: PARAMS.SERIAL, value: host.serial },
        { name: PARAMS.MODEL, value: host.model || '' },
        { name: PARAMS.KIND, value: kind },
        { name: PARAMS.CAPABILITIES, value: capabilities.join(',') },
      ],
    };
  });
}

/**
 * Read a param of a device.
 * @param {object} device - The Gladys device.
 * @param {string} name - The param name.
 * @returns {string | undefined} Its value.
 * @example
 * getParam(device, PARAMS.HOST);
 */
export function getParam(device, name) {
  return (device?.params ?? []).find((param) => param.name === name)?.value;
}

/**
 * What the integration needs to know about a created device.
 * @param {object} device - The Gladys device.
 * @returns {object | null} `{ externalId, name, host, port, scheme, channel, index, serial, kind, capabilities }`.
 * @example
 * describe(device);
 */
export function describe(device) {
  const host = getParam(device, PARAMS.HOST);
  const channel = Number(getParam(device, PARAMS.CHANNEL));
  if (!host || !Number.isInteger(channel) || channel < 1) {
    return null;
  }
  return {
    externalId: device.external_id,
    name: device.name,
    host,
    port: Number(getParam(device, PARAMS.PORT)) || null,
    scheme: getParam(device, PARAMS.SCHEME) === 'https' ? 'https' : 'http',
    channel,
    index: channel - 1,
    serial: getParam(device, PARAMS.SERIAL) ?? '',
    model: getParam(device, PARAMS.MODEL) ?? '',
    kind: getParam(device, PARAMS.KIND) ?? KINDS.CAMERA,
    capabilities: String(getParam(device, PARAMS.CAPABILITIES) ?? '')
      .split(',')
      .filter(Boolean),
  };
}

/**
 * The feature external id of a device.
 * @param {string} deviceExternalId - The device id.
 * @param {string} key - A FEATURES value.
 * @returns {string} The feature id (`<device>:<key>`, the SDK convention).
 * @example
 * featureId(device.external_id, FEATURES.MOTION);
 */
export function featureId(deviceExternalId, key) {
  return `${deviceExternalId}:${key}`;
}

/**
 * The feature key of a feature external id.
 * @param {string} externalId - The feature id.
 * @returns {string} The key.
 * @example
 * featureKey('ext:x:camera:ABC:motion'); // 'motion'
 */
export function featureKey(externalId) {
  return String(externalId).split(':').pop();
}
