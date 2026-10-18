// -----------------------------------------------------------------------------
// What Gladys can change on a camera: motion detection, privacy mode, PTZ,
// recording mode, door of a doorbell, reboot — and the storage it reads.
// -----------------------------------------------------------------------------

import { indexedTable, toBool } from './kv.js';

/** The movements of the Gladys `camera` / `move` feature. */
export const CAMERA_MOVE = {
  STOP: 0,
  PAN_LEFT: 1,
  PAN_RIGHT: 2,
  TILT_UP: 3,
  TILT_DOWN: 4,
  ZOOM_IN: 5,
  ZOOM_OUT: 6,
};
const PTZ_CODES = {
  [CAMERA_MOVE.PAN_LEFT]: 'Left',
  [CAMERA_MOVE.PAN_RIGHT]: 'Right',
  [CAMERA_MOVE.TILT_UP]: 'Up',
  [CAMERA_MOVE.TILT_DOWN]: 'Down',
  [CAMERA_MOVE.ZOOM_IN]: 'ZoomTele',
  [CAMERA_MOVE.ZOOM_OUT]: 'ZoomWide',
};
/** How long one step moves: ptz.cgi has no relative step, only start / stop. */
export const PTZ_STEP_MS = 600;
const PTZ_SPEED = 4;

/** The recording modes of RecordMode[ch].Mode. */
export const RECORD_MODES = { auto: 0, manual: 1, off: 2 };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Move a camera by one step, then stop it — whatever happens in between.
 * @param {import('./client.js').DahuaClient} client - The client.
 * @param {number} channel - The channel number (1-based).
 * @param {number} move - A CAMERA_MOVE value.
 * @param {object} [options] - `{ sleep, stepMs }` for the tests.
 * @returns {Promise<void>} Resolves once stopped.
 * @example
 * await ptzStep(client, 1, CAMERA_MOVE.PAN_LEFT);
 */
export async function ptzStep(client, channel, move, { sleep = wait, stepMs = PTZ_STEP_MS } = {}) {
  const code = PTZ_CODES[move];
  if (!code) {
    // STOP: the steps always stop themselves, so a stop is a safety net that
    // halts every direction a lost request may have left running.
    for (const name of Object.values(PTZ_CODES)) {
      await client.command(ptzPath('stop', channel, name)).catch(() => {});
    }
    return;
  }
  await client.command(ptzPath('start', channel, code));
  try {
    await sleep(stepMs);
  } finally {
    await client.command(ptzPath('stop', channel, code));
  }
}

/**
 * The path of a PTZ command.
 * @param {string} action - `start` or `stop`.
 * @param {number} channel - The channel number.
 * @param {string} code - The movement code.
 * @param {number} [arg2] - The speed, or the preset number.
 * @returns {string} The path.
 * @example
 * ptzPath('start', 1, 'Left');
 */
export function ptzPath(action, channel, code, arg2 = PTZ_SPEED) {
  return `/cgi-bin/ptz.cgi?action=${action}&channel=${channel}&code=${code}&arg1=0&arg2=${arg2}&arg3=0`;
}

/**
 * Go to a saved position.
 * @param {import('./client.js').DahuaClient} client - The client.
 * @param {number} channel - The channel number.
 * @param {number} preset - The preset number, as the camera numbers it.
 * @returns {Promise<void>} Resolves once accepted.
 * @example
 * await gotoPreset(client, 1, 2);
 */
export async function gotoPreset(client, channel, preset) {
  await client.command(ptzPath('start', channel, 'GotoPreset', preset));
}

/**
 * Read the switches of a channel: motion detection and privacy mode.
 * @param {import('./client.js').DahuaClient} client - The client.
 * @param {number} index - The channel index (0-based).
 * @param {object} wanted - `{ motion, privacy }`: which ones the device has.
 * @returns {Promise<{ motionDetection: boolean | null, privacy: boolean | null }>} The values.
 * @example
 * await readSwitches(client, 0, { motion: true, privacy: false });
 */
