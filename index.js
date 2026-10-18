// -----------------------------------------------------------------------------
// Entry point of the Amcrest / Dahua external integration.
//
// Brings the cameras, doorbells and recorders built on Dahua firmware (Dahua,
// Amcrest, Lorex, Imou…) into Gladys, over the local network only:
//   - one device per camera: image, live view (RTSP), motion, person and
//     vehicle detection, IVS rules, doorbell, motion detection switch, privacy
//     mode and PTZ (src/devices.js);
//   - instant events through the camera's own event stream (src/dahua/events.js);
//   - scene triggers, scene actions and dashboard widgets (src/app.js).
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

logger.info(`Starting the Amcrest / Dahua integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
