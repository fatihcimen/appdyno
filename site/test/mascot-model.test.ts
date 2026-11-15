import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  AnimationMixer,
  Bone,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { BONES, CLIPS } from '../src/components/mascot/names.ts';
import { Rig } from '../src/components/mascot/rig.ts';

/**
 * The shipped model, loaded as the page loads it. Node has nothing to decode a picture with, so
 * the texture is taken out of the file's JSON first: the bones and the clips are what is read.
 */
async function load() {
  const glb = readFileSync(new URL('../public/models/dyno.glb', import.meta.url));
  const length = glb.readUInt32LE(12);
  const scene = JSON.parse(glb.subarray(20, 20 + length).toString('utf8')) as Record<
    string,
    unknown
  >;
  for (const key of ['images', 'textures', 'samplers']) delete scene[key];
  for (const material of scene['materials'] as { pbrMetallicRoughness?: object }[])
    delete material.pbrMetallicRoughness;
  for (const key of ['extensionsUsed', 'extensionsRequired'])
    scene[key] = (scene[key] as string[]).filter((name) => name !== 'EXT_texture_webp');
  const text = Buffer.from(JSON.stringify(scene));
  const json = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, ' ')]);
  const rest = glb.subarray(20 + length);
  const head = Buffer.from(glb.subarray(0, 20));
  head.writeUInt32LE(head.length + json.length + rest.length, 8);
  head.writeUInt32LE(json.length, 12);
  const whole = Buffer.concat([head, json, rest]);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(
    whole.buffer.slice(whole.byteOffset, whole.byteOffset + whole.length),
    '',
  );
}

const model = await load();
const bone = (name: string) => {
  const found = model.scene.getObjectByName(name);
  assert.ok(found instanceof Bone, `${name} is a bone of the model`);
  return found;
};
const clip = (name: string) => {
  const found = model.animations.find((animation) => animation.name === name);
  assert.ok(found, `${name} is a clip of the model`);
  return found;
};
const place = (of: Object3D) => of.getWorldPosition(new Vector3());

