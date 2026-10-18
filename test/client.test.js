import { test } from 'node:test';
import assert from 'node:assert/strict';

import { authorization, parseChallenge, pickChallenge, verifyDigest } from '../src/dahua/digest.js';
import {
  AUTH_PAUSE_MS,
  ClientPool,
  DahuaAuthError,
  DahuaClient,
  DahuaHttpError,
  DahuaUnreachableError,
} from '../src/dahua/client.js';
import { indexedTable, isErrorBody, parseKeyValues, toBool } from '../src/dahua/kv.js';
import { createFakeDevice, createFakeNetwork } from './helpers/fake-camera.js';

const IP = '192.168.1.108';

test('digest: the RFC 7616 example (MD5, qop=auth) gives the documented response', () => {
  // RFC 2617 §3.5 example, kept by RFC 7616.
  const header = authorization({
    challenge: parseChallenge(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
    ),
    method: 'GET',
    uri: '/dir/index.html',
    username: 'Mufasa',
    password: 'Circle Of Life',
    nc: 1,
    cnonce: '0a4f113b',
  });
  const { params } = parseChallenge(header);
  assert.equal(params.response, '6629fae49393a05397450978507c4ef1');
  assert.equal(params.qop, 'auth');
  assert.equal(params.nc, '00000001');
  assert.equal(params.opaque, '5ccc069c403ebaf9f0171e9517f40e41');
});

test('digest: SHA-256, Basic, and Digest preferred over Basic', () => {
  const challenge = parseChallenge('Digest realm="r", nonce="n", qop="auth", algorithm=SHA-256');
  const header = authorization({
    challenge,
    method: 'GET',
    uri: '/x',
    username: 'u',
    password: 'p',
  });
  assert.ok(
    verifyDigest({ header, method: 'GET', realm: 'r', nonce: 'n', username: 'u', password: 'p' }),
  );
  assert.ok(
    !verifyDigest({ header, method: 'GET', realm: 'r', nonce: 'n', username: 'u', password: 'x' }),
  );
  assert.equal(
    authorization({
      challenge: { scheme: 'basic', params: {} },
      method: 'GET',
      uri: '/',
      username: 'a',
      password: 'b',
    }),
    `Basic ${Buffer.from('a:b').toString('base64')}`,
  );
  assert.equal(pickChallenge(['Basic realm="x"', 'Digest realm="x", nonce="1"']).scheme, 'digest');
  assert.equal(pickChallenge('Basic realm="x"').scheme, 'basic');
  assert.equal(pickChallenge([]), null);
});

test('key=value answers, tables, booleans and refusals', () => {
  const values = parseKeyValues(
    'table.VideoAnalyseRule[0][0].Type=CrossLineDetection\r\ntable.VideoAnalyseRule[0][1].Name=Gate = 2\r\ntable.ChannelTitle[1].Name=Garden\r\n',
  );
  assert.equal(values['table.VideoAnalyseRule[0][1].Name'], 'Gate = 2');
  assert.deepEqual(indexedTable(values, 'VideoAnalyseRule')[0], {
    '[0].Type': 'CrossLineDetection',
    '[1].Name': 'Gate = 2',
  });
  assert.equal(indexedTable(values, 'ChannelTitle')[0], undefined);
  assert.equal(indexedTable(values, 'ChannelTitle')[1].Name, 'Garden');
  assert.equal(toBool('TRUE'), true);
  assert.equal(toBool('false'), false);
  assert.equal(toBool('maybe'), null);
  assert.equal(toBool(undefined), null);
  assert.ok(isErrorBody('Error\r\nBad Request!'));
  assert.ok(!isErrorBody('OK'));
});

test('client: answers the challenge, reuses it, and counts the requests made with the nonce', async () => {
  const camera = createFakeDevice();
  const network = createFakeNetwork({ [IP]: camera });
  const client = new DahuaClient({
    host: IP,
    username: 'admin',
    password: 'secret',
    send: network.send,
  });
  const info = await client.values('/cgi-bin/magicBox.cgi?action=getSystemInfo');
  assert.equal(info.serialNumber, camera.serial);
  await client.values('/cgi-bin/magicBox.cgi?action=getMachineName');
  // 401 + 200, then 200 directly with the same challenge (nc 2).
  assert.equal(camera.requests.length, 3);
  assert.equal(client.nc, 2);
  assert.equal(client.address, `${IP}:80`);
});

