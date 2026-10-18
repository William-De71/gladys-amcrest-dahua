// -----------------------------------------------------------------------------
// Dahua events -> Gladys states, scene events and the detection history.
//
// A detection that lasts (motion, person, vehicle, and the IVS rules on most
// firmwares) comes as a Start then a Stop: the motion sensor follows it. A
// moment (a doorbell press, a tripwire crossed on some firmwares) comes as a
// Pulse: the sensor goes to 1 then back to 0. A Stop that never comes (a
// stream cut in the middle of a motion) is replaced by a watchdog.
//
// Scene events fire on the start of a detection only, at most once per
// camera, kind and DEBOUNCE_MS: a person walking in front of a camera produces
// a burst of Start/Stop pairs, not a burst of notifications.
// -----------------------------------------------------------------------------

import { FEATURES } from './devices.js';

/** The detection kinds (values of the `kind` field of the `detection` trigger). */
export const KINDS = {
  MOTION: 'motion',
  PERSON: 'person',
  VEHICLE: 'vehicle',
  TRIPWIRE: 'tripwire',
  INTRUSION: 'intrusion',
  AUDIO: 'audio',
  TAMPER: 'tamper',
  DOORBELL: 'doorbell',
};

/** The alarm kinds (values of the `kind` field of the `alarm` trigger). */
export const ALARMS = {
  VIDEO_LOSS: 'video_loss',
  ALARM_INPUT: 'alarm_input',
  STORAGE_FAILURE: 'storage_failure',
  STORAGE_LOW_SPACE: 'storage_low_space',
  NO_STORAGE: 'no_storage',
};

export const TRIGGERS = {
  DETECTION: 'detection',
  ALARM: 'alarm',
  CONNECTION_LOST: 'connection_lost',
  CONNECTION_RESTORED: 'connection_restored',
};

const DETECTION_CODES = {
  VideoMotion: KINDS.MOTION,
  SmartMotionHuman: KINDS.PERSON,
  SmartMotionVehicle: KINDS.VEHICLE,
  CrossLineDetection: KINDS.TRIPWIRE,
  CrossRegionDetection: KINDS.INTRUSION,
  AudioMutation: KINDS.AUDIO,
  AudioAnomaly: KINDS.AUDIO,
  VideoBlind: KINDS.TAMPER,
};
const ALARM_CODES = {
  VideoLoss: ALARMS.VIDEO_LOSS,
  AlarmLocal: ALARMS.ALARM_INPUT,
  StorageFailure: ALARMS.STORAGE_FAILURE,
  StorageLowSpace: ALARMS.STORAGE_LOW_SPACE,
  StorageNotExist: ALARMS.NO_STORAGE,
};
/** Storage events belong to the device, not to a channel. */
const HOST_ALARMS = new Set([ALARMS.STORAGE_FAILURE, ALARMS.STORAGE_LOW_SPACE, ALARMS.NO_STORAGE]);
/** The kinds that are a motion sensor of the device. */
const KIND_FEATURES = {
  [KINDS.MOTION]: FEATURES.MOTION,
  [KINDS.PERSON]: FEATURES.PERSON,
  [KINDS.VEHICLE]: FEATURES.VEHICLE,
  [KINDS.TRIPWIRE]: FEATURES.TRIPWIRE,
  [KINDS.INTRUSION]: FEATURES.INTRUSION,
  [KINDS.DOORBELL]: FEATURES.DOORBELL,
};
/** The kinds worth an image (the others say nothing about the scene). */
export const IMAGE_KINDS = new Set([
  KINDS.MOTION,
  KINDS.PERSON,
  KINDS.VEHICLE,
  KINDS.TRIPWIRE,
  KINDS.INTRUSION,
  KINDS.DOORBELL,
]);

