// -----------------------------------------------------------------------------
// Non-regression of everything users store: the device and feature external
// ids, the fields the Discovery "Update" button compares (category, type,
// unit, min, max, step), the device params, and every key of the manifest a
// scene, a widget or a saved configuration refers to.
//
// test/fixtures/discovery.baseline.json was generated from version 0.1.0 (the
// first release). A failure here means existing users would have to delete
// and recreate a device, or would lose a scene or a widget setting: never
// update the baseline without a documented migration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { buildDevices } from '../src/devices.js';
import { WIDGET_ACTIONS } from '../src/widgets.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
let cached;
const baseline = new Proxy(
  {},
  { get: (_, key) => (cached ??= read('./fixtures/discovery.baseline.json'))[key] },
);
const manifest = read('../gladys-assistant-integration.json');

const ETERNAL = [
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'step',
  'read_only',
  'has_feedback',
];
const pick = (feature) =>
  Object.fromEntries(
    ETERNAL.filter((key) => feature[key] !== undefined).map((key) => [key, feature[key]]),
  );
const keys = (list) => (list ?? []).map((entry) => entry.key);
const byKey = (list) => new Map((list ?? []).map((entry) => [entry.key, entry]));

/** A camera with every ability, and a recorder channel with none. */
export function referenceDevices() {
  const gladys = createFakeGladys();
  const target = {
    host: '192.168.1.108',
    port: 80,
    scheme: 'http',
    username: 'admin',
    password: 'x',
  };
  const full = {
    index: 0,
    number: 1,
    title: 'Renamed',
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
        { index: 1, name: 'A' },
        { index: 4, name: 'B' },
      ],
    },
  };
  const bare = {
    index: 2,
    number: 3,
    title: '',
    motionDetection: null,
    smartMotion: false,
    tripwire: false,
    intrusion: false,
    privacy: null,
    ptz: null,
  };
  return [
    ...buildDevices(
      gladys,
      {
        serial: 'CAM1',
        model: 'm',
        name: 'n',
        rtspPort: 554,
        recorder: false,
        doorbell: true,
        channels: [full],
      },
      target,
      'main',
    ),
    ...buildDevices(
      gladys,
      {
        serial: 'NVR1',
        model: 'm',
        name: 'n',
        rtspPort: 554,
        recorder: true,
        doorbell: false,
        channels: [bare],
      },
      target,
      'main',
    ),
  ].map((device) => ({
    external_id: device.external_id,
    should_poll: device.should_poll,
    poll_frequency: device.poll_frequency,
    params: device.params.map((param) => param.name),
    features: device.features.map(pick),
  }));
}

export function referenceManifest() {
  return {
    config_schema: manifest.config_schema.map(({ key, type }) => ({ key, type })),
    actions: keys(manifest.actions),
    scene_triggers: manifest.scene_triggers.map((trigger) => ({
      key: trigger.key,
      fields: trigger.fields.map((field) => ({
        key: field.key,
        options: (field.options ?? []).map((o) => o.value),
      })),
      variables: trigger.variables.map(({ key, type }) => ({ key, type })),
    })),
    scene_actions: manifest.scene_actions.map((action) => ({
      key: action.key,
      fields: keys(action.fields),
      options: Object.fromEntries(
        action.fields.filter((f) => f.options).map((f) => [f.key, f.options.map((o) => o.value)]),
      ),
      outputs: (action.outputs ?? []).map(({ key, type }) => ({ key, type })),
    })),
    widgets: manifest.widgets.map((widget) => ({
      key: widget.key,
      settings: keys(widget.settings),
    })),
    widget_actions: Object.values(WIDGET_ACTIONS),
  };
}

test('the devices keep their external ids, params and the fields Discovery compares', () => {
  assert.deepEqual(referenceDevices(), baseline.devices);
});

test('no configuration key or action disappears or changes type', () => {
  assert.deepEqual(
    keys(manifest.actions).filter((key) => baseline.manifest.actions.includes(key)),
    baseline.manifest.actions,
  );
  const current = byKey(manifest.config_schema);
  for (const { key, type } of baseline.manifest.config_schema) {
    assert.equal(current.get(key)?.type, type, `config_schema.${key}`);
  }
});

test('scene triggers keep their keys, filters, options and variables', () => {
  const current = byKey(manifest.scene_triggers);
  for (const trigger of baseline.manifest.scene_triggers) {
    const now = current.get(trigger.key);
    assert.ok(now, `scene_triggers.${trigger.key}`);
    const fields = byKey(now.fields);
    for (const { key, options } of trigger.fields) {
      assert.ok(fields.has(key), `${trigger.key}.${key}`);
      const values = (fields.get(key)?.options ?? []).map((option) => option.value);
      options.forEach((value) =>
        assert.ok(values.includes(value), `${trigger.key}.${key}: ${value}`),
      );
    }
    const variables = byKey(now.variables);
    for (const { key, type } of trigger.variables) {
      assert.equal(variables.get(key)?.type, type, `${trigger.key}.variables.${key}`);
    }
  }
});

test('scene actions keep their keys, fields, options and outputs; widgets their settings and actions', () => {
  const actions = byKey(manifest.scene_actions);
  for (const action of baseline.manifest.scene_actions) {
    const now = actions.get(action.key);
    assert.ok(now, action.key);
    action.fields.forEach((field) => assert.ok(keys(now.fields).includes(field), field));
    for (const [field, options] of Object.entries(action.options)) {
      const values = (byKey(now.fields).get(field)?.options ?? []).map((o) => o.value);
      options.forEach((value) =>
        assert.ok(values.includes(value), `${action.key}.${field}: ${value}`),
      );
    }
    const outputs = byKey(now.outputs);
    for (const { key, type } of action.outputs) {
      assert.equal(outputs.get(key)?.type, type, `${action.key}.${key}`);
    }
  }
  const widgets = byKey(manifest.widgets);
  for (const widget of baseline.manifest.widgets) {
    const now = widgets.get(widget.key);
    assert.ok(now, widget.key);
    widget.settings.forEach((key) => assert.ok(keys(now.settings).includes(key), key));
  }
  assert.deepEqual(Object.values(WIDGET_ACTIONS), baseline.manifest.widget_actions);
});
