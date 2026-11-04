import type { DeviceState, InputEvent, MirrorQuality, Need } from '@appdyno/core';

/**
 * What the phone's stream offers this package, and all it knows of it. What speaks to the phone lives in
 * `phone-stream/`, reached by one dynamic import in `mirror-phone.ts`: with that folder gone everything here still
 * builds, an iPhone keeps its runner, and its mirror is refused in words.
 */
export type PhoneStreamEvent =
  /** The picture's size and how it was agreed, once a stream runs. */
  | { kind: 'live'; w: number; h: number; mode: string }
  | { kind: 'state'; state: DeviceState }
  /** It ended, with what stands in the way if something does; `ended` follows a stop. */
  | { kind: 'lost'; why: string; need?: Need }
  | { kind: 'ended'; proved: boolean };

export interface PhoneStreamHandle {
  /** Where frames go from now on: a pipe a viewer holds open. */
  attach(file: string): void;
  input(e: InputEvent): void;
  keyframe(): void;
  /** Ends the stream, and says if the phone says it ended. */
  stop(): Promise<boolean>;
}

export type PhoneStreamCheck = { ok: true } | { ok: false; need: Need; detail?: string };

export interface PhoneStreamModule {
  /** The screen by the phone's own service, with no stream and nothing on the phone. */
  screenshot(udid: string, format: 'png' | 'jpeg'): Promise<Buffer>;
  /** What can be known with no stream started. */
  check(udid: string): Promise<PhoneStreamCheck>;
  start(
    udid: string,
    options: { quality: MirrorQuality },
    onEvent: (e: PhoneStreamEvent) => void,
  ): PhoneStreamHandle;
}
