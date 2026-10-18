import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';

import {
  buildDevices,
  describe,
  rtspUrl,
  deviceName,
  platformId,
  CAPABILITIES,
} from '../src/devices.js';

export const FULL_HOST = {
  serial: 'ABC123',
  model: 'IP4M-1041B',
  name: 'Amcrest',
  rtspPort: 554,
  recorder: false,
  doorbell: true,
  channels: [
    {
      index: 0,
      number: 1,
      title: 'Garden',
      motionDetection: true,
      smartMotion: true,
      tripwire: true,
      intrusion: true,
      privacy: false,
      ptz: {
        pan: true,
        tilt: true,
        zoom: true,
        presets: [
          { index: 2, name: 'Door' },
          { index: 2, name: 'Dup' },
          { index: 5, name: '' },
        ],
      },
    },
  ],
};
export const TARGET = {
  host: '192.168.1.108',
  port: 80,
  scheme: 'http',
  username: 'admin',
  password: 'p@ss:word',
};

test('every feature has a known category/type pair, min, max, read_only and has_feedback', () => {
  const gladys = createFakeGladys();
  const categories = new Set(Object.values(DEVICE_FEATURE_CATEGORIES));
  const types = new Set(
    Object.values(DEVICE_FEATURE_TYPES).flatMap((group) => Object.values(group)),
  );
  const [device] = buildDevices(gladys, FULL_HOST, TARGET, 'main');
  assert.equal(device.should_poll, true);
  assert.equal(device.poll_frequency, DEVICE_POLL_FREQUENCIES.EVERY_MINUTES);
  assert.equal(device.features.length, 11, 'every feature at once');
  for (const feature of device.features) {
    assert.ok(categories.has(feature.category), feature.category);
    assert.ok(types.has(feature.type), feature.type);
    for (const key of ['min', 'max', 'read_only', 'has_feedback', 'keep_history']) {
      assert.notEqual(feature[key], undefined, `${feature.external_id}.${key}`);
    }
    assert.ok(feature.min <= feature.max, feature.external_id);
    for (const option of feature.supported_options ?? []) {
      assert.ok(option.label.trim(), 'never an empty label');
    }
    const labels = (feature.supported_options ?? []).map((option) => option.label);
    assert.equal(new Set(labels).size, labels.length, 'never a duplicated label');
  }
  const preset = device.features.find((feature) => feature.type === 'preset');
  assert.deepEqual(
    preset.supported_options.map((o) => o.value),
    [2, 5],
    'duplicates dropped',
  );
  assert.equal(preset.min, 2);
  assert.equal(preset.max, 5);
});

test('the fake Gladys accepts the devices (same checks as the core)', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  const devices = [
    ...buildDevices(gladys, FULL_HOST, TARGET, 'sub'),
    ...buildDevices(
      gladys,
      {
        ...FULL_HOST,
        serial: 'NVR',
        recorder: true,
        doorbell: false,
        channels: [
          { ...FULL_HOST.channels[0], ptz: null, privacy: null },
          { ...FULL_HOST.channels[0], index: 3, number: 4, title: '' },
        ],
      },
      TARGET,
      'main',
    ),
  ];
  await gladys.publishDiscoveredDevices(devices);
  assert.equal(gladys.fake.discoveredDevices.length, 3);
});

test('ids, names, RTSP URL (escaped credentials) and the description read back from params', () => {
  const gladys = createFakeGladys();
  const recorder = {
    ...FULL_HOST,
    serial: 'NVR',
    recorder: true,
    channels: [{ ...FULL_HOST.channels[0], index: 3, number: 4, title: '' }],
  };
  assert.equal(platformId(FULL_HOST, FULL_HOST.channels[0]), 'ABC123');
  assert.equal(platformId(recorder, recorder.channels[0]), 'NVR-ch4');
  assert.equal(deviceName(recorder, recorder.channels[0]), 'Amcrest 4');
  assert.equal(
    rtspUrl({
      host: 'fe80::1',
      rtspPort: 554,
      channel: 2,
      stream: 'sub',
      username: 'a b',
      password: 'p@ss:word',
    }),
    'rtsp://a%20b:p%40ss%3Aword@[fe80::1]:554/cam/realmonitor?channel=2&subtype=1',
  );
  const [device] = buildDevices(gladys, recorder, TARGET, 'main');
  const camera = describe(device);
  assert.equal(camera.host, '192.168.1.108');
  assert.equal(camera.channel, 4);
  assert.equal(camera.index, 3);
  assert.equal(camera.kind, 'recorder');
  assert.ok(camera.capabilities.includes(CAPABILITIES.PRESETS));
  assert.equal(describe({ params: [] }), null);
});