export async function readSwitches(client, index, wanted) {
  const [motion, mask] = await Promise.all([
    wanted.motion ? client.getConfig('MotionDetect') : null,
    wanted.privacy ? client.getConfig('LeLensMask') : null,
  ]);
  return {
    motionDetection: motion ? toBool(indexedTable(motion, 'MotionDetect')[index]?.Enable) : null,
    privacy: mask ? toBool(indexedTable(mask, 'LeLensMask')[index]?.Enable) : null,
  };
}

/**
 * Switch motion detection on or off.
 * @param {import('./client.js').DahuaClient} client - The client.
 * @param {number} index - The channel index (0-based).
 * @param {boolean} on - The new value.
 * @returns {Promise<void>} Resolves once written.
 * @example
 * await setMotionDetection(client, 0, false);
 */
export async function setMotionDetection(client, index, on) {
  await client.setConfig({ [`MotionDetect[${index}].Enable`]: on ? 'true' : 'false' });
}

/**
 * Switch the privacy mode (Amcrest, Imou: the lens turns away).
 * @param {import('./client.js').DahuaClient} client - The client.
 * @param {number} index - The channel index (0-based).
 * @param {boolean} on - True hides the image.
 * @returns {Promise<void>} Resolves once written.
 * @example
 * await setPrivacy(client, 0, true);
 */
export async function setPrivacy(client, index, on) {
  await client.setConfig({ [`LeLensMask[${index}].Enable`]: on ? 'true' : 'false' });
}

/**
 * Set the recording mode of a channel.
 * @param {import('./client.js').DahuaClient} client - The client.
 * @param {number} index - The channel index (0-based).
 * @param {string} mode - `auto` (the schedule), `manual` (always) or `off`.
 * @returns {Promise<void>} Resolves once written.
 * @example
 * await setRecordMode(client, 0, 'manual');
 */
export async function setRecordMode(client, index, mode) {
  if (!(mode in RECORD_MODES)) {
    throw new Error(`Unknown recording mode ${mode}`);
  }
  await client.setConfig({ [`RecordMode[${index}].Mode`]: RECORD_MODES[mode] });
}

/**
 * Open the door wired to a doorbell (VTO).
 * @param {import('./client.js').DahuaClient} client - The client.
 * @param {number} door - The door number (1-based).
 * @returns {Promise<void>} Resolves once accepted.
 * @example
 * await openDoor(client, 1);
 */
export async function openDoor(client, door) {
  await client.command(
    `/cgi-bin/accessControl.cgi?action=openDoor&channel=${door}&UserID=101&Type=Remote`,
  );
}

/**
 * Reboot the device.
 * @param {import('./client.js').DahuaClient} client - The client.
 * @returns {Promise<void>} Resolves once accepted.
 * @example
 * await reboot(client);
 */
export async function reboot(client) {
  await client.command('/cgi-bin/magicBox.cgi?action=reboot');
}

/**
 * Read the storage (SD card, hard disks).
 * @param {import('./client.js').DahuaClient} client - The client.
 * @returns {Promise<{ disks: number, totalBytes: number, usedBytes: number, faulty: number }>} The totals.
 * @example
 * await readStorage(client);
 */
export async function readStorage(client) {
  const values = await client.values('/cgi-bin/storageDevice.cgi?action=getDeviceAllInfo');
  const disks = indexedTable(values, 'list.info').filter(Boolean);
  let totalBytes = 0;
  let usedBytes = 0;
  let faulty = 0;
  for (const disk of disks) {
    if (disk.State && !/^success$/i.test(disk.State)) {
      faulty += 1;
    }
    for (const [key, value] of Object.entries(disk)) {
      if (/^Detail\[\d+\]\.TotalBytes$/.test(key)) {
        totalBytes += Number(value) || 0;
      } else if (/^Detail\[\d+\]\.UsedBytes$/.test(key)) {
        usedBytes += Number(value) || 0;
      }
    }
  }
  return { disks: disks.length, totalBytes, usedBytes, faulty };
}
