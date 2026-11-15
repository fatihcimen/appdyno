import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { frameworkOfViews, NoViewProbe, stateDir, type Device } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { IosPhoneDevice } from '../src/phone.js';
import { HeldLaunches } from '../src/sim-held.js';
import {
  bundleFramework,
  MAX_SOCKET_PATH,
  SimulatorViews,
  treeOf,
  viewSocket,
} from '../src/sim-views.js';
import { Simctl } from '../src/simctl.js';
import { SimulatorApps } from '../src/simulator-manage.js';

const SIM = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const APP = 'dev.appdyno.fixture';
const OTHER = 'dev.appdyno.other';
const CHILD = 'SIMCTL_CHILD_';

/** What the probe read on the fixture's screens on an iPhone 17 simulator, iOS 26.5, Xcode 26.5: its second line. */
const recorded = (name: string) =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures/sim-views', `${name}.json`), 'utf8'),
  ) as Record<string, unknown>;

/** The probe's two lines: the app and process it is in, then what it read. */
const answer = (dump: object, app = APP) =>
  `${JSON.stringify({ app, pid: 4242 })}\n${JSON.stringify(dump)}\n`;

const refusal = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  assert(e instanceof DeviceError, String(e));
  return { code: e.code, message: e.message, hint: e.hint, unprobed: e instanceof NoViewProbe };
};

let helpers = '';
let bundle = '';
beforeEach(() => {
  // short: a socket's path has 103 bytes, and the run's own state folder is deep in the temporary one
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'adv-')));
  helpers = mkdtempSync(join(tmpdir(), 'appdyno-views-helpers-'));
  writeFileSync(join(helpers, 'ViewProbe'), '');
  vi.stubEnv('APPDYNO_HELPERS', helpers);
  bundle = mkdtempSync(join(tmpdir(), 'appdyno-views-app-'));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the view probe's answer", () => {
  it('gives the views as the probe read them, each class kept as it came, and the framework of each screen', () => {
    const labels = Object.fromEntries(
      ['home', 'uikit', 'web'].map((s) => [
        s,
        frameworkOfViews(treeOf(answer(recorded(s)), APP), 'ios'),
      ]),
    );
    expect(labels).toEqual({
      home: { name: 'SwiftUI' },
      uikit: { name: 'UIKit', inside: 'SwiftUI' },
      web: { name: 'web view', inside: 'SwiftUI' },
    });
    const uikit = treeOf(answer(recorded('uikit')), APP);
    expect(uikit.truncated).toBe(false);
    expect(uikit.views.find((v) => v.id === 'uikit_label')).toEqual({
      class: 'UILabel',
      rect: { x: 16, y: 116, width: 370, height: 20.3 },
      id: 'uikit_label',
      label: 'UIKit label',
      text: 'UIKit label',
      parent: 11,
    });
    expect(uikit.views.find((v) => v.controller?.includes('TableController'))?.controller).toBe(
      'Fixture.UIKitScreen.TableController',
    );
  });

  it('labels a screen as well by the names a runtime with no demangler leaves mangled', () => {
    const mangled = treeOf(answer(recorded('uikit-mangled')), APP);
    expect(mangled.views.map((v) => v.class)).toContain(
      '_TtGC7SwiftUI21UIKitPlatformViewHostGVS_42PlatformViewControllerRepresentableAdaptorV7Fixture11UIKitScreen__',
    );
    expect(frameworkOfViews(mangled, 'ios')).toEqual({ name: 'UIKit', inside: 'SwiftUI' });
  });

  it('says a main thread that did not answer, an app in the background, and an answer of another app', async () => {
    const of = (text: string) => refusal(Promise.resolve().then(() => treeOf(text, APP)));
    expect(await of(answer({ error: 'main-thread', ms: 2000 }))).toEqual({
      code: 'TIMEOUT',
      message: `the main thread of ${APP} did not answer the view probe within 2 s`,
      hint: 'the app is busy or hung: ask again once it answers',
      unprobed: false,
    });
    const dump = { front: false, views: [], truncated: false, ms: 1 };
    expect(await of(answer(dump))).toEqual({
      code: 'APP_NOT_RUNNING',
      message: `${APP} runs in the background: none of its views is on the screen`,
      hint: 'bring it to the front, then ask again',
      unprobed: false,
    });
    expect((await of(answer({ ...dump, front: true }, 'dev.other'))).message).toBe(
      `the view probe that answered for ${APP} is in dev.other`,
    );
    expect((await of('{"error":"request"}\n')).message).toBe(
      `the view probe in ${APP} refused: request`,
    );
    // a probe of an older version, still in the app, and an answer cut short
    for (const text of ['{"views":', `${JSON.stringify({ app: APP, pid: 1 })}\n`])
      expect(await of(text)).toEqual({
        code: 'INTERNAL',
        message: `the view probe in ${APP} answered what this version does not read`,
        hint: 'a probe stays in its app as it went in until the app next starts',
        unprobed: false,
      });
  });
});

