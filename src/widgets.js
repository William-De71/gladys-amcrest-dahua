// -----------------------------------------------------------------------------
// Dashboard widgets (pure builders: app.js gathers the data and serves them).
//
//   cameras     the cameras at a glance: how many send their events, how many
//               detections in 24 h, each camera's state and last detection,
//               and a button to refresh every image;
//   detections  the last detections, newest first, with the image taken at
//               that moment (optionally one camera only);
//   storage     the SD card or the disks of a camera or a recorder: used,
//               free, capacity, health.
//
// Cameras are devices: their images, motion sensors and switches already have
// the core widgets. These cover what no single device shows.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { t, ago, LANGUAGES } from './i18n.js';
import { KINDS } from './detections.js';

export const WIDGETS = { CAMERAS: 'cameras', DETECTIONS: 'detections', STORAGE: 'storage' };
export const WIDGET_ACTIONS = { REFRESH_IMAGES: 'refresh_images' };
export const DETECTIONS_COUNT = { min: 1, max: 8, default: 5 };
export const TTL = { cameras: 60, detections: 30, storage: 300, message: 60 };
const DAY_MS = 24 * 60 * 60 * 1000;

const KIND_COLORS = {
  [KINDS.PERSON]: WIDGET_COLORS.WARNING,
  [KINDS.VEHICLE]: WIDGET_COLORS.INFO,
  [KINDS.DOORBELL]: WIDGET_COLORS.PRIMARY,
  [KINDS.TRIPWIRE]: WIDGET_COLORS.DANGER,
  [KINDS.INTRUSION]: WIDGET_COLORS.DANGER,
  [KINDS.TAMPER]: WIDGET_COLORS.DANGER,
};

const clip = (text, max) => {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
const label = (key, values) =>
  Object.fromEntries(LANGUAGES.map((lang) => [lang, t(key, lang, values)]));

/**
 * A content holding one message.
 * @param {string} text - The message.
 * @param {number} [ttl] - Its TTL.
 * @returns {object} The content.
 * @example
 * messageContent('No camera yet');
 */
export function messageContent(text, ttl = TTL.message) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: clip(text, 300) }],
  };
}

/**
 * The `cameras` widget.
 * @param {object} params - `{ cameras, history, language, now }`; each camera
 *   `{ externalId, name, online }` (online: true, false or null = connecting).
 * @returns {object} The content.
 * @example
 * buildCamerasWidget({ cameras, history, language: 'fr', now: Date.now() });
 */
