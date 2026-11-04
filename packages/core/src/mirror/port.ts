import type { Need } from './need.js';

export type MirrorQuality = 'auto' | 'high' | 'standard';

export type MirrorOptions = {
  quality: MirrorQuality;
  /** H.264 has the widest support; HEVC at the user's word. */
  codec?: 'h264' | 'hevc';
};

export type MirrorCheck =
  { ok: true; routes: string[] } | { ok: false; need: Need; detail?: string };

/** What the viewer attaches to. A kind of device adds its kind here, and a source in the viewer. */
export type MirrorSource =
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
      /** What a person should know of this picture. */
      note?: string;
    }
  | { kind: 'pixels'; file: string; w: number; h: number }
  /** Frames as an agent's stream has them, on a named pipe; what writes them holds the device. */
  | { kind: 'pipe'; file: string; codec: 'hevc' };

/** One touch, key or text. A touch is in fractions of the screen, whatever its size or rotation. */
export type InputEvent =
  | { kind: 'touch'; p: 0 | 1 | 2; x: number; y: number; x2?: number; y2?: number }
  | { kind: 'key'; page: number; usage: number; state: 1 | 2 }
  | { kind: 'text'; s: string }
  | { kind: 'button'; name: string };

export type DeviceState = 'ok' | Need;

/** A device's end of a mirror: only what differs between kinds of device. */
export interface Mirror {
  /** What this device can do, and why not: asked before anything is opened. */
  check(): Promise<MirrorCheck>;
  /** Readies the device's end; `tell` reaches the viewer, for a feeder that has something to say to it. */
  open(
    opts: MirrorOptions,
    signal: AbortSignal,
    tell: (message: Record<string, unknown>) => void,
  ): Promise<MirrorSource>;
  /** Asks the far end for a fresh keyframe, after loss or a decoder error. */
  keyframe(): Promise<void>;
  /** With no settle. */
  input(e: InputEvent): Promise<void>;
  /** Ends the stream and proves it ended. Safe twice. */
  close(): Promise<void>;
  /** Pushes what the device's state became: locked, unplugged, taken over. */
  watch(onChange: (s: DeviceState) => void): () => void;
  /** Turns a dark screen on, where this kind of device can be asked to: at a start, and at a person's click. */
  wake?(): Promise<void>;
  /** A still screen keeps sending frames, so that only a larger one tells that something changed. */
  readonly sendsWhenStill?: boolean;
  /** No first picture in this time means this, rather than a failed stream. */
  readonly noFirstFrame?: { ms: number; need: Need };
}
