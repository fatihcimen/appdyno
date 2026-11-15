#!/usr/bin/env node
/**
 * Compresses the landing page's model into public/models. The source is large and stays out of
 * git: only what this writes is committed. The model's poster, the picture shown until the scene
 * has it, is src/assets/dyno.webp, put there by hand.
 *
 *   pnpm --filter @appdyno/site models <folder>
 *
 * The folder holds dyno.glb. Its textures become WebP and its geometry is quantized. The dragon
 * is found by its bones and clips, so it keeps its names, loses every channel that only holds a
 * bone where it rests, and is packed with Meshopt, whose decoder is in the page's own script.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELS = {
  dyno: {
    size: 512,
    // what would join, flatten or thin a mesh is off: the skin and its bones stay as they were made
    flags: [
      ...['--compress', 'meshopt'],
      ...['--flatten', 'false'],
      ...['--join', 'false'],
      ...['--instance', 'false'],
      ...['--palette', 'false'],
      ...['--simplify', 'false'],
    ],
  },
};
const site = fileURLToPath(new URL('..', import.meta.url));
const tool = join(site, 'node_modules/.bin/gltf-transform');

const [from] = process.argv.slice(2);
const names = Object.keys(MODELS).filter((name) => from && existsSync(join(from, `${name}.glb`)));
if (!names.length) {
  console.error(`usage: models <folder with ${Object.keys(MODELS).join('.glb, ')}.glb>`);
  process.exit(2);
}

/** @param {string} file */
const kb = (file) => `${statSync(file).size.toLocaleString('en')} bytes`;

/**
 * A .glb is a 12-byte header, then its JSON and its binary, each 4-byte aligned behind its own
 * length and type.
 * @param {string} file
 */
function read(file) {
  const glb = readFileSync(file);
  const length = glb.readUInt32LE(12);
  return {
    head: glb.subarray(0, 20),
    /** @type {any} */
    scene: JSON.parse(glb.subarray(20, 20 + length).toString('utf8')),
    rest: glb.subarray(20 + length),
  };
}

/**
 * @param {string} file
 * @param {ReturnType<typeof read>} glb
 */
function write(file, { head, scene, rest }) {
  const text = Buffer.from(JSON.stringify(scene));
  const json = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, ' ')]);
  const start = Buffer.from(head);
  start.writeUInt32LE(start.length + json.length + rest.length, 8);
  start.writeUInt32LE(json.length, 12);
  writeFileSync(file, Buffer.concat([start, json, rest]));
}

const REST = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };

/**
 * Drops the channels that only hold a bone where it rests: an exporter writes one for each of a
 * bone's place, turn and size in every clip, and most never move. A channel that holds a bone
 * away from its rest, as a closed jaw, stays.
 * @param {string} source
 * @param {string} out
 */
function still(source, out) {
  const glb = read(source);
  const { scene, rest } = glb;
  const bin = rest.subarray(8);
  /** @param {number} index */
  const floats = (index) => {
    const accessor = scene.accessors[index];
    const view = scene.bufferViews[accessor.bufferView];
    if (accessor.componentType !== 5126 || view.byteStride)
      throw new Error(`${source}: a clip's values are not plain floats`);
    const at = bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const width = { VEC3: 3, VEC4: 4 }[/** @type {'VEC3' | 'VEC4'} */ (accessor.type)];
    return {
      width,
      values: new Float32Array(bin.buffer.slice(at, at + accessor.count * width * 4)),
    };
  };
  let dropped = 0;
  for (const clip of scene.animations) {
    const kept = clip.channels.filter((/** @type {any} */ channel) => {
      const path = /** @type {keyof typeof REST} */ (channel.target.path);
      const home = scene.nodes[channel.target.node][path] ?? REST[path];
      const { width, values } = floats(clip.samplers[channel.sampler].output);
      // a turn and its negative are the same turn
      const moved = [1, -1].every((sign) =>
        values.some((value, i) => Math.abs(value - sign * home[i % width]) > 1e-4),
      );
      return path === 'rotation'
        ? moved
        : values.some((v, i) => Math.abs(v - home[i % width]) > 1e-5);
    });
    dropped += clip.channels.length - kept.length;
    const samplers = [...new Set(kept.map((/** @type {any} */ channel) => channel.sampler))];
    clip.channels = kept.map((/** @type {any} */ channel) => ({
      ...channel,
      sampler: samplers.indexOf(channel.sampler),
    }));
    clip.samplers = samplers.map((index) => clip.samplers[index]);
  }
  write(out, glb);
  return dropped;
}

/**
 * Holds the dragon it wrote to what the page finds in it: its bones and clips by name, and how
 * they move. The test that does so runs with the site's others too, on the committed file.
 */
const check = () =>
  execFileSync(process.execPath, ['--test', join(site, 'test/mascot-model.test.ts')], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });

const work = mkdtempSync(join(tmpdir(), 'models-'));
try {
  for (const name of /** @type {(keyof typeof MODELS)[]} */ (names)) {
    const { size, flags } = MODELS[name];
    const source = join(from ?? '', `${name}.glb`);
    const out = join(site, 'public/models', `${name}.glb`);
    const moving = join(work, `${name}.glb`);
    const dropped = still(source, moving);
    execFileSync(
      tool,
      [
        'optimize',
        moving,
        out,
        ...flags,
        ...['--texture-compress', 'webp'],
        ...['--texture-size', String(size)],
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    check();
    console.log(`${name}.glb: ${kb(source)} -> ${kb(out)}, ${dropped} still channels dropped`);
  }
} finally {
  rmSync(work, { recursive: true });
}
