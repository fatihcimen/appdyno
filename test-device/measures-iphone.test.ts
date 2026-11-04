import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appleProvider,
  buildScreen,
  Devicectl,
  sleep as pause,
  type IosPhoneDevice,
  type Screen,
} from 'appdyno';
import { DeviceError } from '@appdyno/protocol';
import { loadRefusals } from '@appdyno/perf';
import { opsOn } from './helpers.js';

/**
 * What a phone gives on an app signed for development, against a known cost (APPDYNO_IPHONE_UDID,
 * APPDYNO_IPHONE_FIXTURE_APP): a slow start named in its phase, retain cycles, a download, a busy core, a frozen frame.
 */
const udid = process.env.APPDYNO_IPHONE_UDID;
const fixture = process.env.APPDYNO_IPHONE_FIXTURE_APP;
const APP = 'dev.appdyno.fixture';
const SETTINGS = 'com.apple.Preferences';
const within = (read: number, known: number, share: number) => {
  expect(read).toBeGreaterThan(known * (1 - share));
  expect(read).toBeLessThan(known * (1 + share));
};

describe.skipIf(!udid || !fixture)('measures on an iPhone, on the signed fixture', () => {
  const t = opsOn(appleProvider(), udid!, APP);
  let d: IosPhoneDevice;
  const ctl = new Devicectl(udid!);
  const open = async (screen: string, env?: Record<string, string>): Promise<Screen> => {
    await d.terminate(APP);
    if (env) await ctl.launch(APP, undefined, env);
    else await d.launch(APP);
    await d.openUrl(`appdyno-fixture://open/${screen}`, APP);
    await pause(1_000);
    return buildScreen(await d.tree(), { platform: 'ios', appId: APP });
  };
  const byId = (s: Screen, id: string) => {
    const e = s.list.find((x) => x.id === id);
    if (!e) throw new Error(`no ${id}`);
    return e;
  };

  beforeAll(async () => {
    await ctl.install(fixture!);
    d = (await t.ctx.session()).device as IosPhoneDevice;
    await d.tree();
  }, 240_000);
  afterAll(async () => {
    await d?.terminate(APP).catch(() => undefined);
    await d?.stopAgent();
    t.ctx.close();
  });

  it('frames: perf_scroll with no argument records around its swipes', async () => {
    await open('list');
    const r = await t.call('perf_scroll', { repeats: 1 });
    console.log(r.text);
    expect(r.error).toBe(false);
    const round = r.data.rounds[0]!;
    expect(round.frames).toBeGreaterThan(30);
    expect(r.data.frozen).toBe(0);
  }, 240_000);

  it('frozen: a 1 s stall during a scroll reads as one', async () => {
    await open('list_stall');
    const r = await t.call('perf_scroll', { repeats: 1 });
    console.log(r.text);
    expect(r.error).toBe(false);
    expect(r.data.frozen).toBe(1);
  }, 240_000);

  it('frozen: perf_trace says it too, with how long the main thread stalled', async () => {
    await open('list_stall');
    const r = await t.call('perf_trace', { scroll: 'up', seconds: 8 });
    console.log(r.text);
    expect(r.data.frozen).toBe(1);
    within(
      Number(/main thread stalled \d+ times, worst ([\d.]+) ms/.exec(r.text)?.[1]),
      1_000,
      0.25,
    );
  }, 240_000);

  it('hangs: a sleep reads blocked and a loop busy, in its function given the build’s dSYM', async () => {
    const dsym = process.env.APPDYNO_IPHONE_FIXTURE_DSYM;
    const hang = async (id: string) => {
      const s = await open('stall');
      const h = await d.hangs(
        APP,
        5,
        async () => {
          await pause(1_000);
          await d.tap(byId(s, id), { settle: false });
        },
        dsym ? { dsym } : undefined,
      );
      console.log(id, JSON.stringify(h.causes));
      return h.causes[0]!;
    };
    const blocked = await hang('stall_500');
    expect(blocked.kind).toBe('blocked');
    within(blocked.ms, 500, 0.15);
    const busy = await hang('stall_busy');
    expect(busy.kind).toBe('busy');
    expect(busy.cpuPercent).toBeGreaterThan(80);
    within(busy.ms, 500, 0.15);
    if (dsym) expect(busy.function).toContain('busyMainThread');
  }, 240_000);

  it('why slow: a 500 ms slow start is named in `main`, within 15 %', async () => {
    const phases = async (env?: Record<string, string>) => {
      const { startup } = (
        await d.measure.launch!(APP, { mode: 'cold', repeats: 1, trace: true, ...(env && { env }) })
      ).value;
      console.log(JSON.stringify(startup));
      return startup!.breakdown;
    };
    const ms = (b: Awaited<ReturnType<typeof phases>>, name: string) =>
      b.find((p) => p.reason === name)!.ms;
    const base = await phases();
    const slow = await phases({ APPDYNO_FIXTURE_STARTUP_MS: '500' });
    within(ms(slow, 'main') - ms(base, 'main'), 500, 0.15);
    expect(slow.toSorted((a, b) => b.ms - a.ms)[0]!.reason).toBe('main');
  }, 300_000);

  it('why slow: a system app refuses, says why, and the refusal is kept', async () => {
    const r = await t.call('perf_launch', { app: SETTINGS, repeats: 1, trace: true });
    console.log(r.text);
    expect(r.error).toBe(true);
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toMatch(/get-task-allow/);
    const kept = await loadRefusals(t.measurements);
    expect(kept.find((k) => k.measure === 'launch-why')?.reason).toMatch(/get-task-allow/);
  }, 180_000);

  it('leaks: 10 retain cycles of two objects read as 20 objects, a screen with none as 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-leaks-'));
    const s = await open('leak');
    const none = (await d.measure.heap!(APP, dir)).value;
    console.log('leaks at rest', JSON.stringify(none));
    expect(none.leaks).toBe(0);
    await d.inFront(APP);
    for (let i = 0; i < 10; i++) await d.tap(byId(s, 'leak_make'), { settle: false });
    const ten = (await d.measure.heap!(APP, dir)).value;
    console.log('leaks of 10 cycles', JSON.stringify(ten));
    expect(ten.leaks).toBe(20);
    expect(ten.note).toMatch(/two objects counts as two/);
  }, 240_000);

  it('leaks: a system app refuses and says what would work', async () => {
    await d.launch(SETTINGS);
    const e = await d.measure.heap!(SETTINGS, tmpdir()).catch((x: DeviceError) => x);
    console.log(e instanceof Error ? `${e.message} / ${(e as DeviceError).hint}` : e);
    expect(e).toBeInstanceOf(DeviceError);
    expect((e as DeviceError).code).toBe('UNSUPPORTED');
    expect((e as DeviceError).message).toMatch(/task port/);
    expect((e as DeviceError).hint).toMatch(/signed for development/);
  }, 180_000);

  it('network: 5 MB fetched reads within 15 %, or the phone could not reach this Mac', async (ctx) => {
    const bytes = 5_000_000;
    const server = createServer((_, res) => {
      res.writeHead(200, { 'Content-Length': bytes, Connection: 'close' });
      res.end(Buffer.alloc(bytes, 7));
    });
    await new Promise<void>((r) => server.listen(0, '0.0.0.0', r));
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((a) => a?.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254'));
    try {
      const port = (server.address() as AddressInfo).port;
      const s = await open('network', {
        APPDYNO_FIXTURE_FETCH_URL: `http://${lan!.address}:${port}/`,
        APPDYNO_FIXTURE_NO_PROXY: '1',
      });
      const n = (
        await d.measure.network!(APP, 3_000, async () => {
          await d.inFront(APP);
          await d.tap(byId(s, 'fetch'), { settle: false });
        })
      ).value;
      const shown = buildScreen(await d.tree(), { platform: 'ios', appId: APP });
      const said = shown.list.find((e) => /^(fetched|failed)/.test(e.label))?.label ?? '';
      console.log('network', JSON.stringify(n), said);
      if (!said.startsWith('fetched')) return ctx.skip();
      within(n.rxBytes, bytes, 0.15);
      expect(n.txBytes).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  }, 180_000);

  it('network: a system app is read too, attached with no debugger', async () => {
    await d.launch(SETTINGS);
    const n = (await d.measure.network!(SETTINGS, 1_000)).value;
    console.log('network of Settings', JSON.stringify(n));
    expect(n.rxBytes).toBeGreaterThanOrEqual(0);
    expect(n.windowMs).toBeGreaterThan(0);
  }, 120_000);

  it('energy: a busy core reads clearly above an idle app, and is a reading', async () => {
    const s = await open('cpu');
    const idle = await t.call('perf_snapshot', { also: ['energy'], cpuWindowMs: 8_000 });
    let on = true;
    await d.inFront(APP);
    const loop = (async () => {
      while (on) {
        await d.tap(byId(s, 'cpu_load'), { settle: false }).catch(() => undefined);
        await pause(3_000);
      }
    })();
    const busy = await t.call('perf_snapshot', { also: ['energy'], cpuWindowMs: 8_000 });
    on = false;
    await loop;
    console.log('energy', idle.text, '\n', busy.text);
    expect(busy.data.energyModelled).toBe(false);
    expect(busy.text).toMatch(/power impact/);
    expect(busy.data.energyImpact!).toBeGreaterThan(idle.data.energyImpact! * 2);
  }, 300_000);
});