/** Plays a clip from its start to its end in steps, with what `read` returns at each. */
function play<T>(of: AnimationClip, steps: number, read: (time: number) => T): T[] {
  const mixer = new AnimationMixer(model.scene);
  mixer.clipAction(of).play();
  const out: T[] = [];
  for (let i = 0; i <= steps; i++) {
    mixer.setTime((of.duration * i) / steps);
    model.scene.updateMatrixWorld(true);
    out.push(read(mixer.time));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(model.scene);
  return out;
}

test('the model has every bone and clip the page finds by name', () => {
  for (const name of BONES) bone(name);
  for (const name of CLIPS) clip(name);
  assert.equal(bone('FireSocket').parent, bone('Head'));
  assert.equal(bone('Jaw').parent, bone('Head'));
});

test('the fire socket rides the head through a clip, pointing out of the mouth', () => {
  const socket = bone('FireSocket');
  const head = bone('Head');
  for (const name of ['puff', 'look'] as const) {
    const frames = play(clip(name), 24, () => {
      // a bone's length is its own +Y
      const out = new Vector3(0, 1, 0).transformDirection(socket.matrixWorld);
      const from = place(socket).sub(place(head));
      return { at: place(socket), reach: from.length(), along: out.dot(from.normalize()) };
    });
    const first = frames[0];
    assert.ok(first);
    const moved = Math.max(...frames.map((frame) => frame.at.distanceTo(first.at)));
    assert.ok(moved > 0.03, `${name}: the socket moves with the head (${moved.toFixed(3)})`);
    for (const frame of frames) {
      assert.ok(Math.abs(frame.reach - first.reach) < 1e-3, `${name}: it stays on the head`);
      assert.ok(
        frame.along > 0.8,
        `${name}: it points out of the mouth (${frame.along.toFixed(2)})`,
      );
    }
  }
});

test('the jaw is shut in every clip but puff, which opens it while its fire burns', () => {
  const jaw = bone('Jaw');
  const bound = jaw.quaternion.clone();
  const open = (q: Quaternion) => (bound.angleTo(q) * 180) / Math.PI;
  for (const name of CLIPS) {
    const gape = play(clip(name), 12, () => open(jaw.quaternion));
    if (name !== 'puff') assert.ok(Math.min(...gape) > 40, `${name} holds the jaw shut`);
  }
  const puff = clip('puff');
  const { fire, until } = puff.userData as { fire: number; until: number };
  assert.ok(fire > 0 && until > fire && until < puff.duration, 'puff says when its fire burns');
  const gape = play(puff, 48, (time) => ({ time, gape: open(jaw.quaternion) }));
  for (const frame of gape)
    if (frame.time >= fire && frame.time <= until) assert.ok(frame.gape < 12, 'open in the fire');
  assert.ok((gape[0]?.gape ?? 0) > 40 && (gape.at(-1)?.gape ?? 0) > 40, 'shut before and after');
});

test('the walk moves the feet and leaves the root in place', () => {
  const foot = bone('L_Foot');
  const hip = bone('Hip');
  const steps = play(clip('walk'), 24, () => ({ foot: place(foot), hip: place(hip) }));
  const span = (axis: 'x' | 'z', of: 'foot' | 'hip') =>
    Math.max(...steps.map((s) => s[of][axis])) - Math.min(...steps.map((s) => s[of][axis]));
  assert.ok(span('x', 'foot') > 0.1, 'a foot swings along the way it faces, +X');
  assert.ok(span('x', 'hip') < 0.05 && span('z', 'hip') < 0.05, 'the body stays over its place');
});

test('the rig turns the head, and with it the fire, toward what it looks at, and back', async () => {
  const rig = new Rig(await load());
  const settle = (gaze?: Vector3) => {
    for (let i = 0; i < 60; i++) rig.update(1 / 60, gaze, 0);
    return rig.mouth();
  };
  const ahead = settle();
  assert.ok(ahead.out.x > 0.9, 'at rest the mouth points the way the body faces, +X');
  assert.ok(
    Math.abs(ahead.at.x - 0.27) < 0.08,
    'the hips are over the origin, the mouth ahead of them',
  );
  // up, down, and to each side of the body: a model's left is -Z
  for (const [name, to] of [
    ['up', new Vector3(2, 3, 0)],
    ['down', new Vector3(2, -2, 0)],
    ['its left', new Vector3(2, 0.7, -3)],
    ['its right', new Vector3(2, 0.7, 3)],
  ] as const) {
    const { at, out } = settle(to);
    const want = to.clone().sub(at).normalize();
    assert.ok(out.dot(want) > ahead.out.dot(want) + 0.2, `it turns ${name}`);
  }
  const again = settle();
  assert.ok(
    again.out.distanceTo(ahead.out) < 0.02,
    'with nothing to look at, it faces ahead again',
  );
});

test('a run covers more ground than a walk, and a shot gives way to the base clip again', async () => {
  const rig = new Rig(await load());
  const walk = rig.stride('walk');
  const run = rig.stride('run');
  assert.ok(walk > 0.1 && walk < 1.5, `a walk covers ${walk.toFixed(2)} lengths a second`);
  assert.ok(run > walk, `a run ${run.toFixed(2)}`);
  // a twin that only idles shows where the head would have been
  const twin = new Rig(await load());
  rig.shot('puff');
  let apart = 0;
  let moved = 0;
  for (let t = 0; t < rig.lengths.puff + 0.5; t += 1 / 60) {
    rig.update(1 / 60, undefined, 0);
    twin.update(1 / 60, undefined, 0);
    apart = rig.mouth().at.distanceTo(twin.mouth().at);
    moved = Math.max(moved, apart);
  }
  assert.ok(moved > 0.03, `the puff moves the head (${moved.toFixed(3)})`);
  assert.ok(apart < 0.005, `and idle has it back (${apart.toFixed(3)})`);
});
