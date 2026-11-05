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
import type { WindowMeasures } from './measures.js';

const SWIPES: Record<string, SystemSwipe> = SYSTEM_SWIPES;
const RECORD_MAX_S = 3_600;
/** A turn shows in the picture's shape by then, or the app in front refused it. */
const TURN_MS = 2_000;
const TURN_LOOK_MS = 100;
/** How often a device's own source is told what is in front: one call to its agent while that stays the same. */
const APP_LOOK_MS = 5_000;

export const stamp = () =>
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

/** How a movie ended: what it came to in words, and why it ended early or holds little. */
export type MovieEnd = { kept: boolean; what: string; why?: string };

export type WindowSession = Pick<
  MirrorSession,
  'send' | 'tell' | 'recording' | 'streamsItsOwn' | 'askAgain' | 'status'
>;

/** What is in front, and whether it is a person's own app. */
export async function frontApp(device: Device) {
  const app = await (device.frontApp?.() ?? device.foreground());
  const mine = !!app && (await device.apps.listApps(false)).some((a) => a.id === app);
  return { app, mine };
}

/** A device's name, for a file. */
export const fileName = (device: Device, hardware: DeviceHardware | undefined) =>
  safeName(hardware?.name ?? hardware?.model ?? device.serial);

/** What a window's controls do that is not one key to one device: gestures, captures and the Apps pane. */
export function windowControls(
  device: Device,
  hardware: DeviceHardware | undefined,
  session: () => WindowSession,
  measures: WindowMeasures,
) {
  const name = () => fileName(device, hardware);
  let opened: Promise<unknown> | undefined;
  let rotation: 0 | 1 | 2 | 3 = 0;
  let stopRecording: (() => Promise<MovieEnd>) | undefined;
  let stopPerf: (() => void) | undefined;
  let readingsWanted = false;
  let measuring = false;
  let readingsTurn: Promise<void> = Promise.resolve();

  /** The window needs no agent of its own; what is asked of the device past the stream does. */
  const ready = () =>
    (opened ??= device.open().catch((e: Error) => {
      opened = undefined;
      throw e;
    }));
  const note = (text: string) => session().tell({ op: 'note', text });
  const trying = (work: () => Promise<void>) => void work().catch((e: Error) => note(e.message));

  const swipe = (way: SystemSwipe) => swipeThrough(way, (e) => session().send(e));

  const sideways = () => {
    const { picture } = session().status;
    return picture && picture.w > picture.h;
  };

  const rotate = async (by: 1 | 3) => {
    // a simulator's orientation has no way in but its runner, which a first turn may have to build
    note(opened ? 'Rotating' : 'Rotating: the first turn starts the device agent');
    await ready();
    const [was, shape] = [rotation, sideways()];
    rotation = ((rotation + by) % 4) as 0 | 1 | 2 | 3;
    await device.setOrientation(rotation);
    const end = Date.now() + TURN_MS;
    while (sideways() === shape && Date.now() < end) await pause(TURN_LOOK_MS);
    if (sideways() !== shape) return;
    // an app that holds the screen as it is, such as a launcher: a turn left asked for would wait for the next app
    rotation = was;
    await device.setOrientation(was);
    note('The app in front does not turn');
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

  /** A movie into `file`, by what this source has, and how to end it: once, however many ask. */
  const movieTo = async (file: string) => {
    const { recorder } = device;
    let finish: () => Promise<MovieEnd>;
    if (session().streamsItsOwn) {
      // its frames as the stream has them: nothing is encoded twice
      session().recording.start(file);
      finish = async () => {
        const r = await session().recording.stop();
        const took = r.seconds ? ` in ${r.seconds.toFixed(1)} s` : '';
        return {
          kept: r.frames > 0,
          what: `${r.frames} frames${took}`,
          ...(r.why && { why: r.why }),
        };
      };
    } else {
      const handle = await recorder.start(file, { maxSeconds: RECORD_MAX_S });
      finish = async () => {
        const { files, note: why } = await recorder.stop(handle);
        const what = `${files.length} file${files.length > 1 ? 's' : ''}`;
        return { kept: files.length > 0, what, ...(why && { why }) };
      };
    }
    let ending: Promise<MovieEnd> | undefined;
    const stop = () => {
      stopRecording = undefined;
      return (ending ??= finish());
    };
    stopRecording = stop;
    return stop;
  };

  const record = async () => {
    if (stopRecording) {
      session().tell({ op: 'recording', on: false });
      const { what, why } = await stopRecording();
      note(why ?? `Saved to Movies: ${what}`);
      return;
    }
    const movies = join(homedir(), 'Movies');
    mkdirSync(movies, { recursive: true });
    const type = session().streamsItsOwn ? 'mp4' : device.recorder.extension;
    await movieTo(join(movies, `${name()} ${stamp()}.${type}`));
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

  const tellMeasured = (m: Record<string, unknown>) => session().tell({ op: 'measured', ...m });
  const saying = (line: string) => session().tell({ op: 'measuring', line });

  /** A measure has the device to itself: nothing reads over what it counts, and no second one starts. */
  const alone = async <T>(work: () => Promise<T>) => {
    if (measuring) {
      note('A measure is running');
      return undefined;
    }
    measuring = true;
    try {
      saying('Starting the device agent');
      await turnReadings();
      await ready();
      return await work();
    } catch (e) {
      tellMeasured({ title: 'No measure', detail: (e as Error).message });
      return undefined;
    } finally {
      measuring = false;
      await turnReadings();
    }
  };

  /** A real measure of the app in front, by the tools an agent calls: what is the system's is not measured. */
  const measure = (work: WindowMeasures['launch']) =>
    alone(async () => {
      const { app, mine } = await frontApp(device);
      if (!app || !mine) {
        const front = app ?? 'Nothing that can be named';
        tellMeasured({
          title: 'Open an app first',
          detail: `${front} is in front, and is not an app of yours`,
        });
        return;
      }
      tellMeasured({ ok: true, ...(await work(app, saying)) });
    });

  /** A flow as a measure, with what a window beside this one needs to compare it. */
  const journey = (file: string) =>
    alone(async () => {
      const front = await frontApp(device).catch(() => undefined);
      const { said, ran } = await measures.journey(
        file,
        front?.mine ? front.app : undefined,
        saying,
      );
      tellMeasured({ ok: true, ...said });
      return ran;
    });

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
    /** A measure runs: what reads the screen stays out of its numbers. */
    measuring: () => measuring,

    movieTo,

    /** A press of what is more than a key; `false` leaves it to the device's own. */
    press(button: string) {
      const swiped = SWIPES[button];
      if (swiped) trying(() => swipe(swiped));
      else if (presses[button]) trying(presses[button]);
      else return false;
      return true;
    },

    journey,

    /** What is on the screen, by the device agent, which starts for it. */
    read: async () => {
      await ready();
      return device.tree();
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
      else if (m.name === 'journey') trying(() => journey(String(m.file)).then(() => undefined));
      else if (m.name === 'dashboard') trying(measures.dashboard);
      else if (m.name === 'screenshot' || m.name === 'copy')
        trying(() => screenshot(m.name === 'copy'));
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
