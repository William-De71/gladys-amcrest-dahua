import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EventStream,
  MultipartParser,
  attachPath,
  parseEvent,
  parsePartBody,
  EVENT_CODES,
} from '../src/dahua/events.js';
import { DahuaClient } from '../src/dahua/client.js';
import { createFakeDevice, createFakeNetwork } from './helpers/fake-camera.js';

const part = (body) =>
  `--myboundary\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}\r\n\r\n`;

test('the subscription asks for every code the integration uses, with a heartbeat', () => {
  const path = attachPath();
  assert.match(path, /^\/cgi-bin\/eventManager\.cgi\?action=attach&codes=\[VideoMotion,/);
  assert.match(path, /&heartbeat=5$/);
  for (const code of [
    'SmartMotionHuman',
    'CrossLineDetection',
    'PhoneCallDetect',
    'BackKeyLight',
    'StorageFailure',
  ]) {
    assert.ok(EVENT_CODES.includes(code), code);
  }
});

test('an event, with or without a JSON payload over several lines', () => {
  assert.deepEqual(parseEvent('Code=VideoMotion;action=Start;index=0'), {
    code: 'VideoMotion',
    action: 'Start',
    index: 0,
    data: {},
  });
  const ivs = parseEvent(
    'Code=CrossLineDetection;action=Start;index=1;data={\n   "Name" : "Gate; west",\n   "Object" : { "ObjectType" : "Human" }\n}',
  );
  assert.equal(ivs.index, 1);
  assert.equal(ivs.data.Name, 'Gate; west');
  assert.equal(ivs.data.Object.ObjectType, 'Human');
  assert.deepEqual(parseEvent('Code=X;action=Pulse;index=0;data={"trunc').data, {});
  assert.equal(parseEvent('Heartbeat'), null);
  assert.equal(
    parsePartBody('Code=A;action=Start;index=0\r\nCode=B;action=Stop;index=2').length,
    2,
  );
});

test('parts cut anywhere by TCP are reassembled; heartbeats counted', () => {
  const stream =
    part('Code=VideoMotion;action=Start;index=0') +
    part('Heartbeat') +
    part('Code=SmartMotionHuman;action=Start;index=0;data={"Name":"été"}');
  const parser = new MultipartParser();
  const events = [];
  let heartbeats = 0;
  // Byte by byte, the worst case.
  for (const byte of Buffer.from(stream)) {
    const result = parser.push(Buffer.from([byte]));
    events.push(...result.events);
    heartbeats += result.heartbeats;
  }
  assert.deepEqual(
    events.map((event) => event.code),
    ['VideoMotion', 'SmartMotionHuman'],
  );
  assert.equal(events[1].data.Name, 'été', 'a character cut in two chunks survives');
  assert.equal(heartbeats, 1);
  const whole = new MultipartParser().push(stream);
  assert.equal(whole.events[1].data.Name, 'été');
});

test('a part without headers (old firmwares) still counts', () => {
  const parser = new MultipartParser();
  const { events } = parser.push(
    '--myboundary\r\nCode=VideoMotion;action=Stop;index=0\r\n--myboundary\r\n',
  );
  assert.equal(events[0].action, 'Stop');
});

test('the stream connects, delivers, reconnects after a cut, and stops', async () => {
  const camera = createFakeDevice();
  const network = createFakeNetwork({ '192.168.1.108': camera });
  const client = new DahuaClient({
    host: '192.168.1.108',
    username: 'admin',
    password: 'secret',
    send: network.send,
  });
  const received = [];
  const statuses = [];
  let sleeps = 0;
  const stream = new EventStream({
    client,
    onEvent: (event) => received.push(event.code),
    onStatus: (connected) => statuses.push(connected),
    sleep: async () => {
      sleeps += 1;
      await new Promise((resolve) => setImmediate(resolve));
    },
    logger: { debug() {}, warn() {} },
  });
  const running = stream.start();
  const until = async (check) => {
    for (let i = 0; i < 200 && !check(); i += 1)
      await new Promise((resolve) => setImmediate(resolve));
    assert.ok(check());
  };
  await until(() => camera.streams.size === 1);
  camera.emit('Code=VideoMotion;action=Start;index=0', { split: true });
  await until(() => received.length === 1);
  camera.drop();
  await until(() => statuses.includes(false));
  await until(() => camera.streams.size === 1);
  camera.emit('Code=VideoMotion;action=Stop;index=0');
  await until(() => received.length === 2);
  assert.deepEqual(statuses, [true, false, true]);
  assert.ok(sleeps >= 1);
  stream.stop();
  await running;
  assert.equal(camera.streams.size, 0);
});
