import { execFile } from 'node:child_process';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { connect, type Refusal } from 'appdyno';
import {
  Adb,
  AndroidDevice,
  IosRunnerLauncher,
  inCall,
  safeName,
  seededRandom,
  sleep,
  stateDir,
} from './workspace.js';
import { childrenNamed, endLeftBehind, HUB } from '../packages/driver-apple/src/left-behind.js';
import { refIn } from './helpers.js';
import { takeAgentsLost } from './one-agent.js';
import {
  markdown,
  memoryNow,
  noRecoveries,
  summarize,
  type CallRecord,
  type SoakRun,
  type SoakSummary,
} from './soak-report.js';

/**
 * A long session on one device through the library, as a program drives it: the fixture's screens in a seeded random
 * order each cycle, with a rotation, a web view, a crash and the agent ended under the session among them. Only when
 * APPDYNO_SOAK_DEVICE names a simulator, an emulator or an Android phone with the fixture installed: it runs for
 * APPDYNO_SOAK_MINUTES (30), and a sweep of a device's suites never takes it. soak.json and soak.md go to
 * APPDYNO_SOAK_OUT, else a temporary folder; under APPDYNO_SOAK_MIN_RATE (99) % of calls, or a fault put in that was
 * not reported as it should be, fails the run.
 */
const DEVICE = process.env.APPDYNO_SOAK_DEVICE ?? '';
const MINUTES = Number(process.env.APPDYNO_SOAK_MINUTES ?? 30);
const APP = 'dev.appdyno.fixture';
const SIMULATOR = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const PHONE = /^[0-9A-F]{8}-[0-9A-F]{16}$|^[0-9a-f]{40}$/i;
/** What only this simulator's runner has on its command line, and only the Android agent on its own. */
const RUNNER_TEST = 'only-testing:Runner/RunnerTests/testServe';
const AGENT_MAIN = 'dev.appdyno.agent.Main';
const exec = promisify(execFile);

const until = async (done: () => boolean | Promise<boolean>, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await done()) return true;
    await sleep(200);
  }
  return false;
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The pid appdyno's own state file keeps for this device's agent: the iOS runner's xcodebuild, or the Android agent. */
function agentPid(file: string) {
  try {
    return (JSON.parse(readFileSync(join(stateDir(), file), 'utf8')) as { pid?: number }).pid;
  } catch {
    return undefined;
  }
}

/** The runner ended as a crash of it would end it: its xcodebuild killed, the runner app with it. Why not, if not. */
async function endRunner(): Promise<string | undefined> {
  const pid = agentPid(`ios-${DEVICE}.json`);
  if (!pid) return 'no runner in the state file';
  const { stdout } = await exec('ps', ['-o', 'command=', '-p', String(pid)]).catch(() => ({
    stdout: '',
  }));
  // a pid another process has taken since, or another simulator's runner, is left alone
  if (!stdout.includes(RUNNER_TEST) || !stdout.includes(DEVICE))
    return `pid ${pid} is not this simulator's runner`;
  const left = await childrenNamed(pid, HUB);
  process.kill(pid, 'SIGKILL');
  if (!(await until(() => !alive(pid)))) return `xcodebuild ${pid} outlived its kill`;
  // what it started and launchd keeps, as the launcher's own stop ends it
  await endLeftBehind(left, HUB);
  const running = () =>
    exec('pgrep', ['-f', `${DEVICE}/.*/Runner-Runner`]).then(
      () => true,
      () => false,
    );
  return (await until(async () => !(await running())))
    ? undefined
    : 'the runner app outlived xcodebuild';
}

/** The Android agent killed on the device, its socket and the session's connection going with it. */
async function endAndroidAgent(): Promise<string | undefined> {
  const pid = agentPid(`android-${safeName(DEVICE)}.json`);
  if (!pid) return 'no agent in the state file';
  const adb = new Adb();
  const ours = `grep -q ${AGENT_MAIN} /proc/${pid}/cmdline 2>/dev/null`;
  const ended = await adb.exec(DEVICE, `(${ours} && kill -9 ${pid} && echo ended); true`);
  if (!ended.includes('ended')) return `pid ${pid} is not this device's agent`;
  const up = () => adb.exec(DEVICE, `(${ours} && echo up); true`).then((o) => o.includes('up'));
  return (await until(async () => !(await up()))) ? undefined : 'the agent outlived its kill';
}

