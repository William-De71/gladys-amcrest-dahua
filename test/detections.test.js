import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Detections,
  classify,
  detailsOf,
  KINDS,
  ALARMS,
  TRIGGERS,
  DEBOUNCE_MS,
  PULSE_MS,
  WATCHDOG_MS,
  HISTORY_SIZE,
} from '../src/detections.js';

const CAMERA = {
  externalId: 'ext:t:camera:ABC',
  name: 'Gate',
  serial: 'ABC',
  host: '10.0.0.2',
  capabilities: ['smart-motion', 'tripwire', 'doorbell'],
};

/**
 * Detections with a manual clock and timers.
 * @returns {object} The harness.
 */
function harness() {
  let clock = 1_000_000;
  const timers = new Map();
  let id = 0;
  const states = [];
  const events = [];
  const detected = [];
  const detections = new Detections({
    publishStates: async (list) =>
      states.push(...list.map((s) => [s.device_feature_external_id.split(':').pop(), s.state])),
    publishSceneEvent: async (key, data) => events.push([key, data]),
    onDetection: (entry) => detected.push(entry),
    now: () => clock,
    timers: {
      setTimeout: (fn, ms) => {
        id += 1;
        timers.set(id, { fn, at: clock + ms });
        return id;
      },
      clearTimeout: (timer) => timers.delete(timer),
    },
  });
  const advance = async (ms) => {
    clock += ms;
    for (const [key, timer] of [...timers]) {
      if (timer.at <= clock) {
        timers.delete(key);
        timer.fn();
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return { detections, states, events, detected, advance, flush, timers };
}

const ev = (code, action, data = {}, index = 0) => ({ code, action, index, data });

test('classification of the Dahua codes', () => {
  assert.deepEqual(classify(ev('VideoMotion', 'Start')), { kind: 'motion', phase: 'start' });
  assert.deepEqual(classify(ev('SmartMotionVehicle', 'Stop')), { kind: 'vehicle', phase: 'stop' });
  assert.deepEqual(classify(ev('CrossLineDetection', 'Pulse')), {
    kind: 'tripwire',
    phase: 'pulse',
  });
  assert.deepEqual(classify(ev('PhoneCallDetect', 'Start')), { kind: 'doorbell', phase: 'pulse' });
  assert.equal(classify(ev('PhoneCallDetect', 'Stop')), null);
  assert.deepEqual(classify(ev('BackKeyLight', 'Pulse', { State: 1 })), {
    kind: 'doorbell',
    phase: 'pulse',
  });
  assert.equal(
    classify(ev('BackKeyLight', 'Pulse', { State: 8 })),
    null,
    'door unlocked, not a ring',
  );
  assert.deepEqual(classify(ev('StorageLowSpace', 'Start')), {
    alarm: 'storage_low_space',
    phase: 'start',
  });
  assert.equal(classify(ev('StorageLowSpace', 'Stop')), null);
  assert.equal(classify(ev('NTPAdjustTime', 'Pulse')), null);
  assert.equal(classify(ev('VideoMotion', 'Weird')), null);
  assert.deepEqual(detailsOf({ Name: 'Gate', Object: { ObjectType: 'Human' } }), {
    rule: 'Gate',
    objectType: 'Human',
  });
  assert.deepEqual(detailsOf(), { rule: '', objectType: '' });
});

test('motion: 1 on Start, 0 on Stop, one scene event, one history entry', async () => {
  const h = harness();
  h.detections.handle(ev('VideoMotion', 'Start'), CAMERA);
  h.detections.handle(ev('VideoMotion', 'Start'), CAMERA);
  await h.flush();
  h.detections.handle(ev('VideoMotion', 'Stop'), CAMERA);
  await h.flush();
  assert.deepEqual(h.states, [
    ['motion', 1],
    ['motion', 0],
  ]);
  assert.deepEqual(h.events, [
    [
      TRIGGERS.DETECTION,
      { camera: CAMERA.externalId, camera_name: 'Gate', kind: 'motion', rule: '', object_type: '' },
    ],
  ]);
  assert.equal(h.detected.length, 1);
  assert.equal(h.detections.history[0].kind, KINDS.MOTION);
});

test('debounce: a burst of Start/Stop pairs fires once per 10 s', async () => {
  const h = harness();
  for (let i = 0; i < 5; i += 1) {
    h.detections.handle(ev('SmartMotionHuman', 'Start'), CAMERA);
    h.detections.handle(ev('SmartMotionHuman', 'Stop'), CAMERA);
    await h.advance(1000);
  }
  assert.equal(h.events.length, 1);
  await h.advance(DEBOUNCE_MS);
  h.detections.handle(ev('SmartMotionHuman', 'Start'), CAMERA);
  await h.flush();
  assert.equal(h.events.length, 2);
  assert.equal(
    h.states.filter(([, value]) => value === 1).length,
    6,
    'the sensor follows every pair',
  );
});

test('doorbell and tripwire pulses go back to 0; a lost Stop is replaced by the watchdog', async () => {
  const h = harness();
  h.detections.handle(ev('PhoneCallDetect', 'Start'), CAMERA);
  h.detections.handle(
    ev('CrossLineDetection', 'Pulse', { Name: 'Fence', Object: { ObjectType: 'Vehicle' } }),
    CAMERA,
  );
  h.detections.handle(ev('VideoMotion', 'Start'), CAMERA);
  await h.advance(PULSE_MS);
  assert.deepEqual(
    h.states.filter(([key]) => key !== 'motion'),
    [
      ['doorbell', 1],
      ['tripwire', 1],
      ['doorbell', 0],
      ['tripwire', 0],
    ],
  );
  assert.equal(h.events[1][1].rule, 'Fence');
  assert.equal(h.events[1][1].object_type, 'Vehicle');
  await h.advance(WATCHDOG_MS);
  assert.deepEqual(
    h.states.filter(([key]) => key === 'motion'),
    [
      ['motion', 1],
      ['motion', 0],
    ],
  );
});

test('kinds without a feature: event only (sound, tampering, IVS on a camera without the rule)', async () => {
  const h = harness();
  h.detections.handle(ev('AudioMutation', 'Start'), CAMERA);
  h.detections.handle(ev('VideoBlind', 'Start'), CAMERA);
  h.detections.handle(ev('CrossRegionDetection', 'Start'), CAMERA);
  await h.flush();
  assert.deepEqual(h.states, []);
  assert.deepEqual(
    h.events.map(([, data]) => data.kind),
    ['audio', 'tamper', 'intrusion'],
  );
});

test('alarms: storage per device, once a minute; nothing without a camera', async () => {
  const h = harness();
  const other = { ...CAMERA, externalId: 'ext:t:camera:ABC-ch2', name: 'Garden' };
  h.detections.handle(ev('StorageFailure', 'Start'), CAMERA);
  h.detections.handle(ev('StorageFailure', 'Pulse'), other);
  h.detections.handle(ev('VideoLoss', 'Start'), other);
  assert.equal(h.detections.handle(ev('VideoMotion', 'Start'), null), null);
  await h.flush();
  assert.deepEqual(
    h.events.map(([key, data]) => [key, data.kind, data.camera_name]),
    [
      [TRIGGERS.ALARM, ALARMS.STORAGE_FAILURE, 'Gate'],
      [TRIGGERS.ALARM, ALARMS.VIDEO_LOSS, 'Garden'],
    ],
  );
});

test('reset clears the running detections of a lost camera; history is bounded', async () => {
  const h = harness();
  h.detections.handle(ev('VideoMotion', 'Start'), CAMERA);
  h.detections.reset([CAMERA.externalId]);
  await h.flush();
  assert.deepEqual(h.states.at(-1), ['motion', 0]);
  assert.equal(h.timers.size, 0);
  for (let i = 0; i < HISTORY_SIZE + 5; i += 1) {
    await h.advance(DEBOUNCE_MS);
    h.detections.handle(ev('VideoMotion', 'Pulse'), CAMERA);
  }
  assert.equal(h.detections.history.length, HISTORY_SIZE);
  h.detections.stop();
  assert.equal(h.timers.size, 0);
});

test('scene event data stays flat, scalar and short', async () => {
  const h = harness();
  h.detections.handle(
    ev('CrossLineDetection', 'Start', {
      Name: 'x'.repeat(5000),
      Object: { ObjectType: 'y'.repeat(500) },
    }),
    CAMERA,
  );
  await h.flush();
  const [, data] = h.events[0];
  assert.ok(Object.keys(data).length <= 30);
  for (const value of Object.values(data)) {
    assert.ok(['string', 'number', 'boolean'].includes(typeof value));
    assert.ok(String(value).length <= 1000);
  }
});
