import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import {
  NoViewProbe,
  stateDir,
  type Framework,
  type LaunchOptions,
  type ViewTree,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';
import { HOME_SCREEN_APP } from './platform-screen.js';
import { HeldLaunches } from './sim-held.js';
import { helperBinary } from './simhelper.js';
import { assertBundle, assertUdid, type Simctl } from './simctl.js';

/** The view probe's name among what an app's launches carry. */
const PROBE = 'view';

/** A socket's path in bytes, the NUL after it making macOS's 104. */
export const MAX_SOCKET_PATH = 103;

/** A process that runs says at once which it is: iOS suspends an app behind another, and its probe with it. */
const HELLO_MS = 2_000;

/** Then the probe answers within 2 s, or says the main thread did not: past this it says nothing more. */
const ANSWER_MS = 10_000;

/** Where the probe in `app` listens: a name short enough for a socket, in a folder that is this Mac user's alone. */
export function viewSocket(udid: string, app: string) {
  const name = createHash('sha256')
    .update(`${assertUdid(udid)} ${assertBundle(app)}`)
    .digest('hex');
  const path = join(stateDir(), 'views', `${name.slice(0, 16)}.sock`);
  const bytes = Buffer.byteLength(path);
  if (bytes > MAX_SOCKET_PATH)
    throw new DeviceError(
      'UNSUPPORTED',
      `the view probe's socket would be ${String(bytes)} bytes long, past the ${String(MAX_SOCKET_PATH)} a socket may have: ${path}`,
      'APPDYNO_STATE_DIR names a state folder with a shorter path',
    );
  return path;
}

const View = z.object({
  class: z.string(),
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  id: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  hidden: z.boolean().optional(),
  alpha: z.number().optional(),
  controller: z.string().optional(),
  parent: z.number().int().nonnegative().optional(),
});

/** The probe's first line: the app and the process it is in. */
const Hello = z.union([
  z.object({ app: z.string(), pid: z.number() }),
  z.object({ error: z.string() }),
]);

/** Its second: the views of the app's windows from the back, each after its parent, read on its main thread. */
const Dump = z.union([
  z.object({
    /** Whether any scene of the app is on the screen: the views are those of the scenes that are. */
    front: z.boolean(),
    views: z.array(View),
    truncated: z.boolean(),
    ms: z.number(),
  }),
  z.object({ error: z.string(), ms: z.number().optional() }),
]);

/** One line of the probe's answer, as this version reads it. */
function lineOf<T>(schema: z.ZodType<T>, line: string | undefined, app: string): T {
  try {
    return schema.parse(JSON.parse(line ?? ''));
  } catch {
    throw new DeviceError(
      'INTERNAL',
      `the view probe in ${app} answered what this version does not read`,
      'a probe stays in its app as it went in until the app next starts',
    );
  }
}

/** The views of `app` in the probe's two lines: its points are a simulator's tap units as they are. */
export function treeOf(answer: string, app: string): ViewTree {
  const [first, second] = answer.split('\n');
  const hello = lineOf(Hello, first, app);
  if ('error' in hello)
    throw new DeviceError('INTERNAL', `the view probe in ${app} refused: ${hello.error}`);
  if (hello.app !== app)
    throw new DeviceError('INTERNAL', `the view probe that answered for ${app} is in ${hello.app}`);
  const dump = lineOf(Dump, second, app);
  if ('error' in dump)
    throw new DeviceError(
      'TIMEOUT',
      `the main thread of ${app} did not answer the view probe within ${String((dump.ms ?? 2000) / 1000)} s`,
      'the app is busy or hung: ask again once it answers',
    );
  if (!dump.front)
    throw new DeviceError(
      'APP_NOT_RUNNING',
      `${app} runs in the background: none of its views is on the screen`,
      'bring it to the front, then ask again',
    );
  return { views: dump.views, truncated: dump.truncated };
}

/** The probe's answer to a dump; a socket no process listens on fails as it does on connecting. */
function ask(path: string, app: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = createConnection(path);
    const timers: NodeJS.Timeout[] = [];
    const end = (e?: Error) => {
      for (const t of timers) clearTimeout(t);
      socket.destroy();
      if (e) reject(e);
      else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const after = (ms: number, e: DeviceError) => timers.push(setTimeout(() => end(e), ms));
    after(
      HELLO_MS,
      new DeviceError(
        'APP_NOT_RUNNING',
        `${app} does not run: iOS suspends an app behind another, and its view probe with it`,
        'bring it to the front, then ask again',
      ),
    );
    after(
      ANSWER_MS,
      new DeviceError(
        'TIMEOUT',
        `the view probe in ${app} gave no answer within ${String(ANSWER_MS / 1000)} s`,
      ),
    );
    socket.on('connect', () => socket.end('dump\n'));
    socket.on('data', (c: Buffer) => {
      chunks.push(c);
      // it runs: what is left has the longer limit
      if (c.includes(0x0a)) clearTimeout(timers[0]);
    });
    socket.on('end', () => {
      end();
    });
    socket.on('error', end);
  });
}

/** No probe listens: none was put in, or the process it went into has ended since. */
const unheard = (e: unknown) =>
  e instanceof Error &&
  ['ENOENT', 'ECONNREFUSED'].includes((e as NodeJS.ErrnoException).code ?? '');

