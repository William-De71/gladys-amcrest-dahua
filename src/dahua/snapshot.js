// -----------------------------------------------------------------------------
// Camera images: snapshot.cgi, cleaned, shrunk to what Gladys accepts.
//
// A Dahua snapshot is a ready-made JPEG, but:
//   - some devices (VTO doorbells) append a `dhav` block after the end-of-image
//     marker, which strict decoders refuse: it is cut off;
//   - a 4K or even 4 MP frame weighs several hundred kilobytes, above the
//     150 KB of a Gladys camera image: ffmpeg (shipped in the image) re-encodes
//     it smaller, through pipes only (the rootfs is read-only).
// -----------------------------------------------------------------------------

import { spawn } from 'node:child_process';

/** Gladys refuses an image above 150 KB once base64-encoded; keep a margin. */
export const IMAGE_MAX_ENCODED = 140 * 1024;
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);
const TRAILER = Buffer.from('dhav', 'latin1');

/** Re-encode steps, `[width, -qscale:v]`, tried in order until the image fits. */
const RESIZE_STEPS = [
  [1280, 6],
  [1280, 12],
  [1024, 12],
  [960, 18],
  [800, 20],
  [640, 22],
];

/**
 * Tell whether an image fits once encoded.
 * @param {Buffer} jpeg - The bytes.
 * @returns {boolean} True when small enough.
 * @example
 * fits(jpeg);
 */
export function fits(jpeg) {
  return Math.ceil(jpeg.length / 3) * 4 <= IMAGE_MAX_ENCODED;
}

/**
 * Cut the `dhav` trailer some devices add after the JPEG.
 * @param {Buffer} data - The snapshot.
 * @returns {Buffer} The JPEG alone (unchanged when there is nothing to cut).
 * @example
 * stripTrailer(snapshot);
 */
export function stripTrailer(data) {
  if (!data.subarray(0, 2).equals(JPEG_SOI) || data.subarray(-2).equals(JPEG_EOI)) {
    return data;
  }
  const end = data.lastIndexOf(JPEG_EOI);
  if (end < 0 || !data.subarray(end + 2, end + 6).equals(TRAILER)) {
    return data;
  }
  return data.subarray(0, end + 2);
}

/**
 * Tell whether bytes are a JPEG.
 * @param {Buffer} data - The bytes.
 * @returns {boolean} True when they start like one.
 * @example
 * isJpeg(data);
 */
export function isJpeg(data) {
  return Buffer.isBuffer(data) && data.length > 4 && data.subarray(0, 2).equals(JPEG_SOI);
}

/**
 * Re-encode a JPEG with ffmpeg, through pipes.
 * @param {Buffer} image - The source.
 * @param {number} width - The target width.
 * @param {number} quality - `-qscale:v` (2 best, 31 worst).
 * @param {number} timeoutMs - Kill ffmpeg after this delay.
 * @returns {Promise<Buffer>} The new JPEG.
 * @example
 * await reencode(jpeg, 1024, 12, 8000);
 */
export function reencode(image, width, quality, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      '-',
      '-vf',
      `scale='min(${width},iw)':-2`,
      '-qscale:v',
      String(quality),
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      '-',
    ]);
    const chunks = [];
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => ffmpeg.kill('SIGKILL'), timeoutMs);
    const settle = (error, result) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    };
    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-300);
    });
    ffmpeg.on('error', (error) =>
      settle(
        new Error(error.code === 'ENOENT' ? 'FFMPEG_NOT_FOUND' : `FFMPEG_FAILED: ${error.message}`),
      ),
    );
    ffmpeg.on('close', () => {
      const output = Buffer.concat(chunks);
      if (output.length > 0) {
        settle(null, output);
      } else {
        settle(new Error(`FFMPEG_NO_OUTPUT: ${stderr.trim()}`));
      }
    });
    // ffmpeg may close stdin before reading everything: not a failure.
    ffmpeg.stdin.on('error', () => {});
    ffmpeg.stdin.end(image);
  });
}

/**
 * Bring an image under the limit.
 * @param {Buffer} jpeg - The snapshot.
 * @param {object} [options] - `{ encode, timeoutMs }` (`encode` replaces ffmpeg in the tests).
 * @returns {Promise<Buffer>} A JPEG that fits.
 * @example
 * await shrink(jpeg);
 */
export async function shrink(jpeg, { encode = reencode, timeoutMs = 8000 } = {}) {
  if (fits(jpeg)) {
    return jpeg;
  }
  for (const [width, quality] of RESIZE_STEPS) {
    const candidate = await encode(jpeg, width, quality, timeoutMs);
    if (fits(candidate)) {
      return candidate;
    }
  }
  throw new Error(`IMAGE_TOO_LARGE: ${jpeg.length} bytes`);
}

/**
 * Take a snapshot of a channel, ready for Gladys.
 * @param {import('./client.js').DahuaClient} client - The client.
 * @param {number} channel - The channel number (1-based).
 * @param {object} [options] - `{ encode, timeoutMs }`.
 * @returns {Promise<Buffer>} The JPEG.
 * @example
 * const jpeg = await snapshot(client, 1);
 */
export async function snapshot(client, channel, options = {}) {
  const data = stripTrailer(
    await client.bytes(`/cgi-bin/snapshot.cgi?channel=${channel}`, {
      timeoutMs: options.timeoutMs ?? 10000,
    }),
  );
  if (!isJpeg(data)) {
    throw new Error('NOT_A_JPEG');
  }
  return shrink(data, options);
}

/**
 * The Gladys format of an image.
 * @param {Buffer} jpeg - The JPEG.
 * @returns {string} `image/jpg;base64,…`.
 * @example
 * toGladysImage(jpeg);
 */
export function toGladysImage(jpeg) {
  return `image/jpg;base64,${jpeg.toString('base64')}`;
}
