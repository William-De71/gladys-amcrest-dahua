// -----------------------------------------------------------------------------
// The Amcrest / Dahua integration, wired to a Gladys client.
//
// `createApp(gladys, deps)` registers every handler on the client it receives:
// `new GladysIntegration()` in production (index.js), the fake Gladys of the
// SDK in the tests (with the fake camera as transport). Nothing here connects.
//
// Data flow, all on the local network:
//   - scan: DHIP broadcast (relayed by Gladys) + the addresses of the
//     configuration + the cameras already created; each address is probed
//     (identity, channels, abilities) and published as one device per camera;
//   - events: ONE event stream per address (eventManager attach), kept open
//     for life; events become motion states, scene events, the history of
//     the detections widget, and an image of the camera;
//   - images: on request (`onGetImage`), on a timer for the dashboard, and on
//     each detection; switches (motion detection, privacy) read on poll.
// -----------------------------------------------------------------------------

import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { accountFor, isConfigured, normalizeConfig } from './config.js';
import { ClientPool, DahuaAuthError, DahuaUnreachableError } from './dahua/client.js';
import { buildProbe, parseReplies, DISCOVERY_PORT } from './dahua/discovery.js';
import { probeHost } from './dahua/probe.js';
import { EventStream } from './dahua/events.js';
import { snapshot, toGladysImage, reencode, isJpeg } from './dahua/snapshot.js';
import {
  gotoPreset,
  openDoor,
  ptzStep,
  readStorage,
  readSwitches,
  reboot,
  setMotionDetection,
  setPrivacy,
  setRecordMode,
} from './dahua/commands.js';
import {
  buildDevices,
  describe,
  featureId,
  featureKey,
  FEATURES,
  CAPABILITIES,
  KINDS,
} from './devices.js';
import { Detections, IMAGE_KINDS, TRIGGERS } from './detections.js';
import {
  WIDGETS,
  WIDGET_ACTIONS,
  DETECTIONS_COUNT,
  buildCamerasWidget,
  buildDetectionsWidget,
  buildStorageWidget,
  messageContent,
} from './widgets.js';
import { all, each, t } from './i18n.js';

export const ACTIONS = { TEST_CONNECTION: 'test_connection', REFRESH_IMAGES: 'refresh_images' };
export const SCENE_ACTIONS = {
  TAKE_SNAPSHOT: 'take_snapshot',
  SET_RECORDING: 'set_recording',
  OPEN_DOOR: 'open_door',
  REBOOT: 'reboot',
};

const SCAN_CACHE_MS = 60_000;
const SCAN_TIMEOUT_SECONDS = 4;
const PROBE_PARALLEL = 4;
/** Gladys accepts 12 images per minute per camera. */
const IMAGE_MIN_INTERVAL_MS = 5_000;
const WIDGET_REFRESH_MIN_MS = 10_000;
const MAX_WIDGET_IMAGES = 16;
const THUMBNAIL_WIDTH = 320;
const MAX_ACTION_TEXT = 1500;

/**
 * Run promises with a bounded parallelism.
 * @param {Array<any>} items - The inputs.
 * @param {number} limit - At most this many at a time.
 * @param {Function} run - `(item) => Promise`.
 * @returns {Promise<Array<any>>} The results, in order.
 * @example
 * await mapLimit(targets, 4, probe);
 */
async function mapLimit(items, limit, run) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The address key of a target (one event stream, one client per key).
 * @param {{ scheme: string, host: string, port: number | null }} target - The target.
 * @returns {string} `scheme://host:port`.
 * @example
 * addressKey({ scheme: 'http', host: '192.168.1.108', port: 80 });
 */
export function addressKey(target) {
  const port = target.port || (target.scheme === 'https' ? 443 : 80);
  return `${target.scheme}://${String(target.host).toLowerCase()}:${port}`;
}