describe("the view probe's socket", () => {
  it('is one short name per app and simulator, in a folder of the state folder', () => {
    const path = viewSocket(SIM, APP);
    expect(dirname(path)).toBe(join(stateDir(), 'views'));
    expect(path).toMatch(/\/[0-9a-f]{16}\.sock$/);
    expect(viewSocket(SIM, APP)).toBe(path);
    expect(viewSocket(SIM, 'dev.other')).not.toBe(path);
    expect(viewSocket(SIM.replace('A', 'F'), APP)).not.toBe(path);
    // the state folder a person has by default: its home's caches, under any name a Mac gives a user
    vi.stubEnv('APPDYNO_STATE_DIR', `/Users/${'n'.repeat(40)}/Library/Caches/appdyno`);
    expect(Buffer.byteLength(viewSocket(SIM, APP))).toBeLessThanOrEqual(MAX_SOCKET_PATH);
  });

  it('is refused where the state folder is too deep for it, before anything starts', async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', `/tmp/${'d'.repeat(80)}`);
    const launches: string[][] = [];
    const simctl = Object.assign(new Simctl({}), {
      exec: (args: string[]) => {
        launches.push(args);
        return Promise.resolve('');
      },
    });
    const r = await refusal(new SimulatorApps(simctl, SIM).launchWith(APP, { probe: true }));
    expect(r.code).toBe('UNSUPPORTED');
    expect(r.message).toMatch(/^the view probe's socket would be 1\d\d bytes long, past the 103/);
    expect(r.hint).toBe('APPDYNO_STATE_DIR names a state folder with a shorter path');
    expect(launches).toEqual([]);
  });
});

/** A simulator whose launches are kept with what went into the app's environment. */
const simulator = (fails = false) => {
  const launches: Record<string, string>[] = [];
  const simctl = Object.assign(new Simctl({}), {
    exec: (args: string[], _ms?: number, env: Record<string, string | undefined> = {}) => {
      if (args[0] !== 'launch') return Promise.resolve('');
      const own = Object.entries(env).flatMap(([k, v]): [string, string][] =>
        k.startsWith(CHILD) && v !== undefined ? [[k.slice(CHILD.length), v]] : [],
      );
      launches.push(Object.fromEntries(own));
      return fails ? Promise.reject(new Error('no such app')) : Promise.resolve(`${APP}: 4242`);
    },
    appContainer: () => Promise.resolve(bundle),
  });
  return { simctl, launches };
};

describe('launch_app probe on a simulator', () => {
  it("puts the probe in, and this tool's later launches of the app keep it", async () => {
    const { simctl, launches } = simulator();
    const apps = new SimulatorApps(simctl, SIM, new SimulatorViews(simctl, SIM));
    expect(apps.viewProbe).toBe(true);
    await apps.launchWith(APP, { probe: true, env: { A: '1' } });
    await apps.launchWith(APP, { args: ['-x'] });
    const probe = { DYLD_INSERT_LIBRARIES: join(helpers, 'ViewProbe') };
    const socket = { APPDYNO_VIEW_SOCKET: viewSocket(SIM, APP) };
    expect(launches).toEqual([
      { ...socket, ...probe, A: '1' },
      { ...socket, ...probe },
    ]);
    expect(new HeldLaunches(SIM).letGo()).toEqual([`the view probe in ${APP}`]);
  });

  it('lets go of the probe where the app did not start', async () => {
    const { simctl } = simulator(true);
    await expect(new SimulatorApps(simctl, SIM).launchWith(APP, { probe: true })).rejects.toThrow(
      'no such app',
    );
    expect(new HeldLaunches(SIM).holder()).toBeUndefined();
  });
});

