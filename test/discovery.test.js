import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildProbe, parseReplies, parseReply, DISCOVERY_PORT } from '../src/dahua/discovery.js';
import {
  parseAddress,
  parseAddresses,
  parseAccounts,
  normalizeConfig,
  accountFor,
  isConfigured,
} from '../src/config.js';
import { createFakeDevice, dhipReply } from './helpers/fake-camera.js';

test('the DHIP probe carries the 32-byte header, "DHIP" as bytes (not "PIHD")', () => {
  const probe = buildProbe();
  assert.equal(DISCOVERY_PORT, 37810);
  assert.equal(probe.readUInt32LE(0), 32);
  assert.equal(probe.toString('ascii', 4, 8), 'DHIP');
  assert.equal(probe.readBigUInt64LE(8), 0n);
  const length = Number(probe.readBigUInt64LE(16));
  assert.equal(Number(probe.readBigUInt64LE(24)), length);
  assert.equal(probe.length, 32 + length);
  assert.deepEqual(JSON.parse(probe.subarray(32).toString()), {
    method: 'DHDiscover.search',
    params: { mac: '', uni: 1 },
  });
  assert.ok(probe.length <= 512, 'Gladys relays 512 bytes at most');
});

test('replies: the source address wins, one entry per serial, garbage ignored', () => {
  const nvr = createFakeDevice({
    serial: 'BC0A198PAJ779DF',
    model: 'DHI-NVR5464-16P-EI',
    deviceClass: 'NVR',
    channels: 16,
  });
  const reply = dhipReply(nvr, '192.168.1.20', 8080);
  const parsed = parseReply(Buffer.from(reply.payload_base64, 'base64'), '192.168.1.21');
  assert.equal(parsed.host, '192.168.1.21');
  assert.equal(parsed.httpPort, 8080);
  assert.equal(parsed.serial, 'BC0A198PAJ779DF');
  assert.equal(parsed.deviceClass, 'NVR');
  assert.equal(parsed.channels, 16);
  const list = parseReplies([
    reply,
    reply,
    { source_ip: '192.168.1.9', payload_base64: Buffer.from('not json').toString('base64') },
    { source_ip: '192.168.1.9', payload_base64: Buffer.from('{"params":{}}').toString('base64') },
    null,
  ]);
  assert.equal(list.length, 1);
  assert.equal(parseReply(Buffer.alloc(0), 'x'), null);
});

test('addresses, accounts and defaults of the configuration', () => {
  assert.deepEqual(parseAddress('192.168.1.108'), {
    host: '192.168.1.108',
    port: null,
    scheme: 'http',
  });
  assert.deepEqual(parseAddress('https://cam.lan:8443/'), {
    host: 'cam.lan',
    port: 8443,
    scheme: 'https',
  });
  assert.equal(parseAddress('192.168.1.1:99999'), null);
  const { targets, invalid } = parseAddresses(
    '192.168.1.108, 192.168.1.20:8080;bad host!\n10.0.0.2',
  );
  assert.equal(targets.length, 4, 'bad is a valid host name');
  assert.deepEqual(invalid, ['host!']);
  const accounts = parseAccounts('192.168.1.42|gladys|pa|ss, nonsense, 192.168.1.43||x');
  assert.deepEqual(accounts.get('192.168.1.42'), { username: 'gladys', password: 'pa|ss' });
  assert.equal(accounts.size, 1);
  const config = normalizeConfig({
    password: 'x',
    image_refresh_interval: 5,
    camera_accounts: '192.168.1.42|g|p',
  });
  assert.equal(config.username, 'admin');
  assert.equal(config.imageRefreshSeconds, 10);
  assert.equal(config.stream, 'main');
  assert.equal(config.snapshotOnDetection, true);
  assert.deepEqual(accountFor(config, '192.168.1.42'), { username: 'g', password: 'p' });
  assert.deepEqual(accountFor(config, '192.168.1.9'), { username: 'admin', password: 'x' });
  assert.equal(normalizeConfig({ image_refresh_interval: 0 }).imageRefreshSeconds, 0);
  assert.equal(normalizeConfig({ snapshot_on_detection: false }).snapshotOnDetection, false);
  assert.ok(!isConfigured(normalizeConfig({})));
  assert.ok(isConfigured(config));
});
