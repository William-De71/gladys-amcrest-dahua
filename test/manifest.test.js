import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

import { TRIGGERS, KINDS, ALARMS } from '../src/detections.js';
import { SCENE_ACTIONS, ACTIONS } from '../src/app.js';
import { WIDGETS, WIDGET_ACTIONS, DETECTIONS_COUNT } from '../src/widgets.js';
import { DEFAULTS, STREAMS } from '../src/config.js';
import { RECORD_MODES } from '../src/dahua/commands.js';
import { DISCOVERY_PORT } from '../src/dahua/discovery.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('a device integration, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'Amcrest / Dahua');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-amcrest-dahua:${pkg.version}`);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/William-De71/gladys-amcrest-dahua/main/cover.jpg',
  );
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-amcrest-dahua');
  assert.deepEqual(manifest.categories, ['security']);
});

test('local transport only, DHIP discovery the only permission, Gladys 5.3.0 for the catalog keywords', () => {
  assert.deepEqual(manifest.transports, ['local']);
  assert.doesNotMatch(source('../src/app.js'), /GLADYS_PREFER_LOCAL|publishTransports/);
  assert.deepEqual(manifest.network_discovery, [
    { type: 'udp-active-broadcast', ports: [DISCOVERY_PORT] },
  ]);
  for (const key of ['location', 'network_wake', 'containers', 'webhooks']) {
    assert.equal(manifest[key], undefined, key);
  }
  // No widget button form (that would need 5.2.0).
  assert.doesNotMatch(source('../src/widgets.js'), /fields:/);
  assert.equal(manifest.gladys_version, '>=5.3.0');
});

test('declares exactly the scene triggers, actions and widgets the code handles', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((x) => x.key).sort(),
    Object.values(TRIGGERS).sort(),
  );
  assert.deepEqual(
    manifest.scene_actions.map((x) => x.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(manifest.widgets.map((x) => x.key).sort(), Object.values(WIDGETS).sort());
  assert.deepEqual(
    manifest.actions.map((x) => x.key),
    Object.values(ACTIONS),
  );
  const app = source('../src/app.js');
  for (const key of Object.keys(WIDGETS)) {
    assert.match(app, new RegExp(`onWidgetGet\\(\\s*WIDGETS\\.${key}`), key);
  }
  assert.match(app, /onWidgetAction\(\s*WIDGETS\.CAMERAS/);
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(app, new RegExp(`onSceneAction\\(\\s*SCENE_ACTIONS\\.${key}`), key);
  }
  for (const key of Object.keys(ACTIONS)) {
    assert.match(app, new RegExp(`onAction\\(\\s*ACTIONS\\.${key}`), key);
  }
  assert.deepEqual(Object.values(WIDGET_ACTIONS), ['refresh_images']);
});

test('mirrors the values and bounds of the code', () => {
  const config = byKey(manifest.config_schema);
  assert.equal(config.get('password').type, 'secret');
  assert.equal(config.get('camera_accounts').type, 'secret');
  assert.equal(config.get('username').default, DEFAULTS.username);
  assert.equal(config.get('image_refresh_interval').default, DEFAULTS.image_refresh_interval);
  assert.equal(config.get('snapshot_on_detection').default, DEFAULTS.snapshot_on_detection);
  assert.deepEqual(values(config.get('stream')), Object.values(STREAMS));
  assert.equal(config.get('stream').default, DEFAULTS.stream);
  const triggers = byKey(manifest.scene_triggers);
  assert.deepEqual(
    values(byKey(triggers.get('detection').fields).get('kind')),
    Object.values(KINDS),
  );
  assert.deepEqual(values(byKey(triggers.get('alarm').fields).get('kind')), Object.values(ALARMS));
  for (const trigger of manifest.scene_triggers) {
    assert.equal(byKey(trigger.fields).get('camera').source, 'devices', trigger.key);
    assert.ok(byKey(trigger.variables).has('camera_name'), trigger.key);
  }
  const actions = byKey(manifest.scene_actions);
  assert.deepEqual(
    values(byKey(actions.get('set_recording').fields).get('mode')).sort(),
    Object.keys(RECORD_MODES).sort(),
  );
  for (const action of manifest.scene_actions) {
    assert.equal(byKey(action.fields).get('camera').source, 'devices', action.key);
  }
  const count = byKey(byKey(manifest.widgets).get('detections').settings).get('count');
  for (const bound of ['min', 'max', 'default']) {
    assert.equal(count[bound], DETECTIONS_COUNT[bound], bound);
  }
});

test('the variables match the event data the code sends', () => {
  const triggers = byKey(manifest.scene_triggers);
  const keysOf = (key) => [
    ...byKey(triggers.get(key).variables).keys(),
    ...byKey(triggers.get(key).fields).keys(),
  ];
  assert.deepEqual(
    new Set(keysOf('detection')),
    new Set(['camera', 'camera_name', 'kind', 'rule', 'object_type']),
  );
  assert.deepEqual(new Set(keysOf('alarm')), new Set(['camera', 'camera_name', 'kind']));
  assert.deepEqual(
    new Set(keysOf('connection_lost')),
    new Set(['camera', 'camera_name', 'reason']),
  );
  assert.deepEqual(new Set(keysOf('connection_restored')), new Set(['camera', 'camera_name']));
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20);
  assert.ok(manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
  }
  for (const action of [...manifest.scene_actions, ...manifest.actions]) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
    assert.ok((action.outputs ?? []).length <= 20, action.key);
  }
  for (const widget of manifest.widgets) {
    assert.equal(widget.ttl_seconds, undefined, 'the store refuses a manifest TTL');
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('no remote host in the code: everything stays on the local network', () => {
  // config.js parses the `https://` prefix of the addresses typed by the user.
  for (const file of [
    'app.js',
    'devices.js',
    'detections.js',
    'widgets.js',
    'dahua/client.js',
    'dahua/transport.js',
    'dahua/probe.js',
    'dahua/events.js',
    'dahua/commands.js',
    'dahua/snapshot.js',
    'dahua/discovery.js',
  ]) {
    assert.doesNotMatch(source(`../src/${file}`), /https?:\/\/[a-z]/i, file);
  }
});

test('catalog of Gladys 5.3.0: search keywords within the store bounds, countries', () => {
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword);
  }
  assert.equal(new Set(normalized).size, normalized.length, 'unique once trimmed and lowercased');
  assert.ok(!normalized.includes(manifest.name.toLowerCase()), 'never the name itself');
  assert.equal(manifest.countries, undefined, 'usable worldwide: no country list');
});