/** BackKeyLight states that mean "ringing" (VTO doorbells, documented by myhomeiot/DahuaVTO). */
const RINGING_STATES = new Set([1, 2]);
export const DEBOUNCE_MS = 10_000;
export const ALARM_DEBOUNCE_MS = 60_000;
export const PULSE_MS = 3_000;
export const WATCHDOG_MS = 5 * 60_000;
export const HISTORY_SIZE = 30;

/**
 * Turn a raw event into what it means.
 * @param {{ code: string, action: string, data: object }} event - The parsed event.
 * @returns {{ kind?: string, alarm?: string, phase: 'start' | 'stop' | 'pulse' } | null} Null when ignored.
 * @example
 * classify({ code: 'VideoMotion', action: 'Start', data: {} }); // { kind: 'motion', phase: 'start' }
 */
export function classify(event) {
  const action = String(event.action ?? '').toLowerCase();
  const phase =
    action === 'start' ? 'start' : action === 'stop' ? 'stop' : action === 'pulse' ? 'pulse' : null;
  if (!phase) {
    return null;
  }
  if (event.code === 'PhoneCallDetect') {
    // Amcrest AD110 / AD410: Start when the button is pressed.
    return phase === 'stop' ? null : { kind: KINDS.DOORBELL, phase: 'pulse' };
  }
  if (event.code === 'BackKeyLight') {
    // A VTO reports its whole call state here; only 1 and 2 are a ring.
    const state = Number(event.data?.State);
    return RINGING_STATES.has(state) ? { kind: KINDS.DOORBELL, phase: 'pulse' } : null;
  }
  if (DETECTION_CODES[event.code]) {
    return { kind: DETECTION_CODES[event.code], phase };
  }
  if (ALARM_CODES[event.code]) {
    return phase === 'stop' ? null : { alarm: ALARM_CODES[event.code], phase };
  }
  return null;
}

/**
 * The details of an IVS event (rule name, object type), bounded for the scene data.
 * @param {object} data - The `data` payload.
 * @returns {{ rule: string, objectType: string }} The details ('' when absent).
 * @example
 * detailsOf({ Name: 'Gate', Object: { ObjectType: 'Human' } });
 */
export function detailsOf(data = {}) {
  const object = data.Object ?? data.Objects?.[0] ?? {};
  return {
    rule: String(data.Name ?? '').slice(0, 100),
    objectType: String(object.ObjectType ?? '').slice(0, 40),
  };
}

/**
 * The detections of every camera: states, scene events, history.
 */
export class Detections {
  /**
   * @param {object} deps - What it acts on.
   * @param {Function} deps.publishStates - `(states) => Promise`.
   * @param {Function} deps.publishSceneEvent - `(key, data) => Promise`.
   * @param {Function} [deps.onDetection] - `(entry, camera) => void`, after a new detection started.
   * @param {Function} [deps.now] - The clock.
   * @param {object} [deps.timers] - `{ setTimeout, clearTimeout }`.
   * @param {object} [deps.logger] - The logger.
   */
  constructor({
    publishStates,
    publishSceneEvent,
    onDetection = () => {},
    now = Date.now,
    timers,
    logger,
  }) {
    this.publishStates = publishStates;
    this.publishSceneEvent = publishSceneEvent;
    this.onDetection = onDetection;
    this.now = now;
    this.timers = timers ?? { setTimeout, clearTimeout };
    this.logger = logger ?? { warn() {}, debug() {} };
    this.active = new Map();
    this.lastFired = new Map();
    this.history = [];
  }

  /**
   * Publish a value, never throwing (a refused state must not stop the stream).
   * @param {string} featureId - The feature external id.
   * @param {number} value - 0 or 1.
   */
  publish(featureId, value) {
    Promise.resolve(
      this.publishStates([{ device_feature_external_id: featureId, state: value }]),
    ).catch((error) => this.logger.warn(`State of ${featureId} not published: ${error.message}`));
  }

