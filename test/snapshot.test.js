import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fits,
  shrink,
  snapshot,
  stripTrailer,
  toGladysImage,
  IMAGE_MAX_ENCODED,
} from '../src/dahua/snapshot.js';
import { DahuaClient } from '../src/dahua/client.js';
import { createFakeDevice, createFakeNetwork, fakeJpeg } from './helpers/fake-camera.js';

const clientOf = (device) =>
  new DahuaClient({
    host: '10.0.0.2',
    username: 'admin',
    password: 'secret',
    send: createFakeNetwork({ '10.0.0.2': device }).send,
  });

test('the dhav trailer of a VTO is cut, a clean JPEG is untouched', () => {
  const dirty = fakeJpeg(1000, true);
  const clean = stripTrailer(dirty);
  assert.equal(clean.length, dirty.length - 8);
  assert.deepEqual([...clean.subarray(-2)], [0xff, 0xd9]);
  const plain = fakeJpeg(2000);
  assert.equal(stripTrailer(plain), plain);
  assert.equal(toGladysImage(Buffer.from('ab')), 'image/jpg;base64,YWI=');
});

test('a small snapshot is published as is; a big one is re-encoded until it fits', async () => {
  const small = await snapshot(clientOf(createFakeDevice({ snapshotTrailer: true })), 1);
  assert.equal(small.length, 20_000);
  const calls = [];
  const encode = async (jpeg, width, quality) => {
    calls.push([width, quality]);
    return fakeJpeg(calls.length < 3 ? 200_000 : 50_000);
  };
  const big = await snapshot(clientOf(createFakeDevice({ snapshotSize: 400_000 })), 1, { encode });
  assert.ok(fits(big));
  assert.equal(calls.length, 3);
  assert.ok(Math.ceil(big.length / 3) * 4 <= IMAGE_MAX_ENCODED);
  await assert.rejects(
    shrink(fakeJpeg(400_000), { encode: async () => fakeJpeg(400_000) }),
    /IMAGE_TOO_LARGE/,
  );
  await assert.rejects(snapshot(clientOf(createFakeDevice()), 3), /HTTP 400/);
});
