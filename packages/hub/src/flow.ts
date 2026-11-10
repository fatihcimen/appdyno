import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  must,
  type Device,
  type DeviceHardware,
  type InputEvent,
  type Screen,
  type ViewerMessage,
} from '@appdyno/core';
import { type FlowStep, type Recording, stepLine } from '@appdyno/flows';
import { windowSteps } from './window-steps.js';
import { fileName, frontApp, stamp, type WindowSession } from './controls.js';
import { windowInspector } from './inspect.js';
import { windowContext } from './measures.js';
import { followScreen } from './screen-follow.js';
import {
  activeRecording,
  addSteps,
  flagged,
  keepRecording,
  loadRecording,
  saveRecording,
  redact,
  type ServerContext,
  type Session,
  type Size,
  startRecording,
  stepOf,
  unrecorded,
} from '@appdyno/ops';

type FlowSession = Pick<WindowSession, 'tell' | 'status'>;

/** A screen's size as the picture stands: a window's may leave out a bar, and a device's own does not turn with it. */
export function shownSize(own: Size | undefined, window: Size | undefined) {
  if (!own) return window;
  const wide = window ? window.w > window.h : own.w > own.h;
  return wide === own.w > own.h ? { w: own.w, h: own.h } : { w: own.h, h: own.w };
}

/** Where a replay of a recording begun on another device must start. */
const frontNote = (app: string | undefined) =>
  app
    ? `${app} is in front: a replay must start there`
    : 'What is in front has no name: a replay must start there';

/** A save in the bar's capsule, which has room for few words: none to look at is no news. */
const savedNote = (steps: number, notes: number) =>
  `Saved to the Desktop: ${steps} steps${notes ? `, ${notes} to look at` : ''}`;

/**
 * A window's flow: what a person does on it, written as a flow's steps, and what is under the pointer. It reads the
 * screen only while one of them is in use, as a read costs the device. The recording is the one `flow` keeps, on disk,
 * so that an agent's `flow start` takes a person's clicks too, and a window's takes an agent's calls.
 */
