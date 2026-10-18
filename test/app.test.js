import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS, SCENE_ACTIONS } from '../src/app.js';
import { WIDGETS, WIDGET_ACTIONS } from '../src/widgets.js';
import { TRIGGERS } from '../src/detections.js';
import { createFakeDevice, createFakeNetwork, dhipReply, fakeJpeg } from './helpers/fake-camera.js';

const CAM_IP = '192.168.1.108';
const NVR_IP = '192.168.1.20';
const tick = () => new Promise((resolve) => setImmediate(resolve));
const until = async (check, label = 'condition') => {
  for (let i = 0; i < 500 && !check(); i += 1) await tick();
  assert.ok(check(), label);
};

/**
 * A Gladys, a camera, a recorder and the integration between them.
 * @param {object} [options] - `{ config, scan }`.
 * @returns {Promise<object>} The harness.
 */
async function setup({ config = { password: 'secret' }, scan = true } = {}) {
  const camera = createFakeDevice({
    serial: 'CAMSERIAL01',
    model: 'IP4M-1041B',
    vendor: 'Amcrest',
    name: 'Amcrest',
    ptz: { pan: true, tilt: true, zoom: false },
    presets: [
      { index: 1, name: 'Door' },
      { index: 3, name: 'Drive' },
    ],
    config: {
      RTSP: { 'RTSP.Port': '554' },
      ChannelTitle: { 'ChannelTitle[0].Name': 'Garden' },
      MotionDetect: { 'MotionDetect[0].Enable': 'true' },
      SmartMotionDetect: { 'SmartMotionDetect[0].Enable': 'true' },
      LeLensMask: { 'LeLensMask[0].Enable': 'false' },
    },
  });
  const nvr = createFakeDevice({
    serial: 'NVRSERIAL01',
    model: 'DHI-NVR4108HS',
    deviceClass: 'NVR',
    name: 'NVR',
    channels: 8,
    password: 'other',
    config: {
      RemoteDevice: {
        'RemoteDevice.uuid:System_CONFIG_NETCAMERA_INFO_0.Enable': 'true',
        'RemoteDevice.uuid:System_CONFIG_NETCAMERA_INFO_1.Enable': 'true',
      },
      ChannelTitle: { 'ChannelTitle[0].Name': 'Drive', 'ChannelTitle[1].Name': '' },
      MotionDetect: { 'MotionDetect[0].Enable': 'true', 'MotionDetect[1].Enable': 'false' },
      VideoAnalyseRule: { 'VideoAnalyseRule[1][0].Type': 'CrossLineDetection' },
    },
    storage: {
      'list.info[0].Name': '/dev/sda',
      'list.info[0].State': 'Success',
      'list.info[0].Detail[0].TotalBytes': '2000000000000',
      'list.info[0].Detail[0].UsedBytes': '1500000000000',
    },
  });
  const network = createFakeNetwork({ [CAM_IP]: camera, [NVR_IP]: nvr });
  const gladys = createFakeGladys({
    config: { camera_accounts: `${NVR_IP}|admin|other`, camera_addresses: NVR_IP, ...config },
    scanResults: { 'udp-active-broadcast': [dhipReply(camera, CAM_IP)] },
  });
  const encoded = [];
  const app = createApp(gladys, {
    send: network.send,
    encode: async (jpeg, width) => {
      encoded.push(width);
      return fakeJpeg(width === 320 ? 8000 : 60_000);
    },
    sleep: () => tick(),
    scanCacheMs: 0,
  });
  await gladys.connect();
  if (scan) {
    await gladys.fake.scanRequest();
  }
  return { gladys, app, camera, nvr, network, encoded };
}

/**
 * Create every discovered device, like the user clicking "Add".
 * @param {object} gladys - The fake Gladys.
 */
async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
}

