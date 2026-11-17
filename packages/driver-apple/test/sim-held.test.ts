import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cannot } from '@appdyno/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdAppLanguage } from '../src/manage.js';
import { SimulatorNetwork, probeEntries, probeUnseen } from '../src/network.js';
import { IosSimulatorPerf } from '../src/perf.js';
import { ProbedFrames } from '../src/sim-frames.js';
import { HeldLaunches, heldLaunch, joinEnv } from '../src/sim-held.js';
import { SimulatorSettings } from '../src/sim-settings.js';
import { Simctl } from '../src/simctl.js';
import { SimulatorApps } from '../src/simulator-manage.js';
import { simulatorOps } from '../src/simulator-ops.js';
import { recordXctMetrics } from '../src/xct-metrics.js';

const SIM = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const APP = 'dev.appdyno.fixture';
const OTHER = 'dev.appdyno.other';
const CHILD = 'SIMCTL_CHILD_';

let helpers = '';
/** The probes' libraries, as `helperBinary` finds them built. */
const lib = (name: 'NetProbe' | 'SimProbe') => join(helpers, name);

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-held-')));
  helpers = mkdtempSync(join(tmpdir(), 'appdyno-held-helpers-'));
  for (const name of ['NetProbe', 'SimProbe'] as const) writeFileSync(lib(name), '');
  vi.stubEnv('APPDYNO_HELPERS', helpers);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A simulator whose app starts as 4242, each launch kept with what went into the app's environment. */
const simulator = () => {
  const launches: { args: string[]; env: Record<string, string> }[] = [];
  const simctl = Object.assign(new Simctl({}), {
    exec: (args: string[], _ms?: number, env: Record<string, string | undefined> = {}) => {
      if (args[0] !== 'launch') return Promise.resolve('');
      const own = Object.entries(env).flatMap(([k, v]): [string, string][] =>
        k.startsWith(CHILD) && v !== undefined ? [[k.slice(CHILD.length), v]] : [],
      );
      launches.push({ args, env: Object.fromEntries(own) });
      // the frame probe's first lines, as it writes them in the process it went into
      const out = env[`${CHILD}APPDYNO_PROBE_OUT`];
      if (out) writeFileSync(out, `{"loaded":"${APP}","pid":4242,"t":1}\n{"launchMs":120}\n`);
      return Promise.resolve(`${APP}: 4242`);
    },
    terminate: () => Promise.resolve(),
    pid: () => Promise.resolve(4242),
  });
  return { simctl, launches };
};

