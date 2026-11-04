import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  measuredLive,
  pause,
  perfMessage,
  safeName,
  swipeThrough,
  SYSTEM_SWIPES,
} from '@appdyno/core';
import type {
  Device,
  DeviceHardware,
  MirrorSession,
  SystemSwipe,
  ViewerMessage,
} from '@appdyno/core';
import type { MeasureWords, WindowMeasures } from './measures.js';

const SWIPES: Record<string, SystemSwipe> = SYSTEM_SWIPES;
const RECORD_MAX_S = 3_600;
/** How often a device's own source is told what is in front: one call to its agent while that stays the same. */
const APP_LOOK_MS = 5_000;

const stamp = () =>
  new Date()
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace('T', ' ')
    .replace(/:/g, '.');

/** How a device looks on a window: its frame and the controls it has. */
export function windowLook(hardware: DeviceHardware | undefined) {
  const name = hardware?.name ?? hardware?.model;
  return {
    frame: { model: hardware?.model, platform: hardware?.platform, color: hardware?.color },
    controls: hardware?.controls ?? [],
    ...(name && { name }),
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
  measures: WindowMeasures,
) {
  const name = () => safeName(hardware?.name ?? hardware?.model ?? device.serial);
  let opened: Promise<unknown> | undefined;
  let rotation: 0 | 1 | 2 | 3 = 0;
  let stopRecording: (() => Promise<string>) | undefined;
  let stopPerf: (() => void) | undefined;
  let readingsWanted = false;
  let measuring = false;
  let readingsTurn: Promise<void> = Promise.resolve();

  /** The window needs no agent of its own; what is asked of the device past the stream does. */
  const ready = () => (opened ??= device.open());
  const note = (text: string) => session().tell({ op: 'note', text });
  const trying = (work: () => Promise<void>) => void work().catch((e: Error) => note(e.message));

  const swipe = (way: SystemSwipe) => swipeThrough(way, (e) => session().send(e));

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

  const inFront = () => device.frontApp?.() ?? device.foreground();

  /**
   * A device's own source where it has one, or its measures: nothing is read while nothing shows it, nor while a measure
   * runs, whose counts a reading would reset.
   */
  const followReadings = async () => {
    stopPerf?.();
    stopPerf = undefined;
    if (!readingsWanted || measuring) return;
    // only a device that has no way to say what is in front but its agent starts it: a late answer is no refusal
    let front: string | undefined;
    const refused = await inFront().then(
      (app) => void (front = app),
      () => true,
    );
    if (refused) void ready().catch(() => undefined);
    // its measures ask each turn what is in front; a device's own source reads the app it is given, and is told again
    const own = device.liveMetrics;
    const live = own ?? measuredLive(device);
    const stop = await live.start(
      (sample) => session().tell(perfMessage(sample)),
      own ? front : undefined,
    );
    const looking = own ? setInterval(() => void lookAgain(front), APP_LOOK_MS) : undefined;
    stopPerf = () => {
      clearInterval(looking);
      stop();
    };
  };

  /** A person moves on, and the numbers go with them. */
  const lookAgain = async (front: string | undefined) => {
    const now = await inFront().catch(() => front);
    if (now !== front && stopPerf) await turnReadings();
  };

  /** One at a time: a window quickly closed must not leave a source that started late running. */
  const turnReadings = () => (readingsTurn = readingsTurn.then(followReadings, followReadings));

  /** A real measure of the app in front, by the tools an agent calls: what is the system's is not measured. */
  const measure = async (work: WindowMeasures['launch']) => {
    if (measuring) return note('A measure is running');
    measuring = true;
    const tell = (m: Record<string, unknown>) => session().tell({ op: 'measured', ...m });
    try {
      session().tell({ op: 'measuring', line: 'Starting the device agent' });
      await turnReadings();
      await ready();
      const app = await inFront();
      const mine = app && (await device.apps.listApps(false)).some((a) => a.id === app);
      if (!mine) {
        const front = app ?? 'Nothing that can be named';
        tell({
          title: 'Open an app first',
          detail: `${front} is in front, and is not an app of yours`,
        });
        return;
      }
      const said: MeasureWords = await work(app, (line) =>
        session().tell({ op: 'measuring', line }),
      );
      tell({ ok: true, ...said });
    } catch (e) {
      tell({ title: 'No measure', detail: (e as Error).message });
    } finally {
      measuring = false;
      await turnReadings();
    }
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
        readingsWanted = m.on === true;
        trying(turnReadings);
        return;
      }
      if (m.op === 'app') {
        const act = appActions[String(m.action)];
        trying(act ? () => act(String(m.id)).then(() => undefined) : listApps);
        return;
      }
      if (m.name === 'reconnect') session().askAgain();
      else if (m.name === 'record') trying(record);
      else if (m.name === 'measureLaunch') trying(() => measure(measures.launch));
      else if (m.name === 'measureScroll') trying(() => measure(measures.scroll));
      else if (m.name === 'dashboard') trying(measures.dashboard);
      else trying(() => screenshot(m.name === 'copy'));
    },

    /** A movie still being made ends with the window, and keeps what it has. */
    async end() {
      readingsWanted = false;
      await turnReadings();
      await stopRecording?.().catch(() => undefined);
      stopRecording = undefined;
    },
  };
}
