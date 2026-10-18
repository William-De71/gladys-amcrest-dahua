# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** of type `device` for the cameras,
doorbells and recorders built on **Dahua firmware** (Dahua, Amcrest, Lorex,
Imou, EmpireTech…): a Node.js service (Node 22+, ESM, no build step) in its
own sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the devices through their HTTP CGI API (`/cgi-bin/*.cgi`, Digest
authentication) on the **local network only**. Only dependency: the SDK. The
image ships `ffmpeg`, used only to shrink an oversized snapshot.

## Commands

```bash
npm install
npm test                                  # node --test, never touches the network
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check
node scripts/lab-camera.mjs               # the fake camera over real HTTP (manual check)
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                  SDK wiring only (new GladysIntegration + createApp)
src/app.js                every handler, registered before connect(): scan, images,
                          poll, set value, event streams, scene and config actions,
                          widgets, connection status
src/config.js             configuration: defaults, addresses, accounts per device
src/devices.js            probed hosts -> Gladys devices (one per channel), params
src/detections.js         events -> motion states, scene events, detection history
src/widgets.js            the three widgets (pure builders)
src/i18n.js               runtime texts (en / fr / de / es)
src/dahua/transport.js    node:http(s) transport (self-signed HTTPS, raw challenges)
src/dahua/digest.js       RFC 7616 Digest (MD5, SHA-256), Basic fallback
src/dahua/client.js       CGI client: challenge reuse, nonce races, refused-password
                          pause, two requests at a time
src/dahua/kv.js           `key=value` answers, indexed tables, `Error` bodies
src/dahua/discovery.js    DHIP probe (32-byte header) and replies
src/dahua/probe.js        identity, class, channels, abilities (SMD, IVS, privacy, PTZ)
src/dahua/events.js       eventManager attach: multipart parser (bytes), EventStream
src/dahua/snapshot.js     snapshot.cgi, `dhav` trailer, ffmpeg shrink
src/dahua/commands.js     motion detection, privacy, PTZ, recording mode, door, reboot,
                          storage
test/helpers/fake-camera.js   the fake Dahua devices (Digest, tables, events)
```

## Dahua facts (re-check against a real device when in doubt)

- Every CGI request is challenged (`401`, `WWW-Authenticate: Digest … qop="auth"`);
  a camera **locks the account 30 minutes after 5 refused logins**: never retry a
  refused password in a loop (`AUTH_PAUSE_MS`), and answer a fresh challenge only.
- Answers are `key=value` lines; a refusal is a body starting with `Error` (400 or
  200); writes answer `OK`. `configManager getConfig` keys are `table.<Name>[i]…`.
- Channels are 1-based in URLs (`snapshot.cgi?channel=1`, `ptz.cgi`), 0-based in
  tables (`MotionDetect[0]`) and in events (`index=0`).
- Events: `eventManager.cgi?action=attach&codes=[…]&heartbeat=5`, multipart parts
  `Code=X;action=Start|Stop|Pulse;index=N[;data={json}]`; a doorbell ring is
  `PhoneCallDetect` (Amcrest) or `BackKeyLight` with `State` 1 or 2 (VTO).
- DHIP discovery: UDP 37810, the JSON `DHDiscover.search` behind a 32-byte header
  (`DHIP` as bytes); bare JSON gets no answer.
- RTSP: `rtsp://user:pass@host:<RTSP.Port>/cam/realmonitor?channel=N&subtype=0|1`.

## Rules

- **External ids and keys are forever**: `gladys.externalIds('camera', serial)` (or
  `serial-ch<N>` on a recorder or a multi-channel device), the feature keys of
  `FEATURES`, the param names of `PARAMS`, and for each feature its `category`,
  `type`, `unit`, `min`, `max`; the keys of the config, the actions, the widgets,
  the triggers, their fields, options and variables, the scene actions and their
  outputs. `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json` (0.1.0): never update the baseline
  without a documented migration.
- **`should_poll` / `poll_frequency`** (60 000 ms) are never resynchronized on a
  device already created.
- **States**: changes only (`publishChangedStates` for the switches); every state of
  a camera again in `onDeviceCreated`. Scene events on the start of a detection only,
  debounced per camera and kind; never one in answer to a scene action.
- **Images**: at most one every 5 s per camera (Gladys accepts 12 a minute), under
  150 KB; captures in flight are shared.
- **The container rootfs is read-only**: nothing is written to disk (ffmpeg through
  pipes).
- **Secrets**: never log a password nor a `CAMERA_URL`.
- **Four languages** everywhere (manifest, `src/i18n.js`, docs, README);
  `test/i18n.test.js` checks it. Feature names stay English.
- **Widget images**: after any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
- **Changelog**: never edit CHANGELOG.md by hand, it is generated at the release.
  Write the PR title as the line the user will read.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why, in
  English. Tests never touch the network: the transport is replaced by the fake
  camera.