describe('what each launch of an app on a simulator carries', () => {
  it('joins the libraries each environment inserts, each once and in order, and takes the last of any other name', () => {
    expect(
      joinEnv(
        { DYLD_INSERT_LIBRARIES: '/a', A: '1' },
        { DYLD_INSERT_LIBRARIES: '/b:/a', A: '2' },
        { B: '3' },
      ),
    ).toEqual({ A: '2', B: '3', DYLD_INSERT_LIBRARIES: '/a:/b' });
    expect(joinEnv({ A: '1' }, {})).toEqual({ A: '1' });
    expect(joinEnv({ DYLD_INSERT_LIBRARIES: '' })).toEqual({});
  });

  it('holds probes by app and lets them go by name, the newest holder answering for all', () => {
    const holds = new HeldLaunches(SIM);
    expect(holds.holder()).toBeUndefined();
    holds.hold(APP, 'frames', { lib: lib('SimProbe'), env: { APPDYNO_PROBE_OUT: '/f' } });
    const owner = { pid: 1, started: 'then', tool: 'appdyno', since: 'now' };
    holds.owner = owner;
    holds.hold(APP, 'network', { lib: lib('NetProbe'), env: { APPDYNO_NET_DIR: '/n' } });
    holds.hold(OTHER, 'frames', { lib: lib('SimProbe'), env: { APPDYNO_PROBE_OUT: '/o' } });
    expect(holds.holder()).toEqual({ owner });
    expect(heldLaunch(SIM, APP).env).toEqual({
      APPDYNO_PROBE_OUT: '/f',
      APPDYNO_NET_DIR: '/n',
      DYLD_INSERT_LIBRARIES: `${lib('SimProbe')}:${lib('NetProbe')}`,
    });
    holds.drop(APP, 'network');
    expect(heldLaunch(SIM, APP).env).toEqual({
      APPDYNO_PROBE_OUT: '/f',
      DYLD_INSERT_LIBRARIES: lib('SimProbe'),
    });
    expect(holds.letGo()).toEqual([`the frames probe in ${APP}`, `the frames probe in ${OTHER}`]);
    expect(heldLaunch(SIM, APP)).toEqual({ args: [], env: {} });
    expect(holds.holder()).toBeUndefined();
    // the last probe dropped leaves nothing held, and no one to answer for it
    holds.hold(APP, 'frames', { lib: lib('SimProbe'), env: {} });
    holds.drop(APP, 'frames');
    expect(holds.holder()).toBeUndefined();
  });

  it("keeps a running capture's network probe, with no holder to answer for it, where the rest is let go", () => {
    const holds = new HeldLaunches(SIM);
    const owner = { pid: 1, started: 'then', tool: 'appdyno', since: 'now' };
    holds.owner = owner;
    holds.hold(APP, 'network', { lib: lib('NetProbe'), env: { APPDYNO_NET_DIR: '/n' } });
    holds.hold(APP, 'frames', { lib: lib('SimProbe'), env: {} });
    holds.hold(OTHER, 'network', { lib: lib('NetProbe'), env: {} });
    expect(holds.letGo(APP)).toEqual([
      `the frames probe in ${APP}`,
      `the network probe in ${OTHER}`,
    ]);
    expect(heldLaunch(SIM, APP).env).toEqual({
      APPDYNO_NET_DIR: '/n',
      DYLD_INSERT_LIBRARIES: lib('NetProbe'),
    });
    expect(holds.holder()).toEqual({ owner: undefined });
    // a capture named whose probe is not held keeps nothing
    expect(holds.letGo(OTHER)).toEqual([`the network probe in ${APP}`]);
    expect(holds.holder()).toBeUndefined();
  });

  it('keeps the holder that answers for them where a command line, which answers for none, holds one more', () => {
    const session = new HeldLaunches(SIM);
    const owner = { pid: 1, started: 'then', tool: 'appdyno mcp', since: 'now' };
    session.owner = owner;
    session.hold(APP, 'view', { lib: lib('SimProbe'), env: {} });
    // a command line's own, with no owner: it took the session's owner away, and that session's end let none go
    new HeldLaunches(SIM).hold(OTHER, 'view', { lib: lib('SimProbe'), env: {} });
    expect(session.holder()).toEqual({ owner });
    expect(session.letGo()).toEqual([`the view probe in ${APP}`, `the view probe in ${OTHER}`]);
  });

  it("puts the app's language and the launch's own over what is held, and leaves out a library gone from this Mac", async () => {
    await holdAppLanguage(SIM, APP, 'tr-TR', () => Promise.resolve());
    const holds = new HeldLaunches(SIM);
    holds.hold(APP, 'frames', {
      lib: lib('SimProbe'),
      env: { APPDYNO_PROBE_OUT: '/f', A: 'held' },
    });
    holds.hold(APP, 'gone', { lib: '/nowhere/Gone', env: { GONE: '1' } });
    const own = { args: ['-x'], env: { A: 'own', DYLD_INSERT_LIBRARIES: '/own.dylib' } };
    expect(heldLaunch(SIM, APP, own)).toEqual({
      args: ['-AppleLanguages', '(tr-TR)', '-AppleLocale', 'tr_TR', '-x'],
      env: {
        APPDYNO_PROBE_OUT: '/f',
        A: 'own',
        DYLD_INSERT_LIBRARIES: `${lib('SimProbe')}:/own.dylib`,
      },
    });
    expect(heldLaunch(SIM, APP, { language: 'de' }).args).toEqual([
      '-AppleLanguages',
      '(de)',
      '-AppleLocale',
      'de',
    ]);
  });

  it('goes into every launch this tool makes of the app, and a relaunch for one probe keeps the other', async () => {
    const { simctl, launches } = simulator();
    const holds = new HeldLaunches(SIM);
    const network = new SimulatorNetwork(simctl, SIM, holds);
    const capture = await network.start('probe', APP);
    await new ProbedFrames(SIM, simctl, () => Promise.resolve(4242), holds).launch(APP);
    await simctl.launch(SIM, APP);
    // a start profiled from its first instruction
    await simctl.launch(SIM, APP, {}, true);
    // launch_app, and launch_app with what starts it afresh
    await simulatorOps(SIM, simctl).launch(APP);
    await new SimulatorApps(simctl, SIM).launchWith(APP, { args: ['-x'] });
    // held in a language, a running app starts again in it
    await new SimulatorSettings(simctl, SIM).set('locale', 'tr-TR', APP);
    const perf = new IosSimulatorPerf(
      SIM,
      simctl,
      () => Promise.resolve(true),
      cannot("XCTest's metrics"),
      holds,
    );
    await perf.launch(APP, { repeats: 1 });
    const [first, ...after] = launches;
    expect(first).toEqual({
      args: ['launch', '--terminate-running-process', SIM, APP],
      env: { APPDYNO_NET_DIR: capture.dir, DYLD_INSERT_LIBRARIES: lib('NetProbe') },
    });
    expect(after).toHaveLength(8);
    for (const l of after) {
      expect(l.env.DYLD_INSERT_LIBRARIES).toBe(`${lib('NetProbe')}:${lib('SimProbe')}`);
      expect(l.env.APPDYNO_NET_DIR).toBe(capture.dir);
      expect(l.env.APPDYNO_PROBE_OUT).toMatch(/probes\/.+\.jsonl$/);
    }
    expect(after.map((l) => l.args.slice(1, -1).join(' '))).toEqual([
      SIM,
      SIM,
      `--wait-for-debugger ${SIM}`,
      SIM,
      `--terminate-running-process ${SIM} ${APP}`,
      `${SIM} ${APP} -AppleLanguages (tr-TR) -AppleLocale`,
      `${SIM} ${APP} -AppleLanguages (tr-TR) -AppleLocale`,
      `${SIM} ${APP} -AppleLanguages (tr-TR) -AppleLocale`,
    ]);
    // the capture's end lets its probe go: the next launch carries the frame probe alone
    await network.stop(capture);
    await simctl.launch(SIM, APP);
    expect(launches.at(-1)?.env.DYLD_INSERT_LIBRARIES).toBe(lib('SimProbe'));
  });

  it('lets go of a probe whose launch failed', async () => {
    const holds = new HeldLaunches(SIM);
    const simctl = Object.assign(new Simctl({}), {
      exec: () => Promise.reject(new Error('simctl launch: no such app')),
      terminate: () => Promise.resolve(),
    });
    const network = new SimulatorNetwork(simctl, SIM, holds);
    await expect(network.start('probe', APP)).rejects.toThrow('no such app');
    expect(holds.holder()).toBeUndefined();
    const frames = new ProbedFrames(SIM, simctl, () => Promise.resolve(4242), holds);
    await expect(frames.launch(APP)).rejects.toThrow('no such app');
    expect(holds.holder()).toBeUndefined();
  });

  it("hands the runner's launch test what the app is held with", async () => {
    await holdAppLanguage(SIM, APP, 'tr-TR', () => Promise.resolve());
    new HeldLaunches(SIM).hold(APP, 'frames', {
      lib: lib('SimProbe'),
      env: { APPDYNO_PROBE_OUT: '/f' },
    });
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-xcodebuild-'));
    const tool = join(dir, 'xcodebuild');
    const said = (name: string) => readFileSync(join(dir, name), 'utf8');
    writeFileSync(
      tool,
      `#!/bin/sh\nprintf %s "$TEST_RUNNER_APPDYNO_METRICS_ARGS" > '${dir}/args'\nprintf %s "$TEST_RUNNER_APPDYNO_METRICS_ENV" > '${dir}/env'\nexit 1\n`,
    );
    chmodSync(tool, 0o755);
    vi.stubEnv('PATH', `${dir}:${String(process.env.PATH)}`);
    await expect(
      recordXctMetrics(SIM, '/nowhere.xctestrun', APP, 'launch', heldLaunch(SIM, APP)),
    ).rejects.toThrow("XCTest's launch metric");
    expect(said('args')).toBe('-AppleLanguages\n(tr-TR)\n-AppleLocale\ntr_TR');
    expect(said('env')).toBe(`APPDYNO_PROBE_OUT=/f\nDYLD_INSERT_LIBRARIES=${lib('SimProbe')}`);
  });
});

