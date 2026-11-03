import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import {
  Adb,
  AndroidDevice,
  DeviceError,
  IosSimulatorDevice,
  androidProvider,
  appleProvider,
  Devicectl,
  holdersIn,
  inCall,
  Simctl,
} from 'appdyno';
import { DEFAULT_POLICY, opsFor, ServerContext, type ToolResult } from '@appdyno/ops';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Conflicts with a real holder, logs and crashes of the fixture, cancellation: on the devices named. */
const APP = 'dev.appdyno.fixture';
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const udid = process.env.APPDYNO_IOS_UDID;
const textOf = (r: ToolResult) => r.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Call = (name: string, args?: Record<string, unknown>) => Promise<ToolResult>;
/** An operation as its tool calls it: through its input schema. */
const caller = (ctx: ServerContext): Call => {
  const ops = opsFor(ctx);
  return async (name, args = {}) => ops[name]!.handler(ops[name]!.input.parse(args));
};

describe.skipIf(!serial)('android: another tool holds UI automation', () => {
  const adb = new Adb();
  const shell = (cmd: string) => adb.exec(serial!, cmd);
  const holderRunning = async () =>
    holdersIn(await shell('ps -A -o PID,ARGS')).find((h) => h.tool === 'uiautomator');
  let holder: ChildProcess;

  beforeAll(async () => {
    const first = new AndroidDevice(serial!);
    await first.stopAgent();
    first.close();
    // an agent another suite started from its own state folder holds UI automation for a moment yet
    await shell('pkill -f dev.appdyno.agent.Main || true');
    // a real client of UI automation, as long as this adb session lives
    holder = spawn(adb.bin, ['-s', serial!, 'shell', 'uiautomator', 'events'], {
      stdio: 'ignore',
    });
    for (let i = 0; i < 40 && !(await holderRunning()); i++) await pause(250);
    expect(await holderRunning()).toBeDefined();
  });

  afterAll(async () => {
    holder.kill();
    const left = await holderRunning();
    if (left) await shell(left.shell);
  });

  it('names the holder and the command, and leaves it running', async () => {
    const d = new AndroidDevice(serial!);
    const e = (await d.open().catch((x: unknown) => x)) as DeviceError;
    d.close();
    expect(e).toBeInstanceOf(DeviceError);
    expect(e.code).toBe('AGENT_CONFLICT');
    const h = await holderRunning();
    expect(h).toBeDefined();
    expect(e.hint).toContain(`uiautomator (pid ${h!.pid})`);
    expect(e.hint).toContain(`adb -s ${serial} shell ${h!.shell}`);
    expect(e.hint).toContain('--takeover');
  });

  it('answers the agent with that hint through an operation, as a client sees it', async () => {
    const ctx = new ServerContext(DEFAULT_POLICY, [androidProvider()], { device: serial! });
    await expect(caller(ctx)('screen')).rejects.toMatchObject({
      code: 'AGENT_CONFLICT',
      hint: expect.stringContaining('uiautomator'),
    });
    ctx.close();
  });

  it('stops the holder only with --takeover, and drives', async () => {
    const d = new AndroidDevice(serial!, adb, 0, true);
    const hello = await d.open();
    expect(hello.platform).toBe('android');
    expect((await d.tree()).nodes.length).toBeGreaterThan(0);
    d.close();
    expect(await holderRunning()).toBeUndefined();
  });
});