/**
 * What draws a whole app, by what its bundle holds: Flutter's engine, or React Native's engine or its JavaScript. None
 * of those leaves SwiftUI, UIKit or a web view, which only the probe tells apart.
 */
export function bundleFramework(bundle: string): Framework | undefined {
  let frameworks: string[] = [];
  try {
    frameworks = readdirSync(join(bundle, 'Frameworks'));
  } catch {
    // an app with no framework of its own
  }
  if (frameworks.includes('Flutter.framework')) return 'Flutter';
  if (frameworks.some((f) => /^hermes.*\.framework$/i.test(f))) return 'React Native';
  return existsSync(join(bundle, 'main.jsbundle')) ? 'React Native' : undefined;
}

/**
 * An app's native views on a simulator, by the view probe (`ios/SimHelper/ViewProbe.m`) that a launch puts in it and
 * this tool's later launches of it keep: a read asks the probe, and never starts the app again.
 */
export class SimulatorViews {
  /** What each app's bundle holds, by the bundle's folder: a reinstall puts the app in a new one. */
  private readonly bundles = new Map<string, Framework | undefined>();

  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
    private readonly holds = new HeldLaunches(udid),
  ) {}

  /** `app` started afresh with the probe in it, as `own` says, and held in each launch of it by this tool from now on. */
  async launch(app: string, own: LaunchOptions) {
    const socket = viewSocket(this.udid, app);
    mkdirSync(dirname(socket), { recursive: true, mode: 0o700 });
    const lib = await helperBinary('ViewProbe');
    this.holds.hold(app, PROBE, { lib, env: { APPDYNO_VIEW_SOCKET: socket } });
    // one that did not start has no probe to keep
    await this.simctl.restart(this.udid, app, own).catch((e: unknown) => {
      this.holds.drop(app, PROBE);
      throw e;
    });
  }

  /**
   * The views of the app on the screen, by the probe in it: the app reads take, each this tool's launches hold the probe
   * in, and the one a look at the screen names are asked at once, and the first to answer with its views is the one. An
   * app behind another says nothing for 2 s; the look waits on a hung app in front, and names the home screen under a
   * system alert. A main thread that does not answer is said at once.
   */
  read(app: string | undefined, front: () => Promise<string | undefined>): Promise<ViewTree> {
    return new Promise((resolve, reject) => {
      const failed = new Map<string, Error>();
      let named: string | undefined;
      // the look, and each app asked
      let open = 1;
      const settle = () => {
        if (--open > 0) return;
        // the refusal of the app the look named, else of the one reads take, else the first
        const why = [named, app, ...failed.keys()]
          .map((a) => (a === undefined ? undefined : failed.get(a)))
          .find((e) => e !== undefined);
        reject(
          why ??
            new DeviceError(
              'APP_NOT_RUNNING',
              'no app is in front, and the home screen has no views to read',
              'an app started with the view probe has them',
            ),
        );
      };
      const asked = new Set<string>();
      const ask = (a: string | undefined) => {
        if (!a || a === HOME_SCREEN_APP || asked.has(a)) return;
        asked.add(a);
        open++;
        this.readOf(a).then(resolve, (e: unknown) => {
          // only a process that runs, its main thread stuck, gives this: the app on the screen
          if (e instanceof DeviceError && e.code === 'TIMEOUT') reject(e);
          failed.set(a, e instanceof Error ? e : new DeviceError('INTERNAL', String(e)));
          settle();
        });
      };
      ask(app);
      for (const a of this.holds.appsWith(PROBE)) ask(a);
      void front()
        .catch(() => undefined)
        .then((f) => {
          named = f;
          ask(f);
          settle();
        });
    });
  }

  private async readOf(app: string): Promise<ViewTree> {
    const answer = await ask(viewSocket(this.udid, app), app).catch(async (e: unknown) => {
      if (unheard(e)) throw await this.withoutProbe(app);
      if (e instanceof DeviceError) throw e;
      throw new DeviceError('INTERNAL', `the view probe in ${app}: ${String(e)}`);
    });
    return treeOf(answer, app);
  }

  /**
   * The refusal of a read with no probe in the app, with what its bundle tells of the whole app; an app that does not run
   * has no process for a probe, held or not, and its next launch is what puts one in.
   */
  private async withoutProbe(app: string) {
    if (!(await this.simctl.running(this.udid, app).catch(() => true)))
      return new DeviceError(
        'APP_NOT_RUNNING',
        `${app} is not running`,
        this.holds.appsWith(PROBE).includes(app)
          ? "start it: this tool's launches of it hold the view probe"
          : 'start it with the view probe',
      );
    const kind = await this.appLevel(app).catch(() => undefined);
    const by = kind
      ? `app-level, by its bundle: ${kind}`
      : 'its bundle holds no Flutter or React Native';
    return new NoViewProbe(
      `${app} runs without the view probe; ${by}. Which framework draws this screen, the probe tells`,
    );
  }

  private async appLevel(app: string) {
    const bundle = await this.simctl.appContainer(this.udid, app);
    if (!this.bundles.has(bundle)) this.bundles.set(bundle, bundleFramework(bundle));
    return this.bundles.get(bundle);
  }
}
