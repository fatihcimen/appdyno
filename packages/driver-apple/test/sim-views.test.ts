import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { frameworkOfViews, NoViewProbe, stateDir } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';
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
const CHILD = 'SIMCTL_CHILD_';

/** What the probe answered on the fixture's screens on an iPhone 17 simulator, iOS 26.5, Xcode 26.5. */
const recorded = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures/sim-views', `${name}.json`), 'utf8');

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
      ['home', 'uikit', 'web'].map((s) => [s, frameworkOfViews(treeOf(recorded(s), APP), 'ios')]),
    );
    expect(labels).toEqual({
      home: { name: 'SwiftUI' },
      uikit: { name: 'UIKit', inside: 'SwiftUI' },
      web: { name: 'web view', inside: 'SwiftUI' },
    });
    const uikit = treeOf(recorded('uikit'), APP);
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
    const mangled = treeOf(recorded('uikit-mangled'), APP);
    expect(mangled.views.map((v) => v.class)).toContain(
      '_TtGC7SwiftUI21UIKitPlatformViewHostGVS_42PlatformViewControllerRepresentableAdaptorV7Fixture11UIKitScreen__',
    );
    expect(frameworkOfViews(mangled, 'ios')).toEqual({ name: 'UIKit', inside: 'SwiftUI' });
  });

  it('says a main thread that did not answer, an app in the background, and an answer of another app', async () => {
    const of = (answer: object) =>
      refusal(Promise.resolve().then(() => treeOf(JSON.stringify(answer), APP)));
    expect(await of({ error: 'main-thread', ms: 2000 })).toEqual({
      code: 'TIMEOUT',
      message: `the main thread of ${APP} did not answer the view probe within 2 s`,
      hint: 'the app is busy or hung: ask again once it answers',
      unprobed: false,
    });
    const dump = { app: APP, pid: 1, front: false, views: [], truncated: false, ms: 1 };
    expect(await of(dump)).toEqual({
      code: 'APP_NOT_RUNNING',
      message: `${APP} runs in the background: none of its views is on the screen`,
      hint: 'bring it to the front, then ask again',
      unprobed: false,
    });
    expect((await of({ ...dump, app: 'dev.other', front: true })).message).toBe(
      `the view probe that answered for ${APP} is in dev.other`,
    );
    expect((await of({ error: 'request' })).message).toBe(
      `the view probe in ${APP} refused: request`,
    );
    expect((await refusal(Promise.resolve().then(() => treeOf('{"views":', APP)))).message).toBe(
      `the view probe in ${APP} answered what is not JSON`,
    );
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
  let probe: Server | undefined;
  /** A probe in the app, answering each dump as told. */
  const listen = async (answer: string) => {
    const path = viewSocket(SIM, APP);
    mkdirSync(dirname(path), { recursive: true });
    const server = createServer((c) => {
      c.once('data', (d) => c.end(String(d).startsWith('dump') ? answer : '{"error":"request"}'));
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    probe = server;
  };
  afterEach(async () => {
    await new Promise((resolve) => probe?.close(resolve) ?? resolve(undefined));
    probe = undefined;
  });

  it('asks the probe in the app, and gives what it answered', async () => {
    await listen(recorded('web'));
    const tree = await new SimulatorViews(simulator().simctl, SIM).read(APP);
    expect(tree.views).toHaveLength(48);
    expect(tree.views.some((v) => v.class === 'WKWebView')).toBe(true);
  });

  it('refuses an app no probe answers in, with what its bundle says of the whole app', async () => {
    const views = new SimulatorViews(simulator().simctl, SIM);
    // what puts the probe in is the operations' to say
    expect(await refusal(views.read(APP))).toEqual({
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
    expect((await refusal(views.read(APP))).unprobed).toBe(true);
  });

  it('names Flutter or React Native by what the bundle holds, read once per installed app', async () => {
    mkdirSync(join(bundle, 'Frameworks/Flutter.framework'), { recursive: true });
    const views = new SimulatorViews(simulator().simctl, SIM);
    expect((await refusal(views.read(APP))).message).toMatch(
      /without the view probe; app-level, by its bundle: Flutter\. Which framework/,
    );
    rmSync(join(bundle, 'Frameworks'), { recursive: true });
    expect((await refusal(views.read(APP))).message).toContain('by its bundle: Flutter.');
  });

  it('refuses the home screen, with no app named', async () => {
    const views = new SimulatorViews(simulator().simctl, SIM);
    for (const app of [undefined, 'com.apple.springboard'])
      expect((await refusal(views.read(app))).code).toBe('APP_NOT_RUNNING');
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