describe.skipIf(!serial)('android: logs and crashes of the fixture', () => {
  let ctx: ServerContext;
  let call: Call;
  const adb = new Adb();

  beforeAll(async () => {
    ctx = new ServerContext(DEFAULT_POLICY, [androidProvider()], { device: serial!, app: APP });
    call = caller(ctx);
    await call('launch_app', { read: 'none' });
  });
  afterAll(async () => {
    ctx.close();
    // a crash dialog left up would cover the next suite's screens
    await adb.exec(serial!, `am force-stop ${APP}`);
  });

  it('reads the log since the last action, at the level asked', async () => {
    const marker = `appdyno-mark-${Date.now()}`;
    await call('screen');
    await adb.exec(serial!, `log -t appdyno-test ${marker}`);
    const r = await call('logs', { level: 'verbose', maxLines: 50 });
    expect(textOf(r)).toContain(APP);
    expect(r.data.source).toMatch(/^logcat --pid=\d+/);
    const old = await call('logs', { since: new Date(Date.now() + 60_000).toISOString() });
    expect(old.data.lines).toBe(0);
  });

  it('says an action killed the app, with the reason', async () => {
    // as a tap would: the app goes down while the action runs
    const crashing = async () => {
      const was = (await adb.exec(serial!, `pidof ${APP}`)).trim();
      await adb.exec(serial!, `am crash ${APP}`);
      for (let i = 0; i < 60 && (await adb.exec(serial!, `pidof ${APP}`)).trim() === was; i++)
        await pause(250);
      await pause(1_000);
    };
    const s = await ctx.session();
    const key = s.device.key.bind(s.device);
    s.device.key = async (...a) => {
      await crashing();
      return key(...a);
    };
    try {
      await call('launch_app', { read: 'none' });
      await call('screen');
      const r = await call('press_key', { key: 'enter', read: 'diff' });
      expect(textOf(r)).toMatch(/the app died: /);
      expect(r.data.appDied).toMatchObject({ reason: expect.stringMatching(/CRASH|EXCESSIVE/) });
    } finally {
      s.device.key = key;
    }
  });

  it('lists the crash with a summary and its file', async () => {
    let r!: ToolResult;
    let reports: { reason: string; detail?: string; file?: string }[] = [];
    // the stack comes from dropbox, written a moment after the exit
    for (let i = 0; i < 20 && !reports.some((x) => x.detail?.includes('shell-induced')); i++) {
      r = await call('crashes', { limit: 3 });
      ({ reports } = r.data as { reports: typeof reports });
      await pause(500);
    }
    const crash = reports.find((x) => x.detail?.includes('shell-induced crash'));
    expect(crash?.reason).toMatch(/crash/i);
    expect(crash?.file).toBeTruthy();
    expect(textOf(r).length).toBeLessThan(10_000);
  });

  it('audits the screen', async () => {
    await call('launch_app', { read: 'none' });
    const r = await call('audit', { maxIssues: 5 });
    expect(r.data.engine).toBe('rules');
    expect(textOf(r)).toMatch(/accessibility issue/);
  });

  it('cancels a device call and keeps working', async () => {
    const abort = new AbortController();
    const wait = inCall({ signal: abort.signal }, () =>
      call('wait_for', { text: 'never there', timeoutMs: 15_000, read: 'none' }),
    );
    setTimeout(() => abort.abort(), 200);
    const t = Date.now();
    await expect(wait).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(Date.now() - t).toBeLessThan(3_000);
    expect(textOf(await call('screen'))).toContain('elements');
  });
});