test('scan: the camera found by DHIP and the recorder of the configuration, with their abilities', async () => {
  const { gladys, app } = await setup();
  try {
    assert.equal(gladys.fake.scans.length, 1);
    assert.equal(gladys.fake.scans[0].type, 'udp-active-broadcast');
    const devices = gladys.fake.discoveredDevices;
    assert.deepEqual(
      devices.map((device) => device.name),
      ['Drive', 'NVR 2', 'Garden'],
    );
    const garden = devices.find((device) => device.name === 'Garden');
    assert.equal(garden.external_id, 'ext:test-integration:camera:CAMSERIAL01');
    assert.deepEqual(
      garden.features.map((feature) => feature.external_id.split(':').pop()),
      [
        'image',
        'motion',
        'person',
        'vehicle',
        'motion-detection',
        'enabled',
        'ptz-move',
        'ptz-preset',
      ],
    );
    const url = garden.params.find((param) => param.name === 'CAMERA_URL').value;
    assert.equal(url, 'rtsp://admin:secret@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0');
    const preset = garden.features.find((feature) => feature.type === 'preset');
    assert.deepEqual(
      preset.supported_options.map((option) => [option.value, option.label]),
      [
        [1, '1 · Door'],
        [3, '3 · Drive'],
      ],
    );
    const second = devices.find((device) => device.name === 'NVR 2');
    assert.equal(second.external_id, 'ext:test-integration:camera:NVRSERIAL01-ch2');
    assert.ok(second.features.some((feature) => feature.external_id.endsWith(':tripwire')));
    assert.match(
      second.params.find((p) => p.name === 'CAMERA_URL').value,
      /admin:other@192\.168\.1\.20:554\/cam\/realmonitor\?channel=2/,
    );
  } finally {
    app.stop();
  }
});

test('creation: states, image, event stream; then events become states and scene events', async () => {
  const { gladys, app, camera, nvr } = await setup();
  try {
    await createAll(gladys);
    const garden = 'ext:test-integration:camera:CAMSERIAL01';
    assert.equal(gladys.fake.lastState(`${garden}:motion`), 0);
    assert.equal(gladys.fake.lastState(`${garden}:motion-detection`), 1);
    assert.equal(gladys.fake.lastState(`${garden}:enabled`), 1, 'privacy off = camera enabled');
    assert.ok(
      gladys.fake.cameraImages.some(
        (image) =>
          image.device_external_id === garden ||
          image.external_id === garden ||
          JSON.stringify(image).includes(garden),
      ),
    );
    await until(
      () => camera.streams.size === 1 && nvr.streams.size === 1,
      'one stream per address',
    );
    await until(() => app.online.get(garden) === true, 'online');

    camera.emit('Code=SmartMotionHuman;action=Start;index=0');
    await until(() => gladys.fake.lastState(`${garden}:person`) === 1, 'person');
    await until(() => gladys.fake.sceneEvents.length === 1, 'scene event');
    const [event] = gladys.fake.sceneEvents;
    assert.equal(event.key, TRIGGERS.DETECTION);
    assert.deepEqual(event.data, {
      camera: garden,
      camera_name: 'Garden',
      kind: 'person',
      rule: '',
      object_type: '',
    });
    await until(() => app.detections.history[0]?.imageKey, 'image kept for the widget');
    camera.emit('Code=SmartMotionHuman;action=Stop;index=0');
    await until(() => gladys.fake.lastState(`${garden}:person`) === 0, 'person stop');

    // NVR: channel 2 crosses a line; a channel not created (index 5) is ignored.
    nvr.emit(
      'Code=CrossLineDetection;action=Start;index=1;data={"Name":"Fence","Object":{"ObjectType":"Human"}}',
    );
    nvr.emit('Code=VideoMotion;action=Start;index=5');
    const ch2 = 'ext:test-integration:camera:NVRSERIAL01-ch2';
    await until(() => gladys.fake.lastState(`${ch2}:tripwire`) === 1, 'tripwire');
    await until(() => gladys.fake.sceneEvents.length === 2);
    assert.equal(gladys.fake.sceneEvents[1].data.rule, 'Fence');
    nvr.emit('Code=StorageLowSpace;action=Start;index=0');
    await until(() => gladys.fake.sceneEvents.some((e) => e.key === TRIGGERS.ALARM));

    // Power cut: the camera becomes unreachable, then comes back.
    camera.drop();
    await until(
      () => gladys.fake.sceneEvents.some((e) => e.key === TRIGGERS.CONNECTION_LOST),
      'lost',
    );
    await until(
      () => gladys.fake.sceneEvents.some((e) => e.key === TRIGGERS.CONNECTION_RESTORED),
      'restored',
    );
    assert.ok(gladys.fake.connectionStatus);
  } finally {
    app.stop();
  }
});

