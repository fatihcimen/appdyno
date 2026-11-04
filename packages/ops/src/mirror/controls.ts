import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { measuredLive, pause, perfMessage, safeName } from '@appdyno/core';
import type {
  Device,
  DeviceHardware,
  InputEvent,
  MirrorSession,
  ViewerMessage,
} from '@appdyno/core';

/** A finger's way down the screen, as fractions of it: from the top edge, or the middle of a home screen. */
const SWIPES: Record<string, { x: number; from: number; to: number; times?: number }> = {
  // inside the corner's curve, near the battery: past it a screen has nothing to touch
  controlCenter: { x: 0.84, from: 0.012, to: 0.55 },
  notifications: { x: 0.3, from: 0, to: 0.65 },
  spotlight: { x: 0.5, from: 0.35, to: 0.55 },
  quickSettings: { x: 0.5, from: 0, to: 0.6, times: 2 },
};
const SWIPE_STEPS = 10;
const SWIPE_STEP_MS = 16;
const SWIPES_APART_MS = 400;
const RECORD_MAX_S = 3_600;

const stamp = () =>
  new Date()
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace('T', ' ')
    .replace(/:/g, '.');

/** How a device looks on a window: its frame and the controls it has. */
export function windowLook(hardware: DeviceHardware | undefined) {
  return {
    frame: { model: hardware?.model, platform: hardware?.platform, color: hardware?.color },
    controls: hardware?.controls ?? [],
    ...(hardware?.model && { name: hardware.model }),
  };
}

export type WindowSession = Pick<
  MirrorSession,
  'send' | 'tell' | 'recording' | 'streamsItsOwn' | 'askAgain'
>;

/** What a window's controls do that is not one key to one device: gestures, captures and the Apps pane. */
export function windowControls(
  device: Device,
  hardware: DeviceHardware | undefined,
  session: () => WindowSession,
) {
  const name = () => safeName(hardware?.model ?? device.serial);
  let opened: Promise<unknown> | undefined;
  let rotation: 0 | 1 | 2 | 3 = 0;
  let stopRecording: (() => Promise<string>) | undefined;
  let stopPerf: (() => void) | undefined;

  /** The window needs no agent of its own; what is asked of the device past the stream does. */
  const ready = () => (opened ??= device.open());
  const note = (text: string) => session().tell({ op: 'note', text });
  const trying = (work: () => Promise<void>) => void work().catch((e: Error) => note(e.message));

  const touch = (p: 0 | 1 | 2, x: number, y: number) => {
    const e: InputEvent = { kind: 'touch', p, x, y };
    session().send(e);
  };

  const swipe = async ({ x, from, to, times = 1 }: (typeof SWIPES)[string]) => {
    for (let n = 0; n < times; n++) {
      touch(0, x, from);
      for (let i = 1; i <= SWIPE_STEPS; i++) {
        await pause(SWIPE_STEP_MS);
        touch(1, x, from + ((to - from) * i) / SWIPE_STEPS);
      }
      touch(2, x, to);
      if (n + 1 < times) await pause(SWIPES_APART_MS);
    }
  };

  const rotate = async (by: 1 | 3) => {
    // a simulator's orientation has no way in but its runner, which a first turn may have to build
    note(opened ? 'Rotating' : 'Rotating: the first turn starts the device agent');
    await ready();
    rotation = ((rotation + by) % 4) as 0 | 1 | 2 | 3;
    await device.setOrientation(rotation);
  };

  const presses: Record<string, () => Promise<void>> = {
    rotateLeft: () => rotate(1),
    rotateRight: () => rotate(3),
  };

  const screenshot = async (copyOnly: boolean) => {
    // no agent is started for what the device can answer without one
    const own = await device.mirror.screenshot?.('png');
    if (!own) await ready();
    const { data } = own ?? (await device.screenshot({ format: 'png' }));
    const file = copyOnly
      ? join(tmpdir(), `${name()}-${process.pid}.png`)
      : join(homedir(), 'Desktop', `${name()} ${stamp()}.png`);
    writeFileSync(file, data, { mode: 0o600 });
    session().tell({ op: 'copied', file });
    if (!copyOnly) return note(`Saved to the Desktop and copied`);
    note('Copied');
    await pause(2_000);
    rmSync(file, { force: true });
  };

  const record = async () => {
    if (stopRecording) {
      const stop = stopRecording;
      stopRecording = undefined;
      session().tell({ op: 'recording', on: false });
      note(await stop());
      return;
    }
    const movies = join(homedir(), 'Movies');
    mkdirSync(movies, { recursive: true });
    const file = join(movies, `${name()} ${stamp()}`);
    const { recorder } = device;
    if (session().streamsItsOwn) {
      // its frames as the stream has them: nothing is encoded twice
      session().recording.start(`${file}.mp4`);
      stopRecording = async () => {
        const r = await session().recording.stop();
        return r.why ?? `Saved to Movies: ${r.frames} frames`;
      };
    } else {
      await ready();
      const handle = await recorder.start(`${file}.${recorder.extension}`, {
        maxSeconds: RECORD_MAX_S,
      });
      stopRecording = async () => {
        const { files, note: said } = await recorder.stop(handle);
        return said ?? `Saved to Movies: ${files.length} file${files.length > 1 ? 's' : ''}`;
      };
    }
    session().tell({ op: 'recording', on: true });
  };

  /** A device's own source where it has one, or its measures: nothing is read while nothing shows it. */
  const watchPerf = async (on: boolean) => {
    stopPerf?.();
    stopPerf = undefined;
    if (!on) return;
    // only a device that has no way to say what is in front but its agent starts it: a late answer is no refusal
    const refused = await device.foreground().then(
      () => false,
      () => true,
    );
    if (refused) void ready().catch(() => undefined);
    const live = device.liveMetrics ?? measuredLive(device);
    stopPerf = await live.start((sample) => session().tell(perfMessage(sample)));
  };

  const listApps = async () => {
    session().tell({ op: 'apps', apps: await device.apps.listApps(hardware?.systemApps === true) });
  };

  const appActions: Record<string, (id: string) => Promise<unknown>> = {
    launch: async (id) => {
      await ready();
      await device.launch(id);
    },
    quit: async (id) => {
      await ready();
      await device.terminate(id);
    },
    remove: async (id) => {
      await device.apps.uninstall(id);
      await listApps();
    },
  };

  return {
    /** A press of what is more than a key; `false` leaves it to the device's own. */
    press(button: string) {
      const swiped = SWIPES[button];
      if (swiped) trying(() => swipe(swiped));
      else if (presses[button]) trying(presses[button]);
      else return false;
      return true;
    },

    /** A control of the window that is no input: a person's, however input is set. */
    onWindow(m: ViewerMessage) {
      if (m.op === 'perfWatch') {
        trying(() => watchPerf(m.on === true));
        return;
      }
      if (m.op === 'app') {
        const act = appActions[String(m.action)];
        trying(act ? () => act(String(m.id)).then(() => undefined) : listApps);
        return;
      }
      if (m.name === 'reconnect') session().askAgain();
      else if (m.name === 'record') trying(record);
      else trying(() => screenshot(m.name === 'copy'));
    },

    /** A movie still being made ends with the window, and keeps what it has. */
    async end() {
      await watchPerf(false);
      await stopRecording?.().catch(() => undefined);
      stopRecording = undefined;
    },
  };
}