describe.skipIf(!udid)('simulator: logs and crashes of the fixture', () => {
  const PRODUCTS = join(
    import.meta.dirname,
    '../ios/.derived/Build/Products/Debug-iphonesimulator',
  );
  const simctl = new Simctl();
  let ctx: ServerContext;
  let call: Call;

  beforeAll(async () => {
    await simctl.install(udid!, join(PRODUCTS, 'Fixture.app'));
    ctx = new ServerContext(DEFAULT_POLICY, [appleProvider()], { device: udid!, app: APP });
    call = caller(ctx);
    await call('launch_app', { read: 'none' });
  });
  afterAll(() => ctx.close());

  it('reads the log of the app through the simulator', async () => {
    const r = await call('logs', {
      since: new Date(Date.now() - 120_000).toISOString(),
      level: 'info',
      maxLines: 20,
    });
    expect(r.data.source).toBe('simctl spawn log show');
    expect(r.data.lines).toBeGreaterThan(0);
    expect(textOf(r)).toMatch(/Fixture|fixture/);
  });

  it('says an action killed the app, with the reason, and lists the report', async () => {
    await call('screen');
    const device = new IosSimulatorDevice(udid!);
    const found = Number(
      execFileSync('xcrun', ['simctl', 'spawn', udid!, 'launchctl', 'list'], { encoding: 'utf8' })
        .split('\n')
        .find((l) => l.includes(`UIKitApplication:${APP}[`))
        ?.trim()
        .split(/\s+/)[0],
    );
    device.close();
    expect(found).toBeGreaterThan(0);
    process.kill(found, 'SIGSEGV');
    await pause(1_000);
    const r = await call('press_key', { key: 'enter', read: 'diff' }).catch((e: unknown) => e);
    const text = r instanceof Error ? r.message : textOf(r as ToolResult);
    // the runner aimed at a dead app may refuse the key: then the screen says the rest
    if (!(r instanceof Error)) {
      expect(text).toMatch(/the app died: /);
      expect((r as ToolResult).data.appDied).toBeDefined();
    }
    let reports: { reason: string; file?: string }[] = [];
    for (let i = 0; i < 20 && reports.length === 0; i++) {
      const c = await call('crashes', {
        since: new Date(Date.now() - 30_000).toISOString(),
        limit: 2,
      });
      reports = (c.data as { reports: typeof reports }).reports;
      if (reports.length === 0) await pause(1_000);
    }
    expect(reports[0]!.reason).toMatch(/SIGSEGV|EXC_/);
    expect(reports[0]!.file).toMatch(/\.ips$/);
  });

  it('cancels a device call and keeps working', async () => {
    await call('launch_app', { read: 'none' });
    const abort = new AbortController();
    const wait = inCall({ signal: abort.signal }, () =>
      call('wait_for', { text: 'never there', timeoutMs: 15_000, read: 'none' }),
    );
    setTimeout(() => abort.abort(), 200);
    await expect(wait).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(textOf(await call('screen'))).toContain('elements');
  });
});

const iphone = process.env.APPDYNO_IPHONE_UDID;
const iphoneFixture = process.env.APPDYNO_IPHONE_FIXTURE_APP;
describe.skipIf(!iphone || !iphoneFixture)('iPhone: logs and crashes of the fixture', () => {
  let ctx: ServerContext;
  let call: Call;
  const ctl = new Devicectl(iphone ?? '00000000-0000000000000000');

  beforeAll(async () => {
    await ctl.install(iphoneFixture!);
    ctx = new ServerContext(DEFAULT_POLICY, [appleProvider()], { device: iphone!, app: APP });
    call = caller(ctx);
    await call('launch_app', { read: 'none' });
  }, 240_000);
  afterAll(() => ctx?.close());

  it('says what it cannot read of a phone log, and how to read it', async () => {
    const r = await call('logs');
    expect(r.data.source).toBe('devicectl');
    expect(r.data.lines).toBe(0);
    expect(textOf(r)).toMatch(/process launch --console/);
  });

  it('says an action killed the app, and copies its crash report from the phone', async () => {
    await call('screen');
    await ctl.json([
      'device',
      'process',
      'signal',
      '--device',
      iphone!,
      '--pid',
      String(await ctl.pid(APP)),
      '--signal',
      'SIGSEGV',
    ]);
    await pause(1_000);
    const r = await call('press_key', { key: 'enter', read: 'diff' }).catch((e: unknown) => e);
    if (!(r instanceof Error)) expect(textOf(r as ToolResult)).toMatch(/the app died: /);
    let reports: { reason: string; file?: string }[] = [];
    // the phone writes the report a moment after the death
    for (let i = 0; i < 20 && reports.length === 0; i++) {
      const c = await call('crashes', {
        since: new Date(Date.now() - 120_000).toISOString(),
        limit: 2,
      });
      reports = (c.data as { reports: typeof reports }).reports;
      if (reports.length === 0) await pause(3_000);
    }
    expect(reports[0]?.reason).toMatch(/SIGSEGV|EXC_/);
    expect(reports[0]?.file).toMatch(/\.ips$/);
  }, 240_000);
});