  /**
   * Fire a scene event at most once per key and delay.
   * @param {string} key - The debounce key.
   * @param {number} delay - The delay.
   * @param {string} trigger - The trigger key.
   * @param {object} data - The flat data.
   * @returns {boolean} True when fired.
   */
  fire(key, delay, trigger, data) {
    const last = this.lastFired.get(key);
    if (last !== undefined && this.now() - last < delay) {
      return false;
    }
    this.lastFired.set(key, this.now());
    Promise.resolve(this.publishSceneEvent(trigger, data)).catch((error) =>
      this.logger.warn(`Scene event ${trigger} not published: ${error.message}`),
    );
    return true;
  }

  /**
   * Handle one event of a camera.
   * @param {object} event - The parsed event.
   * @param {object} camera - The device it belongs to (`describe()` output).
   * @returns {object | null} What it was classified as.
   * @example
   * detections.handle(event, camera);
   */
  handle(event, camera) {
    const meaning = classify(event);
    if (!meaning || !camera) {
      return null;
    }
    if (meaning.alarm) {
      const scope = HOST_ALARMS.has(meaning.alarm)
        ? camera.serial || camera.host
        : camera.externalId;
      this.fire(`${scope}|${meaning.alarm}`, ALARM_DEBOUNCE_MS, TRIGGERS.ALARM, {
        camera: camera.externalId,
        camera_name: camera.name,
        kind: meaning.alarm,
      });
      return meaning;
    }
    const featureKey = KIND_FEATURES[meaning.kind];
    const hasFeature =
      featureKey &&
      (featureKey === FEATURES.MOTION ||
        (featureKey === FEATURES.PERSON || featureKey === FEATURES.VEHICLE
          ? camera.capabilities.includes('smart-motion')
          : camera.capabilities.includes(featureKey)));
    const stateKey = `${camera.externalId}|${meaning.kind}`;
    const featureId = hasFeature ? `${camera.externalId}:${featureKey}` : null;

    if (meaning.phase === 'stop') {
      const running = this.active.get(stateKey);
      if (running) {
        this.timers.clearTimeout(running);
        this.active.delete(stateKey);
      }
      if (featureId) {
        this.publish(featureId, 0);
      }
      return meaning;
    }

    // start or pulse
    const already = this.active.has(stateKey);
    if (featureId) {
      if (already) {
        this.timers.clearTimeout(this.active.get(stateKey));
      } else {
        this.publish(featureId, 1);
      }
      const delay = meaning.phase === 'pulse' ? PULSE_MS : WATCHDOG_MS;
      this.active.set(
        stateKey,
        this.timers.setTimeout(() => {
          this.active.delete(stateKey);
          this.publish(featureId, 0);
        }, delay),
      );
    }
    if (already) {
      return meaning;
    }
    const { rule, objectType } = detailsOf(event.data);
    const fired = this.fire(stateKey, DEBOUNCE_MS, TRIGGERS.DETECTION, {
      camera: camera.externalId,
      camera_name: camera.name,
      kind: meaning.kind,
      rule,
      object_type: objectType,
    });
    if (fired) {
      const entry = {
        at: this.now(),
        camera: camera.externalId,
        cameraName: camera.name,
        kind: meaning.kind,
        rule,
        objectType,
        imageKey: null,
      };
      this.history.unshift(entry);
      this.history.length = Math.min(this.history.length, HISTORY_SIZE);
      this.onDetection(entry, camera);
    }
    return meaning;
  }

  /**
   * Clear every running detection of a camera (stream lost: no Stop will come).
   * @param {string[]} externalIds - The devices of the address.
   */
  reset(externalIds) {
    for (const [key, timer] of this.active) {
      const [externalId, kind] = key.split('|');
      if (externalIds.includes(externalId)) {
        this.timers.clearTimeout(timer);
        this.active.delete(key);
        const featureKey = KIND_FEATURES[kind];
        if (featureKey) {
          this.publish(`${externalId}:${featureKey}`, 0);
        }
      }
    }
  }

  /** Stop every timer (shutdown). */
  stop() {
    for (const timer of this.active.values()) {
      this.timers.clearTimeout(timer);
    }
    this.active.clear();
  }
}
