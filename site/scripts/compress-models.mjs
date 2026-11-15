#!/usr/bin/env node
/**
 * Compresses the landing page's models into public/models. The sources are large and stay out of
 * git: only what this writes is committed. A model's poster, the picture shown until the viewer
 * has it, is src/assets/<model>.webp, put there by hand.
 *
 *   pnpm --filter @appdyno/site models <folder>
 *
 * The folder holds dino.glb and bench.glb. Textures become WebP of at most 1024 px, and the
 * geometry is quantized: the viewer reads both by itself. Meshopt and Draco are smaller still,
 * but the viewer fetches a decoder for each from another host.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELS = ['dino', 'bench'];
const site = fileURLToPath(new URL('..', import.meta.url));
const tool = join(site, 'node_modules/.bin/gltf-transform');

const [from] = process.argv.slice(2);
if (!from || MODELS.some((name) => !existsSync(join(from, `${name}.glb`)))) {
  console.error(`usage: models <folder with ${MODELS.map((name) => `${name}.glb`).join(', ')}>`);
  process.exit(2);
}

/** @param {string} file */
const kb = (file) => `${statSync(file).size.toLocaleString('en')} bytes`;

/**
 * Takes every name out of a model: nothing shows one, and the names a modelling tool gave say
 * nothing of the model. A .glb is a 12-byte header, then its JSON and its binary, each 4-byte
 * aligned behind its own length and type.
 * @param {string} file
 */
function unname(file) {
  const glb = readFileSync(file);
  const length = glb.readUInt32LE(12);
  /** @type {unknown} */
  const scene = JSON.parse(glb.subarray(20, 20 + length).toString('utf8'));
  const text = Buffer.from(
    JSON.stringify(scene, (key, value) => (key === 'name' ? undefined : value)),
  );
  const json = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, ' ')]);
  const rest = glb.subarray(20 + length);
  const head = Buffer.from(glb.subarray(0, 20));
  head.writeUInt32LE(head.length + json.length + rest.length, 8);
  head.writeUInt32LE(json.length, 12);
  writeFileSync(file, Buffer.concat([head, json, rest]));
}

for (const name of MODELS) {
  const source = join(from, `${name}.glb`);
  const out = join(site, 'public/models', `${name}.glb`);
  execFileSync(
    tool,
    [
      'optimize',
      source,
      out,
      ...['--compress', 'quantize'],
      ...['--texture-compress', 'webp'],
      ...['--texture-size', '1024'],
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  unname(out);
  console.log(`${name}.glb: ${kb(source)} -> ${kb(out)}`);
}
