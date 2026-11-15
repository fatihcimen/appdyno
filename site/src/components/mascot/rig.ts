import {
  AnimationMixer,
  Bone,
  Euler,
  Group,
  LoopOnce,
  MeshStandardMaterial,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type AnimationAction,
  type Object3D,
} from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BONES, CLIPS, type Bone as BoneName, type Clip } from './names.ts';

/** Seconds one clip takes to give way to the next. */
const FADE = 0.22;
/** The most the neck and head turn together toward what it looks at, to a side and up or down. */
const YAW = 1.15;
const PITCH = 0.6;
/** The tail's spring (1/s²) and damper (1/s), and how far a body length a second of drift swings it. */
const TAIL_STIFF = 60;
const TAIL_DAMP = 7;
const TAIL_DRIFT = 0.5;

const q = [0, 1, 2, 3].map(() => new Quaternion());
const euler = new Euler();

/**
 * The dragon's model: its clips blended by weight, and what code adds after them each frame, the
 * head turned to what it looks at and the tail swung behind it. The model faces its own +X, is
 * one unit tall and stands on its origin; `holder` is what a scene places, sizes and turns.
 */
export class Rig {
  readonly holder = new Group();
  /** How long each clip plays. */
  readonly lengths: Record<Clip, number>;
  /** When in `puff` the fire burns: the clip says so itself. */
  readonly burns: { fire: number; until: number };

  readonly #mixer: AnimationMixer;
  readonly #actions: Record<Clip, AnimationAction>;
  readonly #bones: Record<BoneName, Bone>;
  /** How each bone that code turns was bound: a clip with no track for it leaves it there. */
  readonly #bound: [Bone, Quaternion][];
  readonly #skin: MeshStandardMaterial | undefined;
  #base: Clip = 'idle';
  #shot: { clip: Clip; left: number } | undefined;
  #gaze = { yaw: 0, pitch: 0 };
  #tail = { angle: 0, speed: 0 };
  #clock = 0;