describe('a capture by the network probe', () => {
  it('reads the requests alone, and says when the app runs as a process the probe never went into', async () => {
    let pid = 4242;
    const simctl = Object.assign(new Simctl({}), {
      exec: () => Promise.resolve(`${APP}: 4242`),
      pid: () => Promise.resolve(pid),
    });
    const network = new SimulatorNetwork(simctl, SIM, new HeldLaunches(SIM));
    const capture = await network.start('probe', APP);
    writeFileSync(String(capture.log), `{"loaded":"${APP}","pid":4242,"t":1}\n`);
    expect(await network.read(capture)).toEqual({
      entries: [],
      note: 'no request has finished in the app since the probe went in',
    });
    appendFileSync(
      String(capture.log),
      `{"at":0,"method":"GET","url":"https://a.test/","status":200,"ms":3.4,"bytes":5}\n`,
    );
    const request = {
      id: 0,
      at: '1970-01-01T00:00:00.000Z',
      method: 'GET',
      url: 'https://a.test/',
      status: 200,
      ms: 3,
      bytes: 5,
    };
    expect(await network.read(capture)).toEqual({ entries: [request] });
    // started again from its icon: the system's launch carries nothing of this tool's
    pid = 5151;
    expect((await network.read(capture)).note).toBe(
      `${APP} runs as a process the probe is not in: its requests since are not seen`,
    );
  });

  it('reads no log yet as no request, and refuses a capture whose folder is gone', async () => {
    const simctl = Object.assign(new Simctl({}), {
      exec: () => Promise.resolve(''),
      pid: () => Promise.resolve(1),
    });
    const network = new SimulatorNetwork(simctl, SIM, new HeldLaunches(SIM));
    const capture = await network.start('probe', APP);
    expect((await network.read(capture, true)).entries).toEqual([]);
    rmSync(String(capture.dir), { recursive: true });
    await expect(network.read(capture, true)).rejects.toThrow("the capture's folder is gone");
  });

  it('numbers a request as it starts, has one with no end yet in flight, and ends it with its process', () => {
    const at = (ms: number) => new Date(ms).toISOString();
    const log = [
      `{"loaded":"${APP}","pid":7,"t":1}`,
      '{"begin":1,"at":1000,"method":"GET","url":"https://a.test/events"}',
      '{"begin":2,"at":2000,"method":"POST","url":"https://a.test/pay"}',
      '{"at":2500,"method":"POST","url":"https://a.test/pay","status":201,"ms":480.2,"bytes":9,"n":2,"timings":{"wait":120,"reused":true}}',
    ].join('\n');
    // the last line half written is no request yet
    expect(
      probeEntries(`${log}\n{"begin":3,"at":3000,"method":"GET","url":"https://a.te`, 61_000),
    ).toEqual([
      {
        id: 0,
        at: at(1000),
        method: 'GET',
        url: 'https://a.test/events',
        ms: 60_000,
        inFlight: true,
      },
      {
        id: 1,
        at: at(2500),
        method: 'POST',
        url: 'https://a.test/pay',
        status: 201,
        ms: 480,
        bytes: 9,
        timings: { wait: 120, reused: true },
      },
    ]);
    const again = `${log}\n{"loaded":"${APP}","pid":8,"t":2}\n{"begin":1,"at":5000,"method":"GET","url":"https://a.test/x"}`;
    expect(probeEntries(again, 5_100).map((e) => [e.id, e.inFlight, e.error])).toEqual([
      [0, undefined, 'the app ended before it did'],
      [1, undefined, undefined],
      [2, true, undefined],
    ]);
    // what the probe cannot see is counted by its kind, and is no request
    const blind = `${log}\n{"unseen":"webview"}\n{"unseen":"websocket"}\n{"unseen":"webview"}`;
    expect(probeEntries(blind, 61_000)).toHaveLength(2);
    expect(probeUnseen(blind)).toEqual({ unseen: { webview: 2, websocket: 1 } });
    expect(probeUnseen(log)).toEqual({});
  });

  it('keeps all of a capture in one folder of its own, for this user alone, and leaves none of it', async () => {
    // the app's process as the neighbours give it: a look at this Mac's own list is no part of a capture
    const simctl = Object.assign(new Simctl({}), {
      exec: () => Promise.resolve(`${APP}: 1`),
      pid: () => Promise.resolve(1),
    });
    const network = new SimulatorNetwork(simctl, SIM, new HeldLaunches(SIM));
    const capture = await network.start('probe', APP, true);
    const dir = String(capture.dir);
    const control = () => JSON.parse(readFileSync(join(dir, 'control.json'), 'utf8')) as unknown;
    expect(control()).toEqual({ bodies: true, rules: [] });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'control.json')).mode & 0o777).toBe(0o600);
    const rule = { id: 'abc123', host: '^a\\.test$', status: 503, headers: {} };
    const throttle = { delayMs: [40, 100] as [number, number], down: 29_600, up: 14_800, loss: 0 };
    network.control(capture, { bodies: true, rules: [rule], throttle });
    expect(control()).toEqual({ bodies: true, rules: [rule], throttle });
    // a request's headers and bodies by its place among the requests, from the file the probe named
    writeFileSync(
      String(capture.log),
      `{"loaded":"${APP}","pid":7,"t":1}\n{"at":0,"url":"https://a.test/"}\n{"at":1,"url":"https://a.test/b","detail":"7-1"}\n{"at":2,"url":"https://a.test/c","detail":"../../x"}\n`,
    );
    const kept = { requestHeaders: { A: 'b' }, responseHeaders: {}, responseBody: 'ok' };
    writeFileSync(join(dir, 'bodies', '7-1.json'), JSON.stringify(kept));
    expect(await network.detail(capture, 1)).toEqual(kept);
    expect(await network.detail(capture, 0)).toBeUndefined();
    expect(await network.detail(capture, 2)).toBeUndefined();
    const end = await network.stop(capture);
    expect(end.note).toBe(
      'the probe stays in the app until it next starts, and does nothing more there',
    );
    expect(existsSync(dir)).toBe(false);
  });
});