export function windowFlow(
  ctx: ServerContext,
  device: Device,
  hardware: DeviceHardware | undefined,
  session: () => FlowSession,
  measuring: () => boolean,
) {
  const { serial } = device;
  const own = windowContext(ctx, device);
  let reader: Session | undefined;
  let recording = false;
  let starting = false;
  let stopping = false;
  let inspecting = false;
  let auditing = false;
  let ours = false;
  let failing: string | undefined;

  const say = (text: string) => session().tell({ op: 'note', text });
  const readerSession = async () => (reader ??= await own.session());

  const follow = followScreen({
    read: async () => {
      const screen = await (await readerSession()).look();
      failing = undefined;
      return screen;
    },
    may: () => session().status.state === 'live' && !measuring(),
    failed: (e) => {
      if (failing !== e.message) say(`The screen could not be read: ${e.message}`);
      failing = e.message;
    },
  });
  const wanted = () => follow.want(recording || inspecting || auditing);
  const sizeOf = (screen: Screen) => shownSize(device.hello?.screen, screen.window);

  /** What the pane shows of the recording. */
  const tellFlow = (r: Recording | undefined, extra: Record<string, unknown> = {}) =>
    session().tell({
      op: 'flow',
      on: recording,
      starting,
      lines: r?.state.steps.map(stepLine) ?? [],
      look: r ? flagged(r.flow()) : [],
      ...extra,
    });

  const steps = windowSteps({
    seen: follow.seen,
    keyOf: (usage) => device.mirror.keyOf(usage),
    fresh: async () => (await readerSession()).look().catch(() => follow.latest()),
    sizeOf,
    keyboardOf: (screen) => device.platformScreen.keyboardArea(screen.tree),
    recording: () => loadRecording(own, serial),
    say,
    wrote: (r) => tellFlow(r),
  });

  const inspector = windowInspector({
    device,
    latest: follow.latest,
    sizeOf,
    tell: (m) => session().tell(m),
    say,
    assert: (step, aim) => {
      if (!recording) return false;
      steps.add(step, aim);
      return true;
    },
    recording: () => recording,
    may: () => session().status.state === 'live' && !measuring(),
    clean: (text) => redact(ctx.policy, text),
  });

  const start = async () => {
    starting = true;
    tellFlow(undefined);
    try {
      const s = await readerSession();
      const { app, mine } = await frontApp(device);
      if (mine) s.select(app);
      await follow.first();
      startRecording(own, serial, mine ? app : undefined, s.owner);
      const r = must(loadRecording(own, serial), 'the recording');
      // to the front if it runs: on another device, the way to where this one is
      if (mine) addSteps(r, stepOf('launch', {}));
      else say(frontNote(app));
      recording = ours = true;
      wanted();
      tellFlow(r);
    } catch (e) {
      say(`No recording: ${(e as Error).message}`);
    } finally {
      starting = false;
      tellFlow(loadRecording(own, serial));
    }
  };

  const stop = async () => {
    stopping = true;
    await steps.finish().finally(() => (stopping = false));
    recording = ours = false;
    wanted();
    const r = loadRecording(own, serial);
    if (!r) {
      tellFlow(undefined);
      return;
    }
    r.state.running = false;
    keepRecording(r);
    if (!r.state.steps.some((st) => st.action !== 'launch')) {
      say('Nothing was recorded');
      tellFlow(undefined);
      return;
    }
    const file = join(homedir(), 'Desktop', `${fileName(device, hardware)} ${stamp()}.flow`);
    const notes = saveRecording(r, file, false);
    say(savedNote(r.state.steps.length, notes.length));
    tellFlow(r, { file });
  };

  const trying = (work: () => Promise<void>) =>
    void work().catch((e: unknown) => say(e instanceof Error ? e.message : String(e)));

  /** A step from the window that is no input. */
  const fromPane = (m: ViewerMessage): FlowStep | undefined => {
    const app = String(m.id);
    if (m.action === 'launch') return stepOf('launch', {}, { app });
    if (m.action === 'quit') return stepOf('stop', {}, { app });
    if (m.action === 'remove') return unrecorded(`removing ${app}`);
    return undefined;
  };

  return {
    /** A person's input, gone to the device already. */
    input: (e: InputEvent) => {
      if (recording) steps.input(e, Date.now());
      follow.touched(e);
    },

    /** A recording runs: a step that restarts the app is refused by name. */
    recording: () => recording,

    /** What is the flow's of what the window says; false: it is another's. */
    onWindow(m: ViewerMessage): boolean {
      const accessibility = m.op === 'paneWatch' && m.pane === 'accessibility';
      if (m.op === 'inspect' || accessibility) {
        if (accessibility) auditing = m.on === true;
        else inspecting = m.on === true;
        inspector.audits(auditing);
        if (m.on === true) trying(() => readerSession().then(() => undefined));
        wanted();
        return true;
      }
      if (m.op === 'control' && m.name === 'auditAgain') {
        inspector.again();
        return true;
      }
      if (m.op === 'hover') {
        inspector.hover({ x: Number(m.x), y: Number(m.y) });
        return true;
      }
      if (m.op === 'pick') {
        inspector.pick(m);
        return true;
      }
      if (m.op === 'control' && m.name === 'recordFlow') {
        if (!starting && !stopping) trying(recording ? stop : start);
        return true;
      }
      if (recording && m.op === 'control' && String(m.name).startsWith('measure')) {
        say('A measure restarts the app: stop the recording first');
        return true;
      }
      if (recording && m.op === 'app') {
        const step = fromPane(m);
        if (step) steps.add(step);
      }
      return false;
    },

    /** A recording may start or stop elsewhere: its file says. */
    follow() {
      if (starting || recording === !!activeRecording(own, serial)) return;
      recording = !recording;
      ours = false;
      wanted();
      tellFlow(loadRecording(own, serial));
    },

    /** The window closed: what was recorded in it is kept, as a movie is. */
    async end() {
      inspector.end();
      if (ours) await stop().catch(() => undefined);
      inspecting = recording = auditing = false;
      wanted();
    },
  };
}
