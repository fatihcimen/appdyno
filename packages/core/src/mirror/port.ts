import type { Key } from '@appdyno/protocol';
import type { Need } from './need.js';
import type { ViewerOrder } from './viewer.js';

export type MirrorQuality = 'auto' | 'high' | 'standard';

export type MirrorOptions = {
  quality: MirrorQuality;
  /** H.264 has the widest support; HEVC at the user's word. */
  codec?: 'h264' | 'hevc';
  /** By the network and not a cable, where the device's `wifi` says it can be asked to. */
  wifi?: boolean;
};

export type MirrorCheck =
  { ok: true; routes: string[] } | { ok: false; need: Need; detail?: string };

/** What the viewer attaches to. A kind of device adds its kind here, and a source in the viewer. */
export type MirrorSource = (
  | {
      kind: 'surface';
      udid: string;
      developerDir?: string;
      /** Quarter turns, counterclockwise, that stand its picture up. */
      turns?: number;
    }
  | {
      kind: 'adb';
      serial: string;
      socket: string;
      token: string;
      codec: 'h264' | 'hevc';
      adbPort?: number;
      /** For the agent's `stream.start`, beside the codec. */
      start?: Record<string, unknown>;
    }
  | { kind: 'pixels'; file: string; w: number; h: number }
  /** Frames as an agent's stream has them, on a named pipe; what writes them holds the device. */
  | { kind: 'pipe'; file: string; codec: 'hevc' }
) & {
  /** What a person should know of this picture. */
  note?: string;
  /** Its frames are the stream's own, so a movie needs no second encoder. */
  encoded?: boolean;
};

/** One touch, key or text. A touch is in fractions of the screen, whatever its size or rotation. */
export type InputEvent =
  | {
      kind: 'touch';
      p: 0 | 1 | 2;
      x: number;
      y: number;
      x2?: number;
      y2?: number;
      /** Made by a scroll wheel or two fingers on a trackpad, not a finger. */
      wheel?: boolean;
    }
  | { kind: 'key'; page: number; usage: number; state: 1 | 2 }
  | { kind: 'text'; s: string }
  | { kind: 'button'; name: string };

export type DeviceState = 'ok' | Need;

/** A device's end of a mirror: only what differs between kinds of device. */
export type Mirror = {
  /** What this device can do, and why not: asked before anything is opened. */
  check(opts?: MirrorOptions): Promise<MirrorCheck>;
  /** Readies the device's end; `tell` reaches the viewer, for a feeder that has something to say to it. */
  open(
    opts: MirrorOptions,
    signal: AbortSignal,
    tell: (message: ViewerOrder) => void,
  ): Promise<MirrorSource>;
  /** Asks the far end for a fresh keyframe, after loss or a decoder error. */
  keyframe(): Promise<void>;
  /** With no settle. */
  input(e: InputEvent): Promise<void>;
  /** The key a keyboard's usage presses on this device: a recording writes this, so that a replay does what a person did. */
  keyOf(usage: number): Key | undefined;
  /** Ends the stream and proves it ended. Safe twice. */
  close(): Promise<void>;
  /** Pushes what the device's state became: locked, unplugged, taken over. */
  watch(onChange: (s: DeviceState) => void): () => void;
  /** The device's own picture with no agent up, where its kind has a way; undefined leaves it to the agent. */
  screenshot?(format: 'png' | 'jpeg'): Promise<{ data: Buffer } | undefined>;
  /** Turns a dark screen on, where this kind of device can be asked to: at a start, and at a person's click. */
  wake?(): Promise<void>;
  /** It takes `MirrorOptions.wifi`: the network is a choice here, where an Android phone's address already is one. */
  readonly wifi?: boolean;
  /** A still screen keeps sending frames, so that only a larger one tells that something changed. */
  readonly sendsWhenStill?: boolean;
  /** In this state the stream stays and only what is said changes, as a new start would undo what a person did. */
  readonly holdsThrough?: DeviceState;
  /** No first picture in this time means this, rather than a failed stream. */
  readonly noFirstFrame?: { ms: number; need: Need };
};

/** What moved, as the viewer read it; places and speeds as fractions of the frame. */
export type MotionRegion = {
  kind: 'moves' | 'changes';
  x: number;
  y: number;
  w: number;
  h: number;
  axis?: 'x' | 'y';
  sign?: number;
  speed?: number;
  events?: { kind: 'jump' | 'back' | 'stop'; at: number; by: number }[];
};

export type MotionWatch = {
  why?: string;
  summary?: { frames: number; ms: number; noisy: boolean; regions: MotionRegion[] };
  strip?: { file: string; at: number[] };
};