test('commands: image on demand, motion detection, privacy, PTZ step with its stop, preset', async () => {
  const { gladys, app, camera } = await setup();
  try {
    await createAll(gladys);
    const device = gladys.fake.devices.find((d) => d.name === 'Garden');
    const feature = (key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
    const image = await gladys.fake.getImage(device);
    assert.equal(image.success, true);
    assert.match(image.data.image, /^image\/jpg;base64,\/9j/);

    assert.equal(
      (await gladys.fake.setValue(device, feature('motion-detection'), 0)).success,
      true,
    );
    assert.equal(camera.config.MotionDetect['MotionDetect[0].Enable'], 'false');
    assert.equal(gladys.fake.lastState(feature('motion-detection').external_id), 0);
    await gladys.fake.setValue(device, feature('enabled'), 0);
    assert.equal(
      camera.config.LeLensMask['LeLensMask[0].Enable'],
      'true',
      'camera disabled = privacy on',
    );
    await gladys.fake.setValue(device, feature('ptz-move'), 1);
    await gladys.fake.setValue(device, feature('ptz-preset'), 3);
    assert.deepEqual(
      camera.commands.filter((c) => c.startsWith('ptz')),
      ['ptz start Left 4 ch1', 'ptz stop Left 4 ch1', 'ptz start GotoPreset 3 ch1'],
    );
    const refused = await gladys.fake.setValue(device, feature('motion'), 1);
    assert.equal(refused.success, false);

    // The poll reads back what the web interface changed.
    camera.config.MotionDetect['MotionDetect[0].Enable'] = 'true';
    await gladys.fake.poll(device);
    assert.equal(gladys.fake.lastState(feature('motion-detection').external_id), 1);
  } finally {
    app.stop();
  }
});

test('scene actions: image, recording mode, reboot; open door refused on a camera', async () => {
  const { gladys, app, camera } = await setup();
  try {
    await createAll(gladys);
    const garden = 'ext:test-integration:camera:CAMSERIAL01';
    const shot = await gladys.fake.sceneAction(SCENE_ACTIONS.TAKE_SNAPSHOT, { camera: garden });
    assert.equal(shot.success, true);
    assert.deepEqual(Object.keys(shot.data.outputs).sort(), ['captured_at', 'size_kb']);
    await gladys.fake.sceneAction(SCENE_ACTIONS.SET_RECORDING, { camera: garden, mode: 'manual' });
    assert.equal(camera.config.RecordMode['RecordMode[0].Mode'], '1');
    await gladys.fake.sceneAction(SCENE_ACTIONS.REBOOT, { camera: garden });
    assert.ok(camera.commands.includes('reboot'));
    const door = await gladys.fake.sceneAction(SCENE_ACTIONS.OPEN_DOOR, {
      camera: garden,
      door: 1,
    });
    assert.equal(door.success, false);
    const unknown = await gladys.fake.sceneAction(SCENE_ACTIONS.TAKE_SNAPSHOT, {
      camera: 'ext:other:x',
    });
    assert.equal(unknown.success, false);
  } finally {
    app.stop();
  }
});

test('widgets: cameras, detections (with its image) and storage pass the validator in 4 languages', async () => {
  const { gladys, app, camera } = await setup();
  try {
    await createAll(gladys);
    const garden = 'ext:test-integration:camera:CAMSERIAL01';
    await until(() => app.online.get(garden) === true);
    camera.emit('Code=VideoMotion;action=Start;index=0');
    await until(() => app.detections.history[0]?.imageKey);
    for (const language of ['en', 'fr', 'de', 'es']) {
      for (const [key, settings] of [
        [WIDGETS.CAMERAS, {}],
        [WIDGETS.DETECTIONS, { count: 3 }],
        [WIDGETS.DETECTIONS, { camera: 'ext:test-integration:camera:NVRSERIAL01-ch1' }],
        [WIDGETS.STORAGE, { camera: 'ext:test-integration:camera:NVRSERIAL01-ch2' }],
        [WIDGETS.STORAGE, { camera: garden }],
      ]) {
        const ack = await gladys.fake.widgetGet(key, { settings, language, units: 'metric' });
        assert.equal(ack.success, true, `${key} ${language}`);
        assert.deepEqual(validateWidgetContent(ack.data.content), [], `${key} ${language}`);
      }
    }
    const content = (
      await gladys.fake.widgetGet(WIDGETS.DETECTIONS, { settings: {}, language: 'fr' })
    ).data.content;
    const item = content.components.find((c) => c.type === 'card-list').items[0];
    assert.equal(item.title, 'Mouvement · Garden');
    const image = await gladys.fake.widgetGetImage(item.image);
    assert.equal(image.success, true);
    assert.deepEqual(validateWidgetImage(image.data.image ?? image.data), []);
    const storage = (
      await gladys.fake.widgetGet(WIDGETS.STORAGE, {
        settings: { camera: 'ext:test-integration:camera:NVRSERIAL01-ch1' },
        language: 'en',
      })
    ).data.content;
    assert.equal(storage.components.find((c) => c.type === 'gauge').value, 75);
    const toast = await gladys.fake.widgetAction(
      WIDGETS.CAMERAS,
      WIDGET_ACTIONS.REFRESH_IMAGES,
      {},
      { settings: {} },
    );
    assert.equal(toast.success, true);
    assert.match(toast.data.message.fr, /3 image/);
  } finally {
    app.stop();
  }
});

test('configuration actions and connection status: a wrong password is reported, not retried', async () => {
  const { gladys, app, camera } = await setup({ config: { password: 'wrong' }, scan: false });
  try {
    const result = await gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
    assert.equal(result.success, true);
    assert.match(result.data.message.en, /✗ 192\.168\.1\.108: password refused for user "admin"/);
    assert.match(
      result.data.message.fr,
      /✓ 192\.168\.1\.20 : DHI-NVR4108HS « NVR », 2 caméra\(s\), règles IVS/,
    );
    assert.equal(camera.authFailures, 1, 'one failed login, not one per request');
    await gladys.fake.scanRequest();
    assert.equal(camera.authFailures, 1, 'the scan right after does not ask again');
    assert.equal(gladys.fake.discoveredDevices.length, 2);
    const refresh = await gladys.fake.action(ACTIONS.REFRESH_IMAGES, {});
    assert.match(refresh.data.message.en, /No camera created yet/);

    await gladys.fake.configUpdated({ ...gladys.fake.config, password: 'secret' });
    const ok = await gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
    assert.match(
      ok.data.message.en,
      /✓ 192\.168\.1\.108: IP4M-1041B "Amcrest", 1 camera\(s\), PTZ, person\/vehicle detection, privacy mode/,
    );
  } finally {
    app.stop();
  }
});

test('without a password: nothing is asked to the cameras', async () => {
  const { gladys, app, camera } = await setup({
    config: { password: '', camera_accounts: '' },
    scan: false,
  });
  try {
    await gladys.fake.scanRequest();
    assert.deepEqual(gladys.fake.discoveredDevices, []);
    assert.equal(camera.requests.length, 0);
    assert.equal(gladys.fake.connectionStatus.connected, false);
    const result = await gladys.fake.action(ACTIONS.TEST_CONNECTION, {});
    assert.match(result.data.message.fr, /mot de passe/);
  } finally {
    app.stop();
  }
});
