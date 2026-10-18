import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import {
  buildCamerasWidget,
  buildDetectionsWidget,
  buildStorageWidget,
  messageContent,
} from '../src/widgets.js';
import { LANGUAGES } from '../src/i18n.js';

const NOW = Date.parse('2026-10-18T18:00:00Z');
const cameras = Array.from({ length: 12 }, (_, i) => ({
  externalId: `ext:t:camera:C${i}`,
  name: `Camera with a rather long name number ${i}`,
  online: i === 1 ? false : i === 2 ? null : true,
}));
const history = [
  {
    at: NOW - 60_000,
    camera: 'ext:t:camera:C0',
    cameraName: 'Gate',
    kind: 'person',
    rule: '',
    objectType: '',
    imageKey: 'det-a-1',
  },
  {
    at: NOW - 3_600_000,
    camera: 'ext:t:camera:C3',
    cameraName: 'Drive',
    kind: 'tripwire',
    rule: 'Fence',
    objectType: 'Vehicle',
    imageKey: null,
  },
  {
    at: NOW - 3 * 86_400_000,
    camera: 'ext:t:camera:C0',
    cameraName: 'Gate',
    kind: 'doorbell',
    rule: '',
    objectType: '',
    imageKey: null,
  },
];

test('every widget content passes the validator, in every language and edge case', () => {
  for (const language of LANGUAGES) {
    const contents = [
      buildCamerasWidget({ cameras, history, language, now: NOW }),
      buildCamerasWidget({ cameras: cameras.slice(0, 3), history: [], language, now: NOW }),
      buildCamerasWidget({ cameras: [], history, language, now: NOW }),
      buildDetectionsWidget({ history, count: 8, language, now: NOW }),
      buildDetectionsWidget({ history, camera: 'ext:t:camera:C9', count: 5, language, now: NOW }),
      buildStorageWidget({
        storage: { disks: 2, totalBytes: 4e12, usedBytes: 3.9e12, faulty: 1 },
        cameraName: 'NVR',
        language,
      }),
      buildStorageWidget({
        storage: { disks: 0, totalBytes: 0, usedBytes: 0, faulty: 0 },
        cameraName: 'Cam',
        language,
      }),
      buildStorageWidget({ error: 'HTTP 400 on /cgi-bin/storageDevice.cgi: Error', language }),
      messageContent('x'.repeat(500)),
    ];
    for (const content of contents) {
      assert.deepEqual(
        validateWidgetContent(content),
        [],
        `${language}: ${JSON.stringify(content).slice(0, 120)}`,
      );
    }
  }
});

test('cameras widget: counts, states, the ten-row status limit', () => {
  const content = buildCamerasWidget({ cameras, history, language: 'fr', now: NOW });
  const [online, detections, status] = content.components;
  assert.equal(online.value, '10/12');
  assert.equal(detections.value, 2, 'detections of the last 24 h');
  assert.equal(status.items.length, 10);
  assert.equal(status.items[0].value, 'Personne il y a 1 min');
  assert.equal(status.items[1].value, 'Injoignable');
  assert.equal(status.items[1].color, 'danger');
  assert.equal(status.items[2].value, 'Connexion…');
  assert.match(status.items[9].label, /3 caméra/);
});

test('detections widget: newest first, image, badge, details; one camera only', () => {
  const content = buildDetectionsWidget({ history, count: 2, language: 'de', now: NOW });
  const list = content.components.find((c) => c.type === 'card-list');
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].title, 'Person · Gate');
  assert.equal(list.items[0].image, 'det-a-1');
  assert.equal(list.items[1].description, 'Regel: Fence\nObjekt: Vehicle');
  assert.equal(list.items[1].image, undefined);
  const one = buildDetectionsWidget({
    history,
    camera: 'ext:t:camera:C3',
    count: 5,
    language: 'en',
    now: NOW,
  });
  assert.equal(one.components.find((c) => c.type === 'card-list').items.length, 1);
  assert.equal(content.components[0].text, '2 Erkennung(en) in 24 h');
});

test('storage widget: percent, free space, health', () => {
  const content = buildStorageWidget({
    storage: { disks: 1, totalBytes: 1e12, usedBytes: 2.5e11, faulty: 0 },
    cameraName: 'NVR',
    language: 'es',
  });
  assert.equal(content.components.find((c) => c.type === 'gauge').value, 25);
  assert.equal(content.components.filter((c) => c.type === 'value')[0].value, 750);
  assert.equal(content.components.find((c) => c.type === 'status').items[1].value, 'Correcto');
});