describe('a read of the views on a simulator', () => {
  let probes: Server[] = [];
  let held: Socket[] = [];
  /** A probe in `app`, answering each dump as told; none: in an app iOS has suspended, which says nothing. */
  const listen = async (said: string | undefined, app = APP) => {
    const path = viewSocket(SIM, app);
    mkdirSync(dirname(path), { recursive: true });
    const server = createServer((c) => {
      held.push(c);
      if (said === undefined) return;
      c.once('data', (d) => c.end(String(d).startsWith('dump') ? said : '{"error":"request"}'));
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    probes.push(server);
  };
  /** The recorded web screen, as the probe in `app` would answer it, with `front`. */
  const web = (app: string, front = true) => answer({ ...recorded('web'), front }, app);
  const none = () => Promise.resolve(undefined);
  afterEach(async () => {
    for (const c of held) c.destroy();
    await Promise.all(probes.map((p) => new Promise((resolve) => p.close(resolve))));
    [probes, held] = [[], []];
  });

  it('asks the probe in the app, and gives what it answered', async () => {
    await listen(web(APP));
    // a look at the screen waits on a hung app in front, as long as its own limit
    const hung = () => new Promise<undefined>(() => undefined);
    const tree = await new SimulatorViews(simulator().simctl, SIM).read(APP, hung);
    expect(tree.views).toHaveLength(48);
    expect(tree.views.some((v) => v.class === 'WKWebView')).toBe(true);
  });

  it('reads the app in front where the one reads take has no probe in it, or is behind', async () => {
    const views = new SimulatorViews(simulator().simctl, SIM);
    await listen(web(OTHER), OTHER);
    const front = () => Promise.resolve(OTHER);
    expect((await views.read(APP, front)).views).toHaveLength(48);
    await listen(web(APP, false));
    expect((await views.read(APP, front)).views).toHaveLength(48);
    expect((await views.read(undefined, front)).views).toHaveLength(48);
  });

  it('tells within 2 s an app iOS has suspended, whose probe says nothing, and reads the one in front', async () => {
    const views = new SimulatorViews(simulator().simctl, SIM);
    await listen(undefined);
    const from = Date.now();
    expect(await refusal(views.read(APP, none))).toEqual({
      code: 'APP_NOT_RUNNING',
      message: `${APP} does not run: iOS suspends an app behind another, and its view probe with it`,
      hint: 'bring it to the front, then ask again',
      unprobed: false,
    });
    expect(Date.now() - from).toBeLessThan(3_000);
    // the look at the screen tells the app in front first, with no wait for the silence
    await listen(web(OTHER), OTHER);
    const at = Date.now();
    expect((await views.read(APP, () => Promise.resolve(OTHER))).views).toHaveLength(48);
    expect(Date.now() - at).toBeLessThan(1_000);
  }, 10_000);

  it("reads an app this tool's launches hold the probe in, where a system alert makes the look name the home screen", async () => {
    new HeldLaunches(SIM).hold(OTHER, 'view', { lib: join(helpers, 'ViewProbe'), env: {} });
    await listen(web(OTHER), OTHER);
    const views = new SimulatorViews(simulator().simctl, SIM);
    const home = () => Promise.resolve('com.apple.springboard');
    expect((await views.read(APP, home)).views).toHaveLength(48);
  });

  it('says at once a main thread of the app reads take that does not answer, while the look waits on it', async () => {
    await listen(answer({ error: 'main-thread', ms: 2000 }));
    const hung = () => new Promise<undefined>(() => undefined);
    const r = await refusal(new SimulatorViews(simulator().simctl, SIM).read(APP, hung));
    expect([r.code, r.message]).toEqual([
      'TIMEOUT',
      `the main thread of ${APP} did not answer the view probe within 2 s`,
    ]);
  });

  it('says the refusal of the app the look names before that of the app reads take', async () => {
    const views = new SimulatorViews(simulator().simctl, SIM);
    const r = await refusal(views.read(APP, () => Promise.resolve(OTHER)));
    expect([r.unprobed, r.message.startsWith(`${OTHER} runs without the view probe`)]).toEqual([
      true,
      true,
    ]);
  });

  it('says the refusal of the app reads take where nothing else is in front', async () => {
    const views = new SimulatorViews(simulator().simctl, SIM);
    for (const front of [APP, 'com.apple.springboard', undefined])
      expect((await refusal(views.read(APP, () => Promise.resolve(front)))).unprobed).toBe(true);
    await listen(web(APP, false));
    expect((await refusal(views.read(APP, none))).code).toBe('APP_NOT_RUNNING');
  });

  it('refuses an app no probe answers in, with what its bundle says of the whole app', async () => {
    const views = new SimulatorViews(simulator().simctl, SIM);
    // what puts the probe in is the operations' to say
    expect(await refusal(views.read(APP, none))).toEqual({
      code: 'UNSUPPORTED',
      message: `${APP} runs without the view probe; its bundle holds no Flutter or React Native. Which framework draws this screen, the probe tells`,
      hint: undefined,
      unprobed: true,
    });
    // the socket of a process that ended since, as a crash leaves it
    const path = viewSocket(SIM, APP);
    mkdirSync(dirname(path), { recursive: true });
    const ended = spawn(process.execPath, [
      '-e',
      `require('net').createServer().listen(${JSON.stringify(path)}, () => console.log('up'))`,
    ]);
    await new Promise((resolve) => ended.stdout.once('data', resolve));
    ended.kill('SIGKILL');
    await new Promise((resolve) => ended.once('exit', resolve));
    expect(existsSync(path)).toBe(true);
    expect((await refusal(views.read(APP, none))).unprobed).toBe(true);
  });

  it('names Flutter or React Native by what the bundle holds, read once per installed app', async () => {
    mkdirSync(join(bundle, 'Frameworks/Flutter.framework'), { recursive: true });
    const views = new SimulatorViews(simulator().simctl, SIM);
    expect((await refusal(views.read(APP, none))).message).toMatch(
      /without the view probe; app-level, by its bundle: Flutter\. Which framework/,
    );
    rmSync(join(bundle, 'Frameworks'), { recursive: true });
    expect((await refusal(views.read(APP, none))).message).toContain('by its bundle: Flutter.');
  });

  it('refuses the home screen, with no app named', async () => {
    const views = new SimulatorViews(simulator().simctl, SIM);
    for (const front of [undefined, 'com.apple.springboard'])
      expect((await refusal(views.read(undefined, () => Promise.resolve(front)))).code).toBe(
        'APP_NOT_RUNNING',
      );
    expect((await refusal(views.read('com.apple.springboard', none))).code).toBe('APP_NOT_RUNNING');
  });

  it('is none on an iPhone, whose apps take no probe', () => {
    const phone: Device = new IosPhoneDevice('00001234-0123456789ABCDEF', { profile: '/p' });
    expect(['views' in phone, phone.apps.viewProbe]).toEqual([false, undefined]);
  });
});

describe('what an app bundle holds', () => {
  it("is Flutter by Flutter's engine, React Native by Hermes or the bundled JavaScript, else not known", () => {
    const app = (...files: string[]) => {
      const dir = mkdtempSync(join(tmpdir(), 'appdyno-views-bundle-'));
      for (const f of files) {
        mkdirSync(dirname(join(dir, f)), { recursive: true });
        if (f.endsWith('.framework')) mkdirSync(join(dir, f));
        else writeFileSync(join(dir, f), '');
      }
      return bundleFramework(dir);
    };
    expect(app('Frameworks/Flutter.framework', 'Frameworks/App.framework')).toBe('Flutter');
    expect(app('Frameworks/hermes.framework')).toBe('React Native');
    expect(app('Frameworks/hermesvm.framework')).toBe('React Native');
    expect(app('main.jsbundle')).toBe('React Native');
    expect(app('Frameworks/Alamofire.framework')).toBeUndefined();
    expect(app()).toBeUndefined();
  });
});