type Outcome = {
  ok: boolean;
  code?: string;
  text: string;
  data: Record<string, unknown>;
  ms: number;
  /** As the soak judged it: a refusal, a check that failed, or a fault put in that was not reported as it should be. */
  passed: boolean;
};
type Check = (o: Omit<Outcome, 'passed'>) => string | undefined;

it.skipIf(!DEVICE)(
  'holds a long session together: crashes, a lost agent, turns and web views among the calls',
  async () => {
    if (PHONE.test(DEVICE)) throw new Error('the soak drives a simulator or an Android device');
    const platform = SIMULATOR.test(DEVICE) ? 'ios' : 'android';
    const seed = Number(process.env.APPDYNO_SOAK_SEED ?? Math.floor(Math.random() * 2 ** 31));
    // a length or a seed that is no number would run nothing, or replay nothing, and read as a pass
    if (!(MINUTES > 0) || !Number.isInteger(seed))
      throw new Error(
        'APPDYNO_SOAK_MINUTES is a number of minutes, APPDYNO_SOAK_SEED a whole number',
      );
    const out = process.env.APPDYNO_SOAK_OUT ?? mkdtempSync(join(tmpdir(), 'appdyno-soak-'));
    const say = (line: string) => process.stderr.write(`soak: ${line}\n`);
    say(`seed ${seed}, ${MINUTES} min on ${DEVICE}, the report in ${out}`);
    const started = Date.now();
    const run: SoakRun = {
      device: DEVICE,
      platform,
      seed,
      minutes: MINUTES,
      threshold: Number(process.env.APPDYNO_SOAK_MIN_RATE ?? 99),
      startedAt: new Date(started).toISOString(),
      endedAt: '',
      memory: { start: memoryNow(), end: memoryNow(), maxRssMb: memoryNow().rssMb },
      calls: [],
      cycles: [],
      recoveries: noRecoveries(),
    };
    const r = run.recoveries;
    const lost = () => {
      r.tookItsPlace++;
    };
    subscribe('appdyno.agent.lost', lost);
    const progress = (line: string) => {
      if (/^starting the (iOS runner|Android agent)$/.test(line)) r.agentStarts++;
    };
    const d = connect({ device: DEVICE, app: APP, allowDevices: new RegExp(`^${DEVICE}$`) });
    let cycle = 0;
    let scenario = 'warm-up';
    const record = (c: Omit<CallRecord, 'cycle' | 'scenario' | 'atMs'>) =>
      run.calls.push({ cycle, scenario, atMs: Date.now() - started, ...c });

    const call = async (
      tool: string,
      args: Record<string, unknown> = {},
      o: { injected?: boolean; check?: Check; after?: string } = {},
    ): Promise<Outcome> => {
      const t = performance.now();
      let got: Omit<Outcome, 'ms' | 'passed'>;
      try {
        const a = await inCall({ progress }, () => d.tool(tool, args));
        got = { ok: true, text: a.text, data: a.data };
      } catch (e) {
        const { code, message, hint } = e as Partial<Refusal> & Error;
        if (hint?.includes('the agent was stuck and has been restarted')) r.stuckRestarts++;
        got = {
          ok: false,
          code: code ?? 'THROWN',
          text: hint ? `${message} (${hint})` : message,
          data: {},
        };
      }
      const outcome = { ...got, ms: Math.round(performance.now() - t) };
      const wrong = outcome.ok || o.injected ? o.check?.(outcome) : outcome.text;
      const code = outcome.code ?? (wrong ? 'UNEXPECTED' : undefined);
      record({
        tool,
        injected: !!o.injected,
        ok: !wrong,
        ms: outcome.ms,
        ...(code && { code }),
        ...((wrong ?? o.after) && { note: (wrong ?? o.after ?? '').slice(0, 300) }),
      });
      return { ...outcome, passed: !wrong };
    };
    const link = (screen: string) => call('open_link', { url: `appdyno-fixture://open/${screen}` });

    const scenarios: Record<string, () => Promise<unknown>> = {
      read: async () => {
        await call('screen');
        await call(
          'screen',
          { raw: true },
          {
            check: (o) =>
              (o.data.nodes as unknown[] | undefined)?.length ? undefined : 'no nodes',
          },
        );
      },
      form: async () => {
        await link('form');
        const text = `Soak ${cycle}`;
        await call('type_text', { selector: { id: 'name_input' }, text, replace: true });
        await call('assert', { selector: { id: 'name_input' }, check: 'text', equals: text });
        const send = await call('find', { selector: { id: 'submit' } });
        const ref = (send.data.matches as { ref: string }[] | undefined)?.[0]?.ref;
        await call('tap', ref ? { ref } : { selector: { id: 'submit' } });
        await call('assert', {
          selector: { id: 'result' },
          check: 'text',
          equals: `Sent: ${text}`,
        });
      },
      list: async () => {
        await link('list');
        await call('tap', { selector: { text: 'Add', index: 0 } });
        const found = await call(
          'scroll_to',
          { selector: { text: 'Product 40' }, maxSwipes: 15 },
          { check: (o) => (o.data.found === true ? undefined : 'not found') },
        );
        const ref = /found (@[\w-]+)/.exec(found.text)?.[1];
        if (ref) await call('tap', { ref });
      },
      dialog: async () => {
        await link('dialog');
        const open = await call('tap', { selector: { id: 'open_dialog' } });
        const ok = refIn(open.text, 'OK');
        await call('tap', ok ? { ref: ok } : { selector: { text: 'OK' } });
        await call('assert', { selector: { id: 'result' }, check: 'text', equals: 'Confirmed' });
      },
      rotate: async () => {
        await link('list');
        try {
          await call('set_orientation', { orientation: 'landscape_left' });
          await call('screen');
        } finally {
          await call('set_orientation', { orientation: 'portrait' });
        }
      },
      web: async () => {
        await link('web');
        await call('wait_for', { selector: { text: 'Web content' }, timeoutMs: 10_000 });
        await call('screen');
        await call(
          'inspect_app',
          { action: 'web_eval', js: 'document.title' },
          {
            check: (o) => (o.text.includes('Fixture web') ? undefined : `the title read ${o.text}`),
          },
        );
      },
      crash: async () => {
        await link('crash');
        r.crashesInjected++;
        const tap = await call(
          'tap',
          { selector: { id: 'crash' } },
          {
            injected: true,
            check: (o) =>
              o.ok || o.code === 'APP_NOT_RUNNING' ? undefined : `refused with ${o.code ?? ''}`,
          },
        );
        // Android starts a crashed app again with its task, unless it crashed a short while before: there the app may
        // be back in front, and only the tap can have said so
        const restarted = platform === 'android' && tap.code === 'APP_NOT_RUNNING';
        // the tap said so, or the next read must: the app is not the one in front
        await call(
          'screen',
          {},
          {
            injected: true,
            check: (o) =>
              o.data.foreground !== APP || restarted ? undefined : 'the app read in front',
          },
        );
        const back = await call(
          'launch_app',
          {},
          {
            after: 'the crash',
            check: (o) =>
              String(o.data.done).startsWith('started') || (restarted && o.data.foreground === APP)
                ? undefined
                : String(o.data.done),
          },
        );
        if (back.passed) r.crashRelaunches++;
      },
      reconnect: async () => {
        await link('form');
        const t = performance.now();
        const before = r.tookItsPlace;
        const refused = platform === 'ios' ? await endRunner() : await endAndroidAgent();
        const ms = Math.round(performance.now() - t);
        if (!refused) r.agentEndsInjected++;
        // a simulator's helper reads and taps with no runner: a field's text brings one up
        await call('tap', { selector: { id: 'name_input' } }, { after: 'the agent was ended' });
        await call('type_text', {
          selector: { id: 'name_input' },
          text: `Again ${cycle}`,
          replace: true,
        });
        const back = r.tookItsPlace > before;
        if (!refused && back) r.agentEndsRecovered++;
        const wrong = refused ?? (back ? undefined : 'no other agent took its place');
        record({
          tool: 'end_agent',
          injected: true,
          ok: !wrong,
          ms,
          ...(wrong && { code: 'UNEXPECTED', note: wrong }),
        });
      },
      ...(platform === 'ios' && {
        copies: async () => {
          await link('copies_banner');
          await call('screen');
          await call(
            'tap',
            { selector: { id: 'dup_close' } },
            { check: (o) => (o.text.includes('"x-mark"') ? undefined : 'not the x-mark') },
          );
        },
      }),
    };

    /** After a scenario that failed: the app brought back if it is gone, so the next one starts where it should. */
    const recover = async () => {
      const s = await call('screen');
      if (s.data.foreground === APP) return;
      if ((await call('launch_app')).passed) r.unplannedRelaunches++;
    };

    // in a fixed order before the shuffle, so that a seed replays
    const names = Object.keys(scenarios).sort();
    const random = seededRandom(seed);
    const shuffled = () =>
      names
        .map((n) => ({ n, k: random() }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.n);

    let summary: SoakSummary | undefined;
    const md = join(out, 'soak.md');
    try {
      await call('launch_app', { restart: true });
      await link('form');
      await call('type_text', { selector: { id: 'name_input' }, text: 'Warm', replace: true });
      for (const end = started + MINUTES * 60_000; Date.now() < end;) {
        cycle++;
        const order = shuffled();
        const from = { at: Date.now(), calls: run.calls.length };
        for (const name of order) {
          scenario = name;
          const first = run.calls.length;
          await scenarios[name]?.();
          if (run.calls.slice(first).some((c) => !c.ok && !c.injected)) {
            scenario = `${name}: recover`;
            await recover();
          }
        }
        const calls = run.calls.slice(from.calls);
        const failed = calls.filter((c) => !c.ok).length;
        const { rssMb } = memoryNow();
        run.memory.maxRssMb = Math.max(run.memory.maxRssMb, rssMb);
        run.cycles.push({ n: cycle, ms: Date.now() - from.at, order, failed, rssMb });
        say(
          `cycle ${cycle}: ${Math.round((Date.now() - from.at) / 1000)} s, ${calls.length} calls, ${failed} failed, ${order.join(' ')}`,
        );
      }
    } finally {
      scenario = 'end';
      await d
        .tool('set_orientation', { orientation: 'portrait', read: 'none' })
        .catch(() => undefined);
      await d.close();
      unsubscribe('appdyno.agent.lost', lost);
      // each was counted above, as a recovery: the suite's own watch would fail the run on it
      takeAgentsLost();
      // the agent this run started does not stay on the device after it
      await (
        platform === 'ios'
          ? new IosRunnerLauncher(DEVICE).stop()
          : new AndroidDevice(DEVICE, new Adb()).stopAgent()
      ).catch(() => undefined);
      run.endedAt = new Date().toISOString();
      run.memory.end = memoryNow();
      summary = summarize(run);
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'soak.json'), `${JSON.stringify({ ...run, summary }, null, 2)}\n`);
      writeFileSync(md, markdown(run, summary));
      say(`${summary.passed ? 'passed' : 'failed'}: ${summary.ratePct} %, ${md}`);
    }
    expect(summary.calls, `calls made: ${md}`).toBeGreaterThan(0);
    expect(
      summary.mismatches.map((c) => `${c.cycle} ${c.scenario} ${c.tool}: ${c.note ?? ''}`),
      `faults put in that were not reported as they should be: ${md}`,
    ).toEqual([]);
    expect(summary.ratePct, `calls that succeeded, in %: ${md}`).toBeGreaterThanOrEqual(
      run.threshold,
    );
  },
  ((MINUTES || 0) + 20) * 60_000,
);
