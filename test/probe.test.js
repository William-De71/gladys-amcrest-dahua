import { test } from 'node:test';
import assert from 'node:assert/strict';

import { probeHost, isDoorbell, isRecorder, channelIndexes, ivsRules } from '../src/dahua/probe.js';
import { DahuaClient, DahuaAuthError } from '../src/dahua/client.js';
import { createFakeDevice, createFakeNetwork } from './helpers/fake-camera.js';

const clientOf = (device, password = 'secret') =>
  new DahuaClient({
    host: '10.0.0.2',
    username: 'admin',
    password,
    send: createFakeNetwork({ '10.0.0.2': device }).send,
  });

test('a plain camera: identity, RTSP port, motion detection, nothing else', async () => {
  const host = await probeHost(clientOf(createFakeDevice()));
  assert.equal(host.serial, '4X7C5A1ZAG21L3F');
  assert.equal(host.model, 'IPC-HDW5442TM-AS');
  assert.equal(host.deviceClass, 'IPC');
  assert.equal(host.firmware, '2.800.0000000.17.R');
  assert.equal(host.rtspPort, 554);
  assert.equal(host.recorder, false);
  assert.equal(host.doorbell, false);
  assert.equal(host.channels.length, 1);
  assert.deepEqual(host.channels[0], {
    index: 0,
    number: 1,
    title: 'Gate',
    motionDetection: true,
    smartMotion: false,
    tripwire: false,
    intrusion: false,
    privacy: null,
    ptz: null,
  });
});

test('an Amcrest PTZ: privacy mode, smart motion, IVS rules, presets', async () => {
  const device = createFakeDevice({
    model: 'IP4M-1041B',
    vendor: 'Amcrest',
    ptz: { pan: true, tilt: true, zoom: false },
    presets: [
      { index: 1, name: 'Door' },
      { index: 2, name: '' },
    ],
    config: {
      MotionDetect: { 'MotionDetect[0].Enable': 'false' },
      SmartMotionDetect: { 'SmartMotionDetect[0].Enable': 'true' },
      LeLensMask: { 'LeLensMask[0].Enable': 'false' },
      VideoAnalyseRule: {
        'VideoAnalyseRule[0][0].Type': 'CrossLineDetection',
        'VideoAnalyseRule[0][0].Enable': 'false',
        'VideoAnalyseRule[0][1].Type': 'CrossRegionDetection',
      },
    },
  });
  const [channel] = (await probeHost(clientOf(device))).channels;
  assert.equal(channel.motionDetection, false);
  assert.equal(channel.smartMotion, true);
  assert.equal(channel.privacy, false);
  assert.equal(channel.tripwire, true);
  assert.equal(channel.intrusion, true);
  assert.deepEqual(channel.ptz, {
    pan: true,
    tilt: true,
    zoom: false,
    presets: [
      { index: 1, name: 'Door' },
      { index: 2, name: '' },
    ],
  });
});

test('a recorder: one channel per enabled camera, named after the channel titles', async () => {
  const nvr = createFakeDevice({
    serial: 'BC0A198PAJ779DF',
    model: 'DHI-NVR5464-16P-EI',
    deviceClass: 'NVR',
    channels: 16,
    config: {
      RemoteDevice: {
        'RemoteDevice.uuid:System_CONFIG_NETCAMERA_INFO_0.Enable': 'true',
        'RemoteDevice.uuid:System_CONFIG_NETCAMERA_INFO_1.Enable': 'false',
        'RemoteDevice.uuid:System_CONFIG_NETCAMERA_INFO_3.Enable': 'true',
      },
      ChannelTitle: { 'ChannelTitle[0].Name': 'Drive', 'ChannelTitle[3].Name': 'Garden' },
    },
  });
  const host = await probeHost(clientOf(nvr));
  assert.equal(host.recorder, true);
  assert.equal(host.rtspPort, 554, 'default when the table is missing');
  assert.deepEqual(
    host.channels.map((channel) => [channel.number, channel.title]),
    [
      [1, 'Drive'],
      [4, 'Garden'],
    ],
  );
});

test('a doorbell without a device class is recognized by its model; a VTH has no camera', async () => {
  const host = await probeHost(clientOf(createFakeDevice({ model: 'AD410', noClass: true })));
  assert.equal(host.doorbell, true);
  assert.equal(host.channels[0].ptz, null, 'no PTZ probe on a doorbell');
  const vth = await probeHost(
    clientOf(createFakeDevice({ model: 'VTH5221D', deviceClass: 'VTH' })),
  );
  assert.equal(vth.channels.length, 0);
});

test('a refused password stops the probe', async () => {
  await assert.rejects(probeHost(clientOf(createFakeDevice(), 'wrong')), DahuaAuthError);
});

test('classification helpers', () => {
  assert.ok(isDoorbell('DHI-VTO2202F-P', ''));
  assert.ok(isDoorbell('anything', 'VTO'));
  assert.ok(isDoorbell('DB61i', ''));
  assert.ok(!isDoorbell('IPC-HFW2431S', 'IPC'));
  assert.ok(!isDoorbell('ADVANCED-CAM', ''), 'AD followed by a digit only');
  assert.ok(isRecorder('XVR5108HS', ''));
  assert.ok(isRecorder('x', 'NVR'));
  assert.deepEqual(channelIndexes({ recorder: false, collect: { result: '2' } }), [0, 1]);
  assert.deepEqual(
    channelIndexes({ recorder: true, collect: { result: '4' }, remote: {} }),
    [0, 1, 2, 3],
  );
  assert.deepEqual(channelIndexes({ recorder: false, collect: null }), [0]);
  assert.deepEqual(ivsRules(undefined), { tripwire: false, intrusion: false });
});