test('client: a stale nonce is not a wrong password', async () => {
  const camera = createFakeDevice();
  const network = createFakeNetwork({ [IP]: camera });
  const client = new DahuaClient({
    host: IP,
    username: 'admin',
    password: 'secret',
    send: network.send,
  });
  await client.text('/cgi-bin/magicBox.cgi?action=getMachineName');
  camera.nonce = 'renewed';
  assert.match(await client.text('/cgi-bin/magicBox.cgi?action=getMachineName'), /name=/);
  assert.equal(client.authFailedAt, null);
});

test('client: a refused password stops asking for a while (the camera locks after 5)', async () => {
  let clock = 1_000_000;
  const camera = createFakeDevice();
  const network = createFakeNetwork({ [IP]: camera });
  const client = new DahuaClient({
    host: IP,
    username: 'admin',
    password: 'wrong',
    send: network.send,
    now: () => clock,
  });
  await assert.rejects(client.values('/cgi-bin/magicBox.cgi?action=getSystemInfo'), DahuaAuthError);
  assert.equal(camera.authFailures, 1);
  const before = camera.requests.length;
  await assert.rejects(
    client.text('/cgi-bin/snapshot.cgi?channel=1'),
    (error) => error.paused === true,
  );
  assert.equal(camera.requests.length, before, 'nothing sent during the pause');
  // "Test the connection" forces one attempt.
  await assert.rejects(client.text('/x', { force: true }), DahuaAuthError);
  assert.equal(camera.authFailures, 2);
  clock += AUTH_PAUSE_MS + 1;
  client.password = 'secret';
  assert.match(await client.text('/cgi-bin/magicBox.cgi?action=getMachineName'), /name=/);
});

test('client: refusals, writes and unreachable addresses', async () => {
  const camera = createFakeDevice();
  const network = createFakeNetwork({ [IP]: camera });
  const client = new DahuaClient({
    host: IP,
    username: 'admin',
    password: 'secret',
    send: network.send,
  });
  await assert.rejects(
    client.getConfig('LeLensMask'),
    (error) => error instanceof DahuaHttpError && error.status === 400,
  );
  await client.setConfig({ 'MotionDetect[0].Enable': false });
  assert.equal((await client.getConfig('MotionDetect'))['table.MotionDetect[0].Enable'], 'false');
  await assert.rejects(
    client.command('/cgi-bin/magicBox.cgi?action=getMachineName'),
    DahuaHttpError,
  );
  const away = new DahuaClient({
    host: '192.168.1.250',
    username: 'admin',
    password: 'x',
    send: network.send,
  });
  await assert.rejects(
    away.text('/x'),
    (error) => error instanceof DahuaUnreachableError && error.networkCode === 'ECONNREFUSED',
  );
});

test('client: at most two requests at a time', async () => {
  let running = 0;
  let peak = 0;
  const send = async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return { status: 200, headers: {}, challenges: [], body: Buffer.from('a=1') };
  };
  const client = new DahuaClient({ host: IP, username: 'u', password: 'p', send });
  await Promise.all(Array.from({ length: 6 }, () => client.values('/cgi-bin/x')));
  assert.equal(peak, 2);
});

test('pool: one client per address and account, forgotten on clear', () => {
  const pool = new ClientPool();
  const a = pool.get({ host: IP, port: 80, scheme: 'http', username: 'admin', password: 'x' });
  assert.equal(
    pool.get({ host: IP, port: 80, scheme: 'http', username: 'admin', password: 'x' }),
    a,
  );
  assert.notEqual(
    pool.get({ host: IP, port: 80, scheme: 'http', username: 'admin', password: 'y' }),
    a,
  );
  pool.clear();
  assert.notEqual(
    pool.get({ host: IP, port: 80, scheme: 'http', username: 'admin', password: 'x' }),
    a,
  );
  assert.equal(
    new DahuaClient({ host: IP, scheme: 'https', username: 'u', password: 'p' }).port,
    443,
  );
});
