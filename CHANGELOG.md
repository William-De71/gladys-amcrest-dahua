# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.2.0] - 2026-10-25

### Added

- require Gladys 5.3 and declare catalog keywords ([6bf8c94](https://github.com/William-De71/gladys-amcrest-dahua/commit/6bf8c9468d75926167ffcfaf6df204b883605462))

## [0.1.1] - 2026-10-24

### Security

- **security:** build the image on Node.js 24.22.1 or later ([aead3c2](https://github.com/William-De71/gladys-amcrest-dahua/commit/aead3c24016d5ee576210e27170ea333144d68f8))

## [0.1.0] - 2026-10-18

### Added

- Cameras, doorbells and recorders built on Dahua firmware (Dahua, Amcrest, Lorex, Imou, EmpireTech and rebranded models) over the local network only: no account, no cloud.
- Discovery without typing an address, through the DHIP search of Dahua's ConfigTool broadcast by Gladys; addresses and per-device accounts can still be entered for another VLAN.
- One device per camera (one per channel of an NVR, DVR or XVR): image, RTSP live view (main or sub stream), motion, person and vehicle (smart motion detection), tripwire and intrusion (IVS rules), doorbell, motion detection switch, privacy mode, PTZ moves and presets, each only when the device has it.
- Instant detections through the event stream of each device, kept open and reconnected after a cut.
- Scene triggers: detection (motion, person, vehicle, line crossed, intrusion, sound, tampering, doorbell), alarm (video lost, alarm input, storage failure, storage almost full, no storage), camera unreachable and camera back.
- Scene actions: take an image, recording mode (camera schedule, always, off), open the door of a VTO door station, reboot.
- Dashboard widgets: Cameras (online state and last detection of each camera, refresh button), Detections (the last detections with their image) and Recording storage (SD card or disks: used, free, health).
- Images under the 150 KB Gladys accepts (re-encoded with ffmpeg when needed), refreshed on a timer and on each detection; a refused password paused for ten minutes so the camera does not lock the account.
- English, French, German and Spanish everywhere: settings, widgets, scenes and documentation.

[0.2.0]: https://github.com/William-De71/gladys-amcrest-dahua/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/William-De71/gladys-amcrest-dahua/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/William-De71/gladys-amcrest-dahua/releases/tag/v0.1.0