export function buildCamerasWidget({ cameras, history, language, now }) {
  if (cameras.length === 0) {
    return messageContent(t('noCameraWidget', language));
  }
  const online = cameras.filter((camera) => camera.online === true).length;
  const recent = history.filter((entry) => now - entry.at < DAY_MS);
  const lastOf = new Map();
  for (const entry of history) {
    if (!lastOf.has(entry.camera)) {
      lastOf.set(entry.camera, entry);
    }
  }
  const shown = cameras.slice(0, cameras.length > 10 ? 9 : 10);
  const items = shown.map((camera) => {
    const last = lastOf.get(camera.externalId);
    let value;
    let color;
    if (camera.online === false) {
      value = t('cameraOffline', language);
      color = WIDGET_COLORS.DANGER;
    } else if (camera.online === null) {
      value = t('cameraWaiting', language);
      color = WIDGET_COLORS.NEUTRAL;
    } else if (last) {
      value = t('cameraLast', language, {
        kind: t(`kind_${last.kind}`, language),
        ago: ago(last.at, now, language),
      });
      // Green for every camera online: red is kept for an unreachable one.
      color = WIDGET_COLORS.SUCCESS;
    } else {
      value = t('cameraOnline', language);
      color = WIDGET_COLORS.SUCCESS;
    }
    return { label: clip(camera.name, 40), value: clip(value, 40), color };
  });
  if (cameras.length > 10) {
    items.push({
      label: clip(t('moreCameras', language, { count: cameras.length - 9 }), 40),
      value: '…',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  return {
    ttl_seconds: TTL.cameras,
    components: [
      {
        type: 'value',
        label: clip(t('tileOnline', language), 24),
        value: `${online}/${cameras.length}`,
        icon: 'video',
        color: online === cameras.length ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
      },
      {
        type: 'value',
        label: clip(t('tileDetections', language), 24),
        value: recent.length,
        icon: 'eye',
        color: WIDGET_COLORS.PRIMARY,
      },
      { type: 'status', items },
      {
        type: 'button',
        label: label('buttonRefresh'),
        icon: 'refresh-cw',
        style: 'secondary',
        action: { key: WIDGET_ACTIONS.REFRESH_IMAGES },
      },
    ],
  };
}

/**
 * The `detections` widget.
 * @param {object} params - `{ history, camera, count, language, now }`; `camera`
 *   an external id to keep only one camera (empty: all).
 * @returns {object} The content.
 * @example
 * buildDetectionsWidget({ history, count: 5, language: 'en', now: Date.now() });
 */
export function buildDetectionsWidget({ history, camera, count, language, now }) {
  const entries = camera ? history.filter((entry) => entry.camera === camera) : history;
  const recent = entries.filter((entry) => now - entry.at < DAY_MS);
  const components = [
    {
      type: 'text',
      variant: 'caption',
      text: clip(t('detectionsCaption', language, { count: recent.length }), 80),
    },
  ];
  const shown = entries.slice(0, count);
  if (shown.length === 0) {
    components.push({ type: 'text', variant: 'body', text: t('noDetection', language) });
  } else {
    components.push({
      type: 'card-list',
      display: 'list',
      items: shown.map((entry) => {
        const details = [
          entry.rule ? t('detailRule', language, { rule: entry.rule }) : '',
          entry.objectType ? t('detailObject', language, { object: entry.objectType }) : '',
        ].filter(Boolean);
        return {
          title: clip(`${t(`kind_${entry.kind}`, language)} · ${entry.cameraName}`, 60),
          subtitle: clip(ago(entry.at, now, language), 80),
          date: new Date(entry.at).toISOString(),
          ...(entry.imageKey ? { image: entry.imageKey } : {}),
          badge: {
            text: clip(t(`kind_${entry.kind}`, language), 16),
            color: KIND_COLORS[entry.kind] ?? WIDGET_COLORS.NEUTRAL,
          },
          ...(details.length > 0 ? { description: clip(details.join('\n'), 2000) } : {}),
        };
      }),
    });
  }
  return { ttl_seconds: TTL.detections, components };
}

const gigabytes = (bytes) => Math.round((bytes / 1e9) * 10) / 10;

/**
 * The `storage` widget.
 * @param {object} params - `{ storage, error, cameraName, language }`; `storage`
 *   from readStorage(), `error` a reason when it could not be read.
 * @returns {object} The content.
 * @example
 * buildStorageWidget({ storage, cameraName: 'NVR', language: 'en' });
 */
export function buildStorageWidget({ storage, error, cameraName, language }) {
  if (error) {
    return messageContent(t('storageUnreachable', language, { reason: clip(error, 200) }));
  }
  if (!storage || storage.disks === 0 || storage.totalBytes <= 0) {
    return messageContent(t('storageNone', language), TTL.storage);
  }
  const percent = Math.min(100, Math.round((storage.usedBytes / storage.totalBytes) * 100));
  return {
    ttl_seconds: TTL.storage,
    components: [
      { type: 'text', variant: 'caption', text: clip(cameraName, 80) },
      {
        type: 'gauge',
        label: clip(t('storageUsed', language), 24),
        value: percent,
        min: 0,
        max: 100,
        unit: '%',
        color: percent >= 95 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.PRIMARY,
      },
      {
        type: 'value',
        label: clip(t('storageFree', language), 24),
        value: gigabytes(Math.max(0, storage.totalBytes - storage.usedBytes)),
        unit: t('unitGigabytes', language),
        icon: 'hard-drive',
      },
      {
        type: 'value',
        label: clip(t('storageTotal', language), 24),
        value: gigabytes(storage.totalBytes),
        unit: t('unitGigabytes', language),
        icon: 'database',
      },
      {
        type: 'status',
        items: [
          {
            label: t('storageDisks', language),
            value: storage.disks,
            color: WIDGET_COLORS.NEUTRAL,
          },
          {
            label: t('storageState', language),
            value:
              storage.faulty > 0
                ? t('storageFaulty', language, { count: storage.faulty })
                : t('storageHealthy', language),
            color: storage.faulty > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
          },
        ],
      },
    ],
  };
}
