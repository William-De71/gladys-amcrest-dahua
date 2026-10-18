// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> <images dir> (run by render.sh)
//
// Made-up installation (fixed date: Sunday 18 October 2026, 20:00 in Paris):
// a doorbell, two cameras and a four-channel recorder, one camera offline;
// a few detections of the evening, with the drawn images of
// docs/illustrations/scenes (not camera pictures: illustrations).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out, images] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildCamerasWidget, buildDetectionsWidget, buildStorageWidget } =
  await load('src/widgets.js');
const { LANGUAGES } = await load('src/i18n.js');
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

const NOW = Date.parse('2026-10-18T18:00:00Z');
const MIN = 60_000;
const NAMES = {
  en: ['Front door', 'Garden', 'Drive', 'Garage', 'Back yard'],
  fr: ['Porte d’entrée', 'Jardin', 'Allée', 'Garage', 'Arrière-cour'],
  de: ['Haustür', 'Garten', 'Einfahrt', 'Garage', 'Hinterhof'],
  es: ['Puerta principal', 'Jardín', 'Entrada', 'Garaje', 'Patio trasero'],
};
const ids = ['door', 'garden', 'drive', 'garage', 'yard'].map(
  (id) => `ext:amcrest-dahua:camera:${id}`,
);

const contents = {};
for (const language of LANGUAGES) {
  const names = NAMES[language];
  const cameras = names.map((name, index) => ({
    externalId: ids[index],
    name,
    online: index !== 3,
  }));
  const history = [
    {
      at: NOW - 2 * MIN,
      camera: ids[1],
      cameraName: names[1],
      kind: 'person',
      rule: '',
      objectType: '',
      imageKey: 'person',
    },
    {
      at: NOW - 47 * MIN,
      camera: ids[2],
      cameraName: names[2],
      kind: 'vehicle',
      rule: '',
      objectType: '',
      imageKey: 'vehicle',
    },
    {
      at: NOW - 95 * MIN,
      camera: ids[4],
      cameraName: names[4],
      kind: 'tripwire',
      rule: 'Fence',
      objectType: 'Human',
      imageKey: null,
    },
    {
      at: NOW - 417 * MIN,
      camera: ids[0],
      cameraName: names[0],
      kind: 'doorbell',
      rule: '',
      objectType: '',
      imageKey: 'doorbell',
    },
    {
      at: NOW - 30 * 60 * MIN,
      camera: ids[1],
      cameraName: names[1],
      kind: 'motion',
      rule: '',
      objectType: '',
      imageKey: null,
    },
  ];
  contents[language] = {
    cameras: buildCamerasWidget({ cameras, history, language, now: NOW }),
    detections: buildDetectionsWidget({ history, count: 4, language, now: NOW }),
    storage: buildStorageWidget({
      storage: { disks: 2, totalBytes: 8e12, usedBytes: 5.93e12, faulty: 0 },
      cameraName: 'NVR · DHI-NVR4208-4KS3',
      language,
    }),
  };
}
const widgets = Object.fromEntries(
  manifest.widgets.map((widget) => [widget.key, { icon: widget.icon, label: widget.label }]),
);
const picture = (name) =>
  `data:image/png;base64,${readFileSync(`${images}/${name}.png`).toString('base64')}`;
writeFileSync(
  out,
  JSON.stringify({
    now: NOW,
    widgets,
    contents,
    images: {
      person: picture('person'),
      vehicle: picture('vehicle'),
      doorbell: picture('doorbell'),
    },
  }),
);