  constructor(model: GLTF) {
    this.holder.add(model.scene);
    const pick = <K extends string, V>(names: readonly K[], of: (name: K) => V | undefined) =>
      Object.fromEntries(
        names.map((name) => {
          const found = of(name);
          if (!found) throw new Error(`the dragon's model has no ${name}`);
          return [name, found];
        }),
      ) as Record<K, V>;
    this.#bones = pick(BONES, (name) => {
      const found = model.scene.getObjectByName(name);
      return found instanceof Bone ? found : undefined;
    });
    // the model's origin is the middle of its length, tail and all: the holder's is under the hips, where it turns
    model.scene.updateMatrixWorld(true);
    model.scene.position.x -= this.#bones.Hip.getWorldPosition(new Vector3()).x;
    this.#mixer = new AnimationMixer(model.scene);
    // every clip plays from the start at no weight, so each bone's bound pose is what the mixer falls back to
    this.#actions = pick(CLIPS, (name) => {
      const clip = model.animations.find((animation) => animation.name === name);
      return clip && this.#mixer.clipAction(clip).setEffectiveWeight(0).play();
    });
    this.#actions.idle.setEffectiveWeight(1);
    this.lengths = pick(CLIPS, (name) => this.#actions[name].getClip().duration);
    this.burns = this.#actions.puff.getClip().userData as Rig['burns'];
    if (!(this.burns.fire >= 0 && this.burns.until > this.burns.fire))
      throw new Error("the dragon's puff does not say when its fire burns");
    const { NeckTwist01, Head, Tail01, Tail02, Tail03 } = this.#bones;
    this.#bound = [NeckTwist01, Head, Tail01, Tail02, Tail03].map((bone) => [
      bone,
      bone.quaternion.clone(),
    ]);
    model.scene.traverse((part) => {
      // a skin's bounds are those of its bound pose: a clip can carry it out of them
      if (part instanceof SkinnedMesh) part.frustumCulled = false;
    });
    const skinned = model.scene.getObjectByProperty('isSkinnedMesh', true);
    const material = skinned instanceof SkinnedMesh ? skinned.material : undefined;
    this.#skin = material instanceof MeshStandardMaterial ? material : undefined;
  }

  /** The clip that loops under everything else. */
  base(clip: Clip) {
    if (clip === this.#base) return;
    this.#actions[clip].reset();
    this.#base = clip;
  }

  /** Plays a clip once over the base, then gives way to it again. */
  shot(clip: Clip) {
    const action = this.#actions[clip].reset().setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    this.#shot = { clip, left: this.lengths[clip] - FADE };
  }

  /**
   * A frame: the clips, then the head toward `gaze` (a point of the scene, or nowhere) and the
   * tail behind a body that drifts sideways at `drift` lengths a second.
   */
  update(dt: number, gaze: Vector3 | undefined, drift: number) {
    if (this.#shot && (this.#shot.left -= dt) <= 0) this.#shot = undefined;
    const playing = this.#shot?.clip ?? this.#base;
    for (const clip of CLIPS) {
      const action = this.#actions[clip];
      const weight = action.getEffectiveWeight();
      const toward = clip === playing ? 1 : 0;
      action.setEffectiveWeight(
        weight + Math.min(dt / FADE, Math.max(-dt / FADE, toward - weight)),
      );
    }
    for (const [bone, bound] of this.#bound) bone.quaternion.copy(bound);
    this.#mixer.update(dt);
    this.holder.updateMatrixWorld(true);
    this.#look(dt, gaze);
    this.#swing(dt, drift);
  }

  /** Where the fire leaves the mouth and the way it points, in the scene, as the last frame left them. */
  mouth() {
    const socket = this.#bones.FireSocket;
    return {
      at: socket.getWorldPosition(new Vector3()),
      // a bone's length is its own +Y
      out: new Vector3(0, 1, 0).transformDirection(socket.matrixWorld),
    };
  }

  /** The fire's light on the face, from 0 to 1. */
  glow(share: number) {
    this.#skin?.emissive.setRGB(share * 0.55, share * 0.22, share * 0.04);
  }

  /**
   * How far a second a clip's feet carry it, in body lengths: a foot is on the ground for half a
   * step, and goes back that whole time by as much as it ranges along the body.
   */
  stride(clip: 'walk' | 'run') {
    const action = this.#actions[clip];
    const weights = CLIPS.map((name) => this.#actions[name].getEffectiveWeight());
    for (const name of CLIPS) this.#actions[name].setEffectiveWeight(name === clip ? 1 : 0);
    let near = Infinity;
    let far = -Infinity;
    const at = new Vector3();
    for (let i = 0; i < 24; i++) {
      action.time = (this.lengths[clip] * i) / 24;
      this.#mixer.update(0);
      this.holder.updateMatrixWorld(true);
      const along = this.holder.worldToLocal(this.#bones.L_Foot.getWorldPosition(at)).x;
      near = Math.min(near, along);
      far = Math.max(far, along);
    }
    CLIPS.forEach((name, i) => this.#actions[name].setEffectiveWeight(weights[i] ?? 0));
    action.time = 0;
    return (2 * (far - near)) / this.lengths[clip];
  }

  /** Turns a bone by a turn given in the body's own axes, on top of what its clip gave it. */
  #turn(bone: Object3D, yaw: number, pitch: number) {
    const [body, world, parent, local] = q as [Quaternion, Quaternion, Quaternion, Quaternion];
    this.holder.getWorldQuaternion(body);
    // the body faces +X: a yaw is about its Y, a pitch about its Z, the pitch first
    world.setFromEuler(euler.set(0, yaw, pitch, 'YZX'));
    world.premultiply(body).multiply(local.copy(body).invert());
    bone.parent?.getWorldQuaternion(parent);
    bone.quaternion.premultiply(local.copy(parent).invert().multiply(world).multiply(parent));
    bone.updateMatrixWorld(true);
  }

  #look(dt: number, gaze: Vector3 | undefined) {
    let yaw = 0;
    let pitch = 0;
    if (gaze) {
      const head = this.#bones.Head.getWorldPosition(new Vector3());
      const to = gaze
        .clone()
        .sub(head)
        .applyQuaternion(this.holder.getWorldQuaternion(q[0] as Quaternion).invert());
      yaw = Math.max(-YAW, Math.min(YAW, Math.atan2(-to.z, to.x)));
      pitch = Math.max(-PITCH, Math.min(PITCH, Math.atan2(to.y, Math.hypot(to.x, to.z))));
    }
    const ease = Math.min(1, 9 * dt);
    this.#gaze.yaw += (yaw - this.#gaze.yaw) * ease;
    this.#gaze.pitch += (pitch - this.#gaze.pitch) * ease;
    for (const bone of [this.#bones.NeckTwist01, this.#bones.Head])
      this.#turn(bone, this.#gaze.yaw / 2, this.#gaze.pitch / 2);
  }

  #swing(dt: number, drift: number) {
    this.#clock += dt;
    const tail = this.#tail;
    const rest = -TAIL_DRIFT * drift + 0.12 * Math.sin(this.#clock * 1.7);
    tail.speed += (TAIL_STIFF * (rest - tail.angle) - TAIL_DAMP * tail.speed) * dt;
    tail.angle = Math.max(-0.9, Math.min(0.9, tail.angle + tail.speed * dt));
    for (const bone of [this.#bones.Tail01, this.#bones.Tail02, this.#bones.Tail03])
      this.#turn(bone, tail.angle / 3, 0);
  }
}
