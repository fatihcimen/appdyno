import { rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pause, safeName, swipeThrough, SYSTEM_SWIPES } from '@appdyno/core';
import type {
  Device,
  DeviceHardware,
  MirrorSession,
  SystemSwipe,
  WindowControl,
} from '@appdyno/core';
import { checkApp, type ActivityLine, type Policy } from '@appdyno/ops';
import type { WindowMeasures } from './measures.js';
import { windowMovie } from './window-movie.js';
import { windowPerf } from './window-perf.js';

const SWIPES: Record<string, SystemSwipe> = SYSTEM_SWIPES;
/** What an agent's `app` call does that puts an app on the device or takes one off. */
const APPS_CHANGE = new Set(['install', 'uninstall', 'build_and_run']);
/** A turn shows in the picture's shape by then, or the app in front refused it. */
const TURN_MS = 2_000;
const TURN_LOOK_MS = 100;

/** By the clock a person reads: a file's name is theirs, and it sorts as the ISO date does. */
export const stamp = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
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

/** What the parts of a window's controls share. */
export type WindowParts = {
  device: Device;
  hardware: DeviceHardware | undefined;
  session: () => WindowSession;
  /** The device agent, started once for what is asked of the device past the stream: the window needs none of its own. */
  ready: () => Promise<unknown>;
  /** A line for the person. */
  note: (text: string) => void;
  /** What is in front, and whether it is the person's own app. */
  frontApp: () => ReturnType<typeof frontApp>;
  /** A file's name for what is taken now: the device's, then the time. */
  stem: () => string;
};

/** Each turn of the picture, the first of which may start the device agent. */
function windowTurns({ device, session, ready, note }: WindowParts, opened: () => boolean) {
  let rotation: 0 | 1 | 2 | 3 = 0;
  const sideways = () => {
    const { picture } = session().status;
    return picture && picture.w > picture.h;
  };
  return async (by: 1 | 3) => {
    // a simulator's orientation has no way in but its runner, which a first turn may have to build
    note(opened() ? 'Rotating' : 'Rotating: the first turn starts the device agent');
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
}

/** A screenshot to the Desktop and the pasteboard, or to the pasteboard only. */
async function screenshotOf(parts: WindowParts, copyOnly: boolean) {
  const { device, hardware, session, ready, note, stem } = parts;
  // no agent is started for what the device can answer without one
  const own = await device.mirror.screenshot?.('png');
  if (!own) await ready();
  const { data } = own ?? (await device.screenshot({ format: 'png' }));
  const file = copyOnly
    ? join(tmpdir(), `${fileName(device, hardware)}-${process.pid}.png`)
    : join(homedir(), 'Desktop', `${stem()}.png`);
  writeFileSync(file, data, { mode: 0o600 });
  session().tell({ op: 'copied', file });
  if (!copyOnly) {
    note(`Saved to the Desktop and copied`);
    return;
  }
  note('Copied');
  await pause(2_000);
  rmSync(file, { force: true });
}

/** The Apps pane: its list, and a launch, quit or removal of an app the policy allows. */
function windowApps({ device, hardware, session, ready }: WindowParts, policy: Policy) {
  /** The list, and what was just done to one of them, by its name. */
  const listApps = async (done?: { id: string; what: string }) => {
    const apps = await device.apps.listApps(hardware?.systemApps === true);
    const name = done ? (apps.find((a) => a.id === done.id)?.name ?? done.id) : undefined;
    session().tell({ op: 'apps', apps, ...(done && name && { note: `${done.what} ${name}` }) });
  };
  const actions: Record<string, (id: string) => Promise<unknown>> = {
    launch: async (id) => {
      checkApp(policy, id);
      await ready();
      await device.launch(id);
      await listApps({ id, what: 'Launched' });
    },
    quit: async (id) => {
      checkApp(policy, id);
      await ready();
      await device.terminate(id);
      await listApps({ id, what: 'Quit' });
    },
    remove: async (id) => {
      checkApp(policy, id);
      await device.apps.uninstall(id);
      await listApps();
    },
  };
  return { listApps, actions };
}

/**
 * What a window's controls do that is not one key to one device: gestures, captures and the Apps pane, which keeps to
 * `policy`'s apps as the Links and Push panes do.
 */
export function windowControls(
  device: Device,
  hardware: DeviceHardware | undefined,
  session: () => WindowSession,
  measures: WindowMeasures,
  policy: Policy,
) {
  let opened: Promise<unknown> | undefined;
  const note = (text: string) => session().tell({ op: 'note', text });
  const trying = (work: () => Promise<unknown>) =>
    void work().catch((e: unknown) => note(e instanceof Error ? e.message : String(e)));
  const parts: WindowParts = {
    device,
    hardware,
    session,
    ready: () =>
      (opened ??= device.open().catch((e: unknown) => {
        opened = undefined;
        throw e;
      })),
    note,
    frontApp: () => frontApp(device),
    stem: () => `${fileName(device, hardware)} ${stamp()}`,
  };
  const rotate = windowTurns(parts, () => opened !== undefined);
  const presses: Record<string, () => Promise<void>> = {
    rotateLeft: () => rotate(1),
    rotateRight: () => rotate(3),
  };
  const movie = windowMovie(parts);
  const perf = windowPerf(parts, measures);
  const apps = windowApps(parts, policy);

  return {
    /** A measure runs: what reads the screen stays out of its numbers. */
    measuring: perf.measuring,

    movieTo: movie.movieTo,

    /** A press of what is more than a key; `false` leaves it to the device's own. */
    press: (button: string) => {
      const swiped = SWIPES[button];
      if (swiped) trying(() => swipeThrough(swiped, (e) => session().send(e)));
      else if (presses[button]) trying(presses[button]);
      else return false;
      return true;
    },

    journey: perf.journey,

    /** What is on the screen, by the device agent, which starts for it. */
    read: async () => {
      await parts.ready();
      return device.tree();
    },

    /** An agent's call on this device: one that installed or removed an app lists the apps again, for the Apps pane. */
    heard: ({ tool, ok, args }: ActivityLine) => {
      const { action } = (args ?? {}) as { action?: unknown };
      if (ok && tool === 'app' && APPS_CHANGE.has(String(action))) trying(() => apps.listApps());
    },

    /** A control of the window that is no input: a person's, however input is set. */
    onWindow(m: WindowControl) {
      if (m.op === 'perfWatch') {
        trying(() => perf.want(m.on));
        return;
      }
      if (m.op === 'app') {
        // an action the window has and this side does not lists the apps, as a list does
        const act = m.action === 'list' ? undefined : apps.actions[m.action];
        trying(act && m.action !== 'list' ? () => act(m.id) : () => apps.listApps());
        return;
      }
      if (m.op !== 'control') return;
      if (m.name === 'reconnect') session().askAgain();
      else if (m.name === 'record') trying(movie.record);
      else if (m.name === 'measureLaunch') trying(() => perf.measure(measures.launch));
      else if (m.name === 'measureScroll') trying(() => perf.measure(measures.scroll));
      else if (m.name === 'journey') trying(() => perf.journey(m.file));
      else if (m.name === 'dashboard') trying(measures.dashboard);
      else if (m.name === 'screenshot' || m.name === 'copy')
        trying(() => screenshotOf(parts, m.name === 'copy'));
    },

    /** A movie still being made ends with the window, and keeps what it has. */
    async end() {
      await perf.end();
      await movie.end();
    },
  };
}
