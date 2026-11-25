import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../dist/', import.meta.url);
const requiredFiles = [
  'index.html',
  'style.css',
  'app.js',
  'sw.js',
  'bottle-scan.mjs',
  'fonts/dm-sans-latin.woff2',
  'fonts/instrument-serif-latin.woff2',
  'images/bottle-studio.webp',
  'vision/bottle-filter.json',
  'vision/efficientdet-lite0.tflite',
  'vision/vision_bundle.mjs',
  'vision/wasm/vision_wasm_internal.js',
  'vision/wasm/vision_wasm_internal.wasm',
  'vision/wasm/vision_wasm_nosimd_internal.js',
  'vision/wasm/vision_wasm_nosimd_internal.wasm',
];

const contents = new Map(await Promise.all(requiredFiles.map(async file => {
  const data = await readFile(new URL(file, root));
  if (!data.length) throw new Error(file + ' is empty.');
  if (file.endsWith('.wasm') && !WebAssembly.validate(data)) {
    throw new Error(file + ' is not valid WebAssembly.');
  }
  return [file, data];
})));

const model = contents.get('vision/efficientdet-lite0.tflite');
const checksum = createHash('sha256').update(model).digest('hex');
if (checksum !== '0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb') {
  throw new Error('The bundled EfficientDet-Lite0 model failed its checksum.');
}

const filter = JSON.parse(contents.get('vision/bottle-filter.json'));
const filterFields = ['candidateScore', 'minimumScore', 'agreementScore', 'intercept', 'scoreWeight', 'areaWeight', 'decisionLogit'];
if (!filterFields.every(field => Number.isFinite(filter[field]))) {
  throw new Error('The bottle detection filter is missing required coefficients.');
}

console.log('Render build checks passed. Publish dist/.');
