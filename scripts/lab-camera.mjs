#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Lab: the fake Dahua camera of the tests, served over real HTTP, to check the
// real transport (node:http, Digest, the multipart event stream) end to end
// without a camera.
//
//   node scripts/lab-camera.mjs [port]          # default 8099
//   then point the integration (or curl --digest -u admin:secret) at it;
//   type an event code on stdin (e.g. "VideoMotion Start") to emit it.
// -----------------------------------------------------------------------------

import http from 'node:http';
import readline from 'node:readline';
import { createFakeDevice } from '../test/helpers/fake-camera.js';

const port = Number(process.argv[2]) || 8099;
const camera = createFakeDevice({
  ptz: { pan: true, tilt: true, zoom: false },
  presets: [{ index: 1, name: 'Gate' }],
  config: {
    RTSP: { 'RTSP.Port': '554' },
    ChannelTitle: { 'ChannelTitle[0].Name': 'Lab' },
    MotionDetect: { 'MotionDetect[0].Enable': 'true' },
    SmartMotionDetect: { 'SmartMotionDetect[0].Enable': 'true' },
  },
});

const server = http.createServer(async (req, res) => {
  const answer = camera.handle({
    method: req.method,
    path: req.url,
    headers: req.headers.authorization ? { Authorization: req.headers.authorization } : {},
  });
  const headers = { ...answer.headers };
  if (answer.challenges?.length) headers['WWW-Authenticate'] = answer.challenges;
  if (answer.chunks) {
    res.writeHead(200, headers);
    req.on('close', () => answer.close());
    for await (const chunk of answer.chunks) res.write(chunk);
    res.end();
    return;
  }
  res.writeHead(answer.status, headers);
  res.end(answer.body);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Fake Dahua camera on http://127.0.0.1:${port} (admin / secret)`);
  console.log('Type "<Code> <Start|Stop|Pulse>" to emit an event, "hb" for a heartbeat.');
});
setInterval(() => camera.heartbeat(), 5000).unref();
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const [code, action = 'Pulse'] = line.trim().split(/\s+/);
  if (code === 'hb') camera.heartbeat();
  else if (code) camera.emit(`Code=${code};action=${action};index=0`);
});
