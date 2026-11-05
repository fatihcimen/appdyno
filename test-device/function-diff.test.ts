import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Adb, androidProvider, sleep as pause, type AndroidDevice } from './workspace.js';
import { opsOn } from './helpers.js';

/**
 * Which function moved between two runs, against a known cost (APPDYNO_ANDROID_SERIAL): two runs of the same work name
 * nothing, and 300 ms a second put into one function tops the diff.
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const APP = 'dev.appdyno.fixture';
const KNOWN_MS = 300;

describe.skipIf(!serial)('a function-level diff of two runs', () => {
  const t = opsOn(androidProvider(new Adb(), {}), serial!, APP);
  let d: AndroidDevice;
  const costs = (ms?: number) =>
    d.shell(
      ms === undefined
        ? `run-as ${APP} rm -f files/known_ms`
        : `run-as ${APP} sh -c 'mkdir -p files; echo ${ms} > files/known_ms'`,
    );

  /** A profile of the fixture's second of steady work, inside its 8 s. */
  const profiled = async () => {
    await d.ensureAwake();
    const s = await d.read(APP);
    await d.tap(
      s.list.find((e) => e.id === 'cpu_steady')!,
      { settle: false },
    );
    await pause(500);
    const r = await t.call('perf_profile', { seconds: 5 });
    expect(r.error, r.text).toBe(false);
    console.log(r.text.split('\n').slice(0, 7).join('\n'));
    // what is left of its 8 s
    await pause(4_000);
    return r.data.id;
  };

  beforeAll(async () => {
    d = (await t.ctx.session()).device as AndroidDevice;
    await d.open();
    await d.shell(`am force-stop ${APP}`);
    await d.shell(
      `am start -W -a android.intent.action.VIEW -d 'appdyno-fixture://open/cpu' ${APP}`,
    );
    await pause(1_500);
    await costs();
  });
  afterAll(async () => {
    await costs().catch(() => undefined);
    t.ctx.close();
  });

  it('two runs of the same work name nothing, and a known 300 ms a second tops the diff', async () => {
    // the first run warms the compiled code up: its names are the interpreter's
    await profiled();
    const a = await profiled();
    const b = await profiled();
    const same = await t.call('perf_compare', { action: 'functions', from: a, to: b });
    console.log(same.text);
    expect(same.error, same.text).toBe(false);
    expect(same.data.functions!.filter((f) => f.symbol.includes('fixture'))).toEqual([]);

    await costs(KNOWN_MS);
    const c = await profiled();
    const moved = await t.call('perf_compare', { action: 'functions', from: b, to: c });
    console.log(moved.text);
    const top = moved.data.functions![0]!;
    expect(top.symbol).toContain('knownCost');
    expect(Math.abs(top.changeMs - KNOWN_MS)).toBeLessThan(KNOWN_MS * 0.2);
  }, 300_000);

  it('refuses what is no profile, by name', async () => {
    const r = await t.call('perf_compare', {
      action: 'functions',
      from: 'pm-00000000',
      to: '../x',
    });
    expect(r.error).toBe(true);
    expect(r.text).toContain('no profile kept here');
  }, 30_000);
});