/**
 * Register the handlers of the integration.
 * @param {object} gladys - The SDK client (real or fake).
 * @param {object} [deps] - `{ send, now, encode, sleep, timers, logger, scanCacheMs }` for the tests.
 * @returns {object} Hooks for the tests (`scan`, `streams`, `detections`, `stop`…).
 * @example
 * createApp(new GladysIntegration());
 */
export function createApp(gladys, deps = {}) {
  const logger = deps.logger ?? sdkLogger;
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? { setTimeout, clearTimeout, setInterval, clearInterval };
  const encode = deps.encode ?? reencode;
  const pool = new ClientPool({ send: deps.send, now });
  /** addressKey -> { stream, externalIds } */
  const streams = new Map();
  /** device external id -> true (events flow) / false (unreachable) / null (connecting) */
  const online = new Map();
  /** addressKey -> 'auth' | 'unreachable' */
  const addressErrors = new Map();
  const lastImageAt = new Map();
  const capturesInFlight = new Map();
  const widgetImages = new Map();
  const widgetRefreshAt = new Map();
  const widgetRefreshPending = new Map();
  let config = normalizeConfig();
  let lastScan = null;
  let lastReplies = [];
  let refreshTimer = null;
  let lastStatus = null;
  let imageCounter = 0;
  let stopped = false;

  const detections = new Detections({
    publishStates: (states) => gladys.publishStates(states),
    publishSceneEvent: (key, data) => gladys.publishSceneEvent(key, data),
    onDetection: (entry, camera) => onDetection(entry, camera),
    now,
    timers,
    logger,
  });

  // --- Helpers -------------------------------------------------------------------------------

  const cameras = () => (gladys.devices ?? []).map(describe).filter(Boolean);
  const cameraByExternalId = (externalId) =>
    cameras().find((camera) => camera.externalId === externalId) ?? null;

  /**
   * The client of a camera (or of any target), with its account.
   * @param {{ host: string, port: number | null, scheme: string }} target - Where.
   * @returns {import('./dahua/client.js').DahuaClient} The client.
   */
  const clientOf = (target) =>
    pool.get({
      host: target.host,
      port: target.port,
      scheme: target.scheme,
      ...accountFor(config, target.host),
    });

  /**
   * Ask Gladys to re-pull a widget: at most once per 10 s, the last call of a
   * burst is delayed rather than lost (a detection must reach the widget).
   * @param {string} key - The widget key.
   */
  function refreshWidget(key) {
    const wait = WIDGET_REFRESH_MIN_MS - (now() - (widgetRefreshAt.get(key) ?? 0));
    if (wait > 0) {
      if (!widgetRefreshPending.has(key)) {
        widgetRefreshPending.set(
          key,
          timers.setTimeout(() => {
            widgetRefreshPending.delete(key);
            refreshWidget(key);
          }, wait),
        );
      }
      return;
    }
    widgetRefreshAt.set(key, now());
    try {
      gladys.requestWidgetRefresh(key);
    } catch (error) {
      logger.debug(`Widget refresh not sent: ${error.message}`);
    }
  }

  /**
   * Report the connection status of the integration, when it changed.
   * @returns {Promise<void>}
   */
  async function reportStatus() {
    let connected;
    let message;
    const list = cameras();
    if (!isConfigured(config)) {
      connected = false;
      message = all('statusNoPassword');
    } else if (list.length === 0) {
      connected = true;
      message = all('statusNoDevice');
    } else {
      const authNames = list
        .filter((camera) => addressErrors.get(addressKey(camera)) === 'auth')
        .map((c) => c.name);
      const offline = list.filter((camera) => online.get(camera.externalId) === false);
      if (authNames.length > 0) {
        connected = false;
        message = all('statusAuth', { names: authNames.slice(0, 4).join(', ') });
      } else if (offline.length > 0) {
        connected = offline.length < list.length;
        message = all('statusPartial', {
          offline: offline.length,
          total: list.length,
          names: offline
            .slice(0, 4)
            .map((camera) => camera.name)
            .join(', '),
        });
      } else {
        connected = true;
        message = all('statusConnected', {
          online: list.filter((camera) => online.get(camera.externalId) === true).length,
          total: list.length,
        });
      }
    }
    const signature = JSON.stringify([connected, message]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, message);
    } catch (error) {
      lastStatus = null;
      logger.warn(`Connection status not reported: ${error.message}`);
    }
  }

  // --- Images --------------------------------------------------------------------------------

  /**
   * Capture a camera, sharing a capture already in flight.
   * @param {object} camera - The camera (`describe()` output).
   * @returns {Promise<Buffer>} The JPEG.
   */
  function capture(camera) {
    const running = capturesInFlight.get(camera.externalId);
    if (running) {
      return running;
    }
    const promise = snapshot(clientOf(camera), camera.channel, { encode }).finally(() =>
      capturesInFlight.delete(camera.externalId),
    );
    capturesInFlight.set(camera.externalId, promise);
    return promise;
  }

  /**
   * Capture and publish the image of a camera (dashboard), within the rate of Gladys.
   * @param {object} camera - The camera.
   * @param {object} [options] - `{ force }`: ignore the minimum interval.
   * @returns {Promise<Buffer | null>} The JPEG, or null when skipped.
   */
  async function publishImage(camera, { force = false } = {}) {
    const last = lastImageAt.get(camera.externalId) ?? 0;
    if (!force && now() - last < IMAGE_MIN_INTERVAL_MS) {
      return null;
    }
    const jpeg = await capture(camera);
    lastImageAt.set(camera.externalId, now());
    await gladys.publishCameraImage(camera.externalId, toGladysImage(jpeg));
    return jpeg;
  }

  /**
   * Refresh every image, one camera at a time (a recorder serves them all).
   * @returns {Promise<{ ok: number, failed: number }>} The counts.
   */
  async function refreshImages() {
    let ok = 0;
    let failed = 0;
    for (const camera of cameras()) {
      if (
        online.get(camera.externalId) === false ||
        addressErrors.get(addressKey(camera)) === 'auth'
      ) {
        failed += 1;
        continue;
      }
      try {
        await publishImage(camera, { force: true });
        ok += 1;
      } catch (error) {
        failed += 1;
        logger.debug(`Image of "${camera.name}" not refreshed: ${error.message}`);
      }
    }
    return { ok, failed };
  }

  function scheduleRefresh() {
    if (refreshTimer) {
      timers.clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (config.imageRefreshSeconds > 0 && !stopped) {
      refreshTimer = timers.setInterval(() => {
        refreshImages().catch((error) => logger.warn(`Image refresh failed: ${error.message}`));
      }, config.imageRefreshSeconds * 1000);
      refreshTimer.unref?.();
    }
  }

  /**
   * Keep an image for the detections widget (smaller, the list shows thumbnails).
   * @param {Buffer} jpeg - The image.
   * @returns {Promise<string>} Its key.
   */
  async function keepWidgetImage(jpeg) {
    let thumbnail = jpeg;
    try {
      thumbnail = await encode(jpeg, THUMBNAIL_WIDTH, 8, 8000);
    } catch (error) {
      logger.debug(`Thumbnail not made, the full image is kept: ${error.message}`);
    }
    imageCounter += 1;
    const key = `det-${now().toString(36)}-${imageCounter.toString(36)}`;
    widgetImages.set(key, thumbnail);
    while (widgetImages.size > MAX_WIDGET_IMAGES) {
      widgetImages.delete(widgetImages.keys().next().value);
    }
    return key;
  }

  /**
   * A new detection: image of the camera (dashboard, notification, widget).
   * @param {object} entry - The history entry.
   * @param {object} camera - The camera.
   */
  function onDetection(entry, camera) {
    refreshWidget(WIDGETS.DETECTIONS);
    refreshWidget(WIDGETS.CAMERAS);
    if (!config.snapshotOnDetection || !IMAGE_KINDS.has(entry.kind)) {
      return;
    }
    capture(camera)
      .then(async (jpeg) => {
        lastImageAt.set(camera.externalId, now());
        await gladys.publishCameraImage(camera.externalId, toGladysImage(jpeg));
        entry.imageKey = await keepWidgetImage(jpeg);
        refreshWidget(WIDGETS.DETECTIONS);
      })
      .catch((error) =>
        logger.debug(`No image for the detection of "${camera.name}": ${error.message}`),
      );
  }

  // --- States --------------------------------------------------------------------------------

  /**
   * Read the switches of a camera and publish the ones that changed.
   * @param {object} camera - The camera.
   * @returns {Promise<void>}
   */
  async function publishSwitches(camera) {
    const motion = camera.capabilities.includes(CAPABILITIES.MOTION_DETECTION);
    const privacy = camera.capabilities.includes(CAPABILITIES.PRIVACY);
    if (!motion && !privacy) {
      return;
    }
    const values = await readSwitches(clientOf(camera), camera.index, { motion, privacy });
    const states = [];
    if (motion && values.motionDetection !== null) {
      states.push({
        device_feature_external_id: featureId(camera.externalId, FEATURES.MOTION_DETECTION),
        state: values.motionDetection ? 1 : 0,
      });
    }
    if (privacy && values.privacy !== null) {
      states.push({
        device_feature_external_id: featureId(camera.externalId, FEATURES.ENABLED),
        state: values.privacy ? 0 : 1,
      });
    }
    if (states.length > 0) {
      await gladys.publishChangedStates(states, { heartbeat: 60 * 60 * 1000 });
    }
  }

  /**
   * Everything of a camera just created: Gladys dropped the states sent before.
   * @param {object} camera - The camera.
   * @returns {Promise<void>}
   */
  async function publishAll(camera) {
    const keys = [FEATURES.MOTION];
    if (camera.capabilities.includes(CAPABILITIES.SMART_MOTION))
      keys.push(FEATURES.PERSON, FEATURES.VEHICLE);
    if (camera.capabilities.includes(CAPABILITIES.TRIPWIRE)) keys.push(FEATURES.TRIPWIRE);
    if (camera.capabilities.includes(CAPABILITIES.INTRUSION)) keys.push(FEATURES.INTRUSION);
    if (camera.capabilities.includes(CAPABILITIES.DOORBELL)) keys.push(FEATURES.DOORBELL);
    await gladys.publishChangedStates(
      keys.map((key) => ({
        device_feature_external_id: featureId(camera.externalId, key),
        state: 0,
      })),
    );
    await publishSwitches(camera).catch((error) =>
      logger.debug(`Switches of "${camera.name}": ${error.message}`),
    );
    await publishImage(camera, { force: true }).catch((error) =>
      logger.debug(`First image of "${camera.name}": ${error.message}`),
    );
  }

  // --- Event streams -------------------------------------------------------------------------

  /**
   * One event stream per address of the created cameras; streams of addresses
   * no longer used are stopped.
   */
  function syncStreams() {
    const groups = new Map();
    if (isConfigured(config) && !stopped) {
      for (const camera of cameras()) {
        const key = addressKey(camera);
        if (!groups.has(key)) {
          groups.set(key, { target: camera, externalIds: [] });
        }
        groups.get(key).externalIds.push(camera.externalId);
      }
    }
    for (const [key, entry] of streams) {
      if (!groups.has(key)) {
        entry.stream.stop();
        streams.delete(key);
      }
    }
    for (const [key, group] of groups) {
      const existing = streams.get(key);
      if (existing) {
        existing.externalIds = group.externalIds;
        continue;
      }
      const entry = { externalIds: group.externalIds, stream: null };
      for (const externalId of group.externalIds) {
        if (!online.has(externalId)) {
          online.set(externalId, null);
        }
      }
      entry.stream = new EventStream({
        client: clientOf(group.target),
        logger,
        sleep: deps.sleep,
        onEvent: (event) => {
          const list = entry.externalIds.map(cameraByExternalId).filter(Boolean);
          const camera = list.find((item) => item.index === event.index);
          // Storage events speak for the whole device: the first camera carries them.
          const target = camera ?? (/^Storage/.test(event.code) ? list[0] : null);
          detections.handle(event, target);
        },
        onStatus: (connected, error) => onStreamStatus(key, entry, connected, error),
      });
      streams.set(key, entry);
      entry.stream
        .start()
        .catch((error) => logger.warn(`Event stream of ${key} stopped: ${error.message}`));
    }
  }

  /**
   * An event stream connected or was lost.
   * @param {string} key - The address key.
   * @param {object} entry - The stream entry.
   * @param {boolean} connected - Its new state.
   * @param {Error} [error] - Why it was lost.
   */
  function onStreamStatus(key, entry, connected, error) {
    if (connected) {
      addressErrors.delete(key);
    } else {
      addressErrors.set(key, error instanceof DahuaAuthError ? 'auth' : 'unreachable');
      detections.reset(entry.externalIds);
      if (!(error instanceof DahuaAuthError && error.paused)) {
        logger.warn(`${key}: events unavailable (${error?.message ?? 'closed'})`);
      }
    }
    for (const externalId of entry.externalIds) {
      const before = online.get(externalId);
      online.set(externalId, connected);
      const camera = cameraByExternalId(externalId);
      if (!camera || before === connected) {
        continue;
      }
      // Fired on changes after a known state only: a camera already off when
      // the integration starts is not news.
      if (connected === false && before === true) {
        gladys
          .publishSceneEvent(TRIGGERS.CONNECTION_LOST, {
            camera: externalId,
            camera_name: camera.name,
            reason: String(error?.message ?? '').slice(0, 200),
          })
          .catch((err) => logger.warn(`Scene event not published: ${err.message}`));
      } else if (connected === true && before === false) {
        gladys
          .publishSceneEvent(TRIGGERS.CONNECTION_RESTORED, {
            camera: externalId,
            camera_name: camera.name,
          })
          .catch((err) => logger.warn(`Scene event not published: ${err.message}`));
      }
    }
    refreshWidget(WIDGETS.CAMERAS);
    reportStatus();
  }

  function stopStreams() {
    for (const entry of streams.values()) {
      entry.stream.stop();
    }
    streams.clear();
  }

  // --- Scan ----------------------------------------------------------------------------------

  /**
   * The DHIP replies of the network (Gladys broadcasts the request for us).
   * @returns {Promise<object[]>} The devices that answered.
   */
  async function searchNetwork() {
    try {
      const replies = await gladys.scanNetwork('udp-active-broadcast', {
        port: DISCOVERY_PORT,
        payload: buildProbe(),
        timeoutSeconds: SCAN_TIMEOUT_SECONDS,
      });
      lastReplies = parseReplies(replies);
    } catch (error) {
      // 429: one scan per 10 s per integration; the previous answer is still good.
      logger.debug(`Network search unavailable: ${error.message}`);
    }
    return lastReplies;
  }

  /**
   * Every address to probe: network search, configuration, created cameras.
   * @returns {Promise<object[]>} `{ host, port, scheme, hint }`, one per address.
   */
  async function targets() {
    const found = new Map();
    const add = (target, hint = null) => {
      const key = addressKey(target);
      if (!found.has(key)) {
        found.set(key, { host: target.host, port: target.port, scheme: target.scheme, hint });
      }
    };
    for (const target of config.targets) {
      add(target);
    }
    const hosts = new Set([...found.values()].map((target) => target.host.toLowerCase()));
    for (const reply of await searchNetwork()) {
      // An address typed by the user wins (it may carry another port or HTTPS).
      if (!hosts.has(reply.host.toLowerCase())) {
        add({ host: reply.host, port: reply.httpPort, scheme: 'http' }, reply);
        hosts.add(reply.host.toLowerCase());
      }
    }
    for (const camera of cameras()) {
      if (!hosts.has(camera.host.toLowerCase())) {
        add(camera);
        hosts.add(camera.host.toLowerCase());
      }
    }
    return [...found.values()];
  }

  /**
   * Probe every address and build the devices.
   * @param {object} [options] - `{ force }`: ask even a camera that refused the password recently.
   * @returns {Promise<{ devices: object[], report: object[] }>} The devices and one line per address.
   */
  async function scan({ force = false } = {}) {
    const list = await targets();
    const report = await mapLimit(list, PROBE_PARALLEL, async (target) => {
      const client = clientOf(target);
      const account = accountFor(config, target.host);
      const address = `${target.host}${target.port && target.port !== 80 ? `:${target.port}` : ''}`;
      try {
        const host = await probeHost(client, target.hint ?? {}, { force });
        addressErrors.delete(addressKey(target));
        const devices = buildDevices(
          gladys,
          host,
          { host: target.host, port: client.port, scheme: client.scheme, ...account },
          config.stream,
        );
        return { address, host, devices };
      } catch (error) {
        if (error instanceof DahuaAuthError) {
          addressErrors.set(addressKey(target), 'auth');
          return { address, error: error.paused ? 'paused' : 'auth', user: account.username };
        }
        if (error instanceof DahuaUnreachableError) {
          return { address, error: 'unreachable', reason: error.networkCode || error.message };
        }
        return { address, error: 'other', reason: error.message };
      }
    });
    const devices = report.flatMap((line) => line.devices ?? []);
    lastScan = { at: now(), devices, report };
    return lastScan;
  }

  /**
   * The test report, in every language.
   * @param {object[]} report - The scan report.
   * @returns {object} The multi-language text.
   */
  function reportText(report) {
    return each((language) => {
      if (report.length === 0) {
        return t('testNothing', language);
      }
      const lines = report.map((line) => {
        if (line.host) {
          const extras = [
            line.host.channels.some((channel) => channel.ptz) ? t('extraPtz', language) : '',
            line.host.channels.some((channel) => channel.smartMotion)
              ? t('extraSmart', language)
              : '',
            line.host.channels.some((channel) => channel.tripwire || channel.intrusion)
              ? t('extraIvs', language)
              : '',
            line.host.doorbell ? t('extraDoorbell', language) : '',
            line.host.channels.some((channel) => channel.privacy !== null)
              ? t('extraPrivacy', language)
              : '',
          ].join('');
          return t('testHostOk', language, {
            address: line.address,
            model: line.host.model || line.host.deviceClass || '?',
            name: line.host.name,
            channels: line.host.channels.length,
            extras,
          });
        }
        if (line.error === 'auth') {
          return t('testHostAuth', language, { address: line.address, user: line.user });
        }
        if (line.error === 'paused') {
          return t('testHostPaused', language, { address: line.address });
        }
        if (line.error === 'unreachable') {
          return t('testHostUnreachable', language, { address: line.address, reason: line.reason });
        }
        return t('testHostError', language, { address: line.address, reason: line.reason });
      });
      if (config.invalidAddresses.length > 0) {
        lines.push(t('testInvalid', language, { list: config.invalidAddresses.join(', ') }));
      }
      return lines.join('\n');
    }, MAX_ACTION_TEXT);
  }

  // --- Handlers ------------------------------------------------------------------------------

  gladys.onScanRequest(async () => {
    if (!isConfigured(config)) {
      await reportStatus();
      await gladys.publishDiscoveredDevices([]);
      return;
    }
    const result =
      lastScan && now() - lastScan.at < (deps.scanCacheMs ?? SCAN_CACHE_MS)
        ? lastScan
        : await scan();
    await gladys.publishDiscoveredDevices(result.devices);
    lastScan = null;
    await reportStatus();
  });

  gladys.onGetImage(async (device) => {
    const camera = describe(device);
    if (!camera) {
      throw new Error('DAHUA_DEVICE_UNKNOWN');
    }
    const jpeg = await capture(camera);
    lastImageAt.set(camera.externalId, now());
    return toGladysImage(jpeg);
  });

  gladys.onPoll(async (device) => {
    const camera = describe(device);
    if (camera && addressErrors.get(addressKey(camera)) !== 'auth') {
      await publishSwitches(camera);
    }
  });

  gladys.onSetValue(async (device, feature, value) => {
    const camera = describe(device);
    if (!camera) {
      throw new Error('DAHUA_DEVICE_UNKNOWN');
    }
    const client = clientOf(camera);
    const key = featureKey(feature.external_id);
    const number = Number(value);
    if (key === FEATURES.MOTION_DETECTION) {
      await setMotionDetection(client, camera.index, number === 1);
      await gladys.publishChangedStates([
        { device_feature_external_id: feature.external_id, state: number ? 1 : 0 },
      ]);
    } else if (key === FEATURES.ENABLED) {
      await setPrivacy(client, camera.index, number !== 1);
      await gladys.publishChangedStates([
        { device_feature_external_id: feature.external_id, state: number ? 1 : 0 },
      ]);
    } else if (key === FEATURES.PTZ_MOVE) {
      await ptzStep(client, camera.channel, number, { sleep: deps.sleep });
    } else if (key === FEATURES.PTZ_PRESET) {
      if (!Number.isInteger(number) || number < 1) {
        throw new Error(`DAHUA_PRESET_INVALID:${value}`);
      }
      await gotoPreset(client, camera.channel, number);
    } else {
      throw new Error(`DAHUA_FEATURE_READ_ONLY:${key}`);
    }
  });

  gladys.onDeviceCreated(async (device) => {
    await gladys.getDevices().catch(() => {});
    syncStreams();
    const camera = describe(device);
    if (camera) {
      await publishAll(camera);
    }
    refreshWidget(WIDGETS.CAMERAS);
    await reportStatus();
  });

  gladys.onDeviceUpdated(async () => {
    await gladys.getDevices().catch(() => {});
    syncStreams();
  });

  gladys.onDeviceDeleted(async (device) => {
    await gladys.getDevices().catch(() => {});
    online.delete(device.external_id);
    syncStreams();
    refreshWidget(WIDGETS.CAMERAS);
    await reportStatus();
  });

  gladys.onConfigUpdated(async (raw) => {
    config = normalizeConfig(raw);
    pool.clear();
    addressErrors.clear();
    lastScan = null;
    stopStreams();
    syncStreams();
    scheduleRefresh();
    lastStatus = null;
    await reportStatus();
  });

  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    if (!isConfigured(config)) {
      return all('statusNoPassword');
    }
    const { report } = await scan({ force: true });
    // A password fixed after a refusal: restart the streams that were stopped on it.
    stopStreams();
    syncStreams();
    lastStatus = null;
    await reportStatus();
    return reportText(report);
  });

  gladys.onAction(ACTIONS.REFRESH_IMAGES, async () => {
    if (cameras().length === 0) {
      return all('noDevice');
    }
    return all('refreshDone', await refreshImages());
  });

  /**
   * The camera of a scene action field.
   * @param {string} externalId - The selected device.
   * @returns {object} The camera.
   */
  function sceneCamera(externalId) {
    const camera = cameraByExternalId(externalId);
    if (!camera) {
      throw new Error(t('unknownCamera', 'en'));
    }
    return camera;
  }

  gladys.onSceneAction(SCENE_ACTIONS.TAKE_SNAPSHOT, async (fields = {}) => {
    const camera = sceneCamera(fields.camera);
    const jpeg = await publishImage(camera, { force: true });
    return { captured_at: new Date(now()).toISOString(), size_kb: Math.round(jpeg.length / 1024) };
  });

  gladys.onSceneAction(SCENE_ACTIONS.SET_RECORDING, async (fields = {}) => {
    const camera = sceneCamera(fields.camera);
    await setRecordMode(clientOf(camera), camera.index, fields.mode);
  });

  gladys.onSceneAction(SCENE_ACTIONS.OPEN_DOOR, async (fields = {}) => {
    const camera = sceneCamera(fields.camera);
    if (camera.kind !== KINDS.DOORBELL) {
      throw new Error(t('notDoorbell', 'en'));
    }
    await openDoor(clientOf(camera), Math.max(1, Math.round(Number(fields.door) || 1)));
  });

  gladys.onSceneAction(SCENE_ACTIONS.REBOOT, async (fields = {}) => {
    const camera = sceneCamera(fields.camera);
    await reboot(clientOf(camera));
  });

  gladys.onWidgetGet(WIDGETS.CAMERAS, async ({ language }) =>
    buildCamerasWidget({
      cameras: cameras().map((camera) => ({
        externalId: camera.externalId,
        name: camera.name,
        online:
          addressErrors.get(addressKey(camera)) === 'auth'
            ? false
            : (online.get(camera.externalId) ?? null),
      })),
      history: detections.history,
      language,
      now: now(),
    }),
  );

  gladys.onWidgetGet(WIDGETS.DETECTIONS, async ({ settings = {}, language }) => {
    const count = Math.min(
      DETECTIONS_COUNT.max,
      Math.max(
        DETECTIONS_COUNT.min,
        Math.round(Number(settings.count) || DETECTIONS_COUNT.default),
      ),
    );
    return buildDetectionsWidget({
      history: detections.history,
      camera: settings.camera || null,
      count,
      language,
      now: now(),
    });
  });

  gladys.onWidgetGet(WIDGETS.STORAGE, async ({ settings = {}, language }) => {
    const camera = settings.camera ? cameraByExternalId(settings.camera) : cameras()[0];
    if (!camera) {
      return messageContent(t(settings.camera ? 'unknownCamera' : 'storageChoose', language));
    }
    try {
      const storage = await readStorage(clientOf(camera));
      return buildStorageWidget({ storage, cameraName: camera.name, language });
    } catch (error) {
      return buildStorageWidget({ error: error.message, language });
    }
  });

  gladys.onWidgetGetImage(async (key) => {
    const image = widgetImages.get(key);
    if (!image || !isJpeg(image)) {
      throw new Error('DAHUA_IMAGE_EXPIRED');
    }
    return image.toString('base64');
  });

  gladys.onWidgetAction(WIDGETS.CAMERAS, async (actionKey) => {
    if (actionKey !== WIDGET_ACTIONS.REFRESH_IMAGES) {
      throw new Error(`Unknown action ${actionKey}`);
    }
    if (cameras().length === 0) {
      return all('noDevice');
    }
    return all('refreshDone', await refreshImages());
  });

  // --- Lifecycle -----------------------------------------------------------------------------

  gladys.on('connected', async () => {
    config = normalizeConfig(gladys.config ?? {});
    await gladys.getDevices().catch(() => {});
    pool.clear();
    stopStreams();
    syncStreams();
    scheduleRefresh();
    lastStatus = null;
    await reportStatus();
  });

  /** Stop everything (shutdown, tests). */
  function stop() {
    stopped = true;
    stopStreams();
    detections.stop();
    if (refreshTimer) {
      timers.clearInterval(refreshTimer);
    }
    for (const timer of widgetRefreshPending.values()) {
      timers.clearTimeout(timer);
    }
    widgetRefreshPending.clear();
  }

  gladys.handleShutdown((signal) => {
    logger.info(`Received ${signal}, stopping`);
    stop();
  });

  return { scan, streams, online, detections, widgetImages, refreshImages, syncStreams, stop };
}
