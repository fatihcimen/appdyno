import { execFileSync, spawn } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Device, DeviceProvider, DeviceSettings, SettingName } from '@appdyno/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, ServerContext } from '../src/index.js';
import { FakeDevice } from './fake-device.js';
import { callerOf } from './helpers.js';

const tick = () => new Promise((r) => setTimeout(r, 1));

class Settings implements DeviceSettings {
  values: Record<string, string> = { dark_mode: 'no', text_size: '1.0', reduce_motion: 'off' };
  failNext = false;
  get = async (name: SettingName) => {
    await tick();
    return this.values[name]!;
  };
  set = async (name: SettingName, value: string) => {
    await tick();
    if (this.failNext) {
      this.failNext = false;
      throw new Error('broke');
    }
    this.values[name] = value;
  };
  push = async () => undefined;
  biometric = async () => undefined;
  resetKeychain = async () => 0;
  fold = async () => undefined;
  call = async () => undefined;
  sms = async () => undefined;
}

const withSettings = () => {
  const settings = new Settings();
  return { settings, device: Object.assign(new FakeDevice(), { settings }) };
};

function connect(device: Device, defaults: ConstructorParameters<typeof ServerContext>[2] = {}) {
  const provider: DeviceProvider = {
    list: async () => [{ serial: device.serial, state: 'device', ready: true }],
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext(DEFAULT_POLICY, [provider], { app: 'dev.app', ...defaults });
  return { ctx, call: callerOf(ctx) };
}

const startedOf = (pid: number) =>
  execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim();

/** A process that runs until killed, as an owner in a state file. */
function liveProcess() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
  const owner = {
    pid: child.pid!,
    started: startedOf(child.pid!),
    tool: 'other agent',
    since: '2026-11-03T00:00:00Z',
  };
  const kill = async () => {
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));
  };
  return { owner, kill };
}

/** An owner that is gone: what a server killed outright leaves behind. */
async function killedProcess() {
  const p = liveProcess();
  await p.kill();
  return p.owner;
}

const stateFile = (folder: string, serial: string) =>
  join(process.env.APPDYNO_STATE_DIR!, folder, `${serial}.json`);

function leave(folder: string, serial: string, value: unknown) {
  const file = stateFile(folder, serial);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-lifetime-')));
});

describe('whose conditions go back', () => {
  it('leaves what a live process set: at the start of a session, at its end and on restore', async () => {
    const { settings, device } = withSettings();
    const other = liveProcess();
    try {
      settings.values.dark_mode = 'yes';
      leave('conditions', device.serial, { dark_mode: { was: 'no', owner: other.owner } });
      const { ctx, call } = connect(device, { claims: true });
      const used = await call('use_device', { device: device.serial });
      expect(used.text).not.toContain('restored');
      expect(settings.values.dark_mode).toBe('yes');
      const asked = await call('device_setting', { name: 'restore' });
      expect(asked.text).toContain(`dark_mode (pid ${other.owner.pid})`);
      expect(settings.values.dark_mode).toBe('yes');
      expect(await ctx.end()).toEqual([]);
      expect(settings.values.dark_mode).toBe('yes');
      ctx.close();
    } finally {
      await other.kill();
    }
  });

  it('puts back only a dead owner’s, and says so', async () => {
    const { settings, device } = withSettings();
    const other = liveProcess();
    try {
      settings.values = { dark_mode: 'yes', text_size: '1.3', reduce_motion: 'on' };
      leave('conditions', device.serial, {
        dark_mode: { was: 'no', owner: other.owner },
        text_size: { was: '1.0', owner: await killedProcess() },
        reduce_motion: { was: 'off' },
      });
      const { ctx, call } = connect(device, { claims: true });
      const used = await call('use_device', { device: device.serial });
      expect(used.text).toContain('restored what an ended session left changed: text_size: 1.0');
      expect(settings.values).toEqual({
        dark_mode: 'yes',
        text_size: '1.0',
        reduce_motion: 'on',
      });
      ctx.close();
    } finally {
      await other.kill();
    }
  });

  it('puts back a dead owner’s for a session that shares the device too', async () => {
    const { settings, device } = withSettings();
    settings.values.dark_mode = 'yes';
    leave('conditions', device.serial, {
      dark_mode: { was: 'no', owner: await killedProcess() },
    });
    const { ctx, call } = connect(device, { claims: true, share: true });
    await call('use_device', { device: device.serial });
    expect(settings.values.dark_mode).toBe('no');
    ctx.close();
  });

  it('a command line’s change outlives a later session, and goes when asked', async () => {
    const { settings, device } = withSettings();
    const remember = join(mkdtempSync(join(tmpdir(), 'appdyno-cli-')), 's');
    const cli = connect(device, { remember });
    await cli.call('device_setting', { name: 'dark_mode', value: 'yes' });
    expect(await cli.ctx.end()).toEqual([]);
    cli.ctx.close();
    const next = connect(device, { claims: true });
    await next.call('use_device', { device: device.serial });
    expect(settings.values.dark_mode).toBe('yes');
    expect(await next.ctx.end()).toEqual([]);
    expect(settings.values.dark_mode).toBe('yes');
    next.ctx.close();
    const later = connect(device, { remember });
    expect((await later.call('device_setting', { name: 'restore' })).text).toContain(
      'restored dark_mode: no',
    );
    expect(settings.values.dark_mode).toBe('no');
    later.ctx.close();
  });

  it('a session’s end puts back its own', async () => {
    const { settings, device } = withSettings();
    const { ctx, call } = connect(device);
    await call('device_setting', { name: 'dark_mode', value: 'yes' });
    expect(await ctx.end()).toEqual([]);
    expect(settings.values.dark_mode).toBe('no');
    expect(existsSync(stateFile('conditions', device.serial))).toBe(false);
  });
});

describe('a conditions file', () => {
  it.each([
    ['cut short', '{"dark_mode":{"was":"n'],
    ['of another shape', '["x"]'],
    ['with no old value', '{"dark_mode":{}}'],
  ])('that is %s is said at the start, touches nothing and is kept', async (_, text) => {
    const { settings, device } = withSettings();
    const set = vi.spyOn(settings, 'set');
    const file = leave('conditions', device.serial, text);
    const { ctx, call } = connect(device, { claims: true });
    const used = await call('use_device', { device: device.serial });
    expect(used.text).toContain('could not restore');
    expect(used.text).toContain(`${file}.bad`);
    expect(readFileSync(`${file}.bad`, 'utf8')).toBe(text);
    expect(set).not.toHaveBeenCalled();
    await call('device_setting', { name: 'dark_mode', value: 'yes' });
    expect(readFileSync(`${file}.bad`, 'utf8')).toBe(text);
    expect(await ctx.end()).toEqual([]);
    expect(settings.values.dark_mode).toBe('no');
    ctx.close();
  });

  it('is never written in place, so a process killed midway cannot cut it short', async () => {
    const { device } = withSettings();
    const { call } = connect(device);
    await call('device_setting', { name: 'dark_mode', value: 'yes' });
    const file = stateFile('conditions', device.serial);
    const earlier = join(dirname(file), 'earlier');
    linkSync(file, earlier);
    const before = readFileSync(earlier, 'utf8');
    await call('device_setting', { name: 'text_size', value: '1.3' });
    expect(readFileSync(earlier, 'utf8')).toBe(before);
    expect(readFileSync(file, 'utf8')).toContain('text_size');
  });
});

describe('tool calls in parallel', () => {
  it('keep every old value', async () => {
    const { settings, device } = withSettings();
    const { ctx, call } = connect(device);
    await Promise.all([
      call('device_setting', { name: 'dark_mode', value: 'yes' }),
      call('device_setting', { name: 'text_size', value: '1.3' }),
      call('device_setting', { name: 'reduce_motion', value: 'on' }),
    ]);
    expect(await ctx.end()).toEqual([]);
    expect(settings.values).toEqual({ dark_mode: 'no', text_size: '1.0', reduce_motion: 'off' });
  });

  it('keep the old value when one of two changes to it fails', async () => {
    const { settings, device } = withSettings();
    const { ctx, call } = connect(device);
    settings.failNext = true;
    await Promise.allSettled([
      call('device_setting', { name: 'dark_mode', value: 'yes' }),
      call('device_setting', { name: 'dark_mode', value: 'on' }),
    ]);
    expect(settings.values.dark_mode).toBe('on');
    expect(await ctx.end()).toEqual([]);
    expect(settings.values.dark_mode).toBe('no');
  });

  it('open a device once, and clean up after it once', async () => {
    const { settings, device } = withSettings();
    const open = vi.spyOn(device, 'open');
    const set = vi.spyOn(settings, 'set');
    settings.values.dark_mode = 'yes';
    leave('conditions', device.serial, {
      dark_mode: { was: 'no', owner: await killedProcess() },
    });
    const { ctx, call } = connect(device, { claims: true });
    await Promise.all([call('device_info'), call('device_info'), call('device_info')]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
    ctx.close();
  });
});

describe('what a process leaves running', () => {
  const stops = { recording: vi.fn(), network: vi.fn() };
  beforeEach(() => {
    stops.recording.mockReset().mockResolvedValue({ files: [] });
    stops.network.mockReset().mockResolvedValue({ entries: [] });
  });

  const equipped = () =>
    Object.assign(new FakeDevice(), {
      recorder: {
        extension: 'mp4' as const,
        start: async () => ({ id: 'r' }),
        stop: stops.recording,
      },
      network: {
        paths: async () => [{ via: 'bytes' as const, sees: 'bytes' }],
        start: async () => ({ id: 'n' }),
        read: async () => ({ entries: [] }),
        stop: stops.network,
      },
    });

  const KINDS = [
    {
      kind: 'a recording',
      folder: 'video',
      left: { handle: { id: 'r' }, since: 'then', file: '/nowhere/a.mp4' },
      says: 'recording stopped',
      stop: () => stops.recording,
    },
    {
      kind: 'a network capture',
      folder: 'network',
      left: { via: 'bytes', since: 1, handle: { id: 'n' } },
      says: 'network capture stopped',
      stop: () => stops.network,
    },
    {
      kind: 'an open report',
      folder: 'reports',
      left: { since: 1 },
      says: 'report written',
      stop: undefined,
    },
  ];

  const held = (k: (typeof KINDS)[number], owner?: unknown) => ({
    ...k.left,
    ...(k.folder === 'reports' && { dir: mkdtempSync(join(tmpdir(), 'appdyno-report-')) }),
    ...(owner !== undefined && { owner }),
  });

  it.each(KINDS)('ends $kind a dead process left, and says so', async (k) => {
    const device = equipped();
    const left = held(k, await killedProcess());
    const file = leave(k.folder, device.serial, left);
    const { ctx, call } = connect(device);
    const used = await call('use_device', { device: device.serial });
    expect(used.text).toContain(k.says);
    expect(existsSync(file)).toBe(false);
    if (k.stop) expect(k.stop()).toHaveBeenCalledWith({ id: k.folder === 'video' ? 'r' : 'n' });
    else expect(existsSync(join((left as { dir: string }).dir, 'index.html'))).toBe(true);
    ctx.close();
  });

  it.each(KINDS)('leaves $kind a live process runs, through a session and its end', async (k) => {
    const device = equipped();
    const other = liveProcess();
    try {
      const file = leave(k.folder, device.serial, held(k, other.owner));
      const { ctx, call } = connect(device);
      expect((await call('use_device', { device: device.serial })).text).not.toContain(k.says);
      expect(await ctx.end()).toEqual([]);
      expect(existsSync(file)).toBe(true);
      if (k.stop) expect(k.stop()).not.toHaveBeenCalled();
      ctx.close();
    } finally {
      await other.kill();
    }
  });

  it.each(KINDS)('leaves $kind a command line started, for its next command', async (k) => {
    const device = equipped();
    const file = leave(k.folder, device.serial, held(k));
    const { ctx, call } = connect(device);
    expect((await call('use_device', { device: device.serial })).text).not.toContain(k.says);
    expect(await ctx.end()).toEqual([]);
    expect(existsSync(file)).toBe(true);
    ctx.close();
  });

  it.each([
    ['video', 'recording'],
    ['network', 'network'],
    ['reports', 'report'],
    ['recordings', 'flow recording'],
  ])('says a %s file that cannot be read, and keeps it', async (folder, what) => {
    const device = equipped();
    const file = leave(folder, device.serial, '{"cut":');
    const { ctx, call } = connect(device);
    const { text } = await call('use_device', { device: device.serial });
    expect(text).toContain(`could not restore ${what}: unreadable, kept as ${file}.bad`);
    expect(existsSync(file)).toBe(false);
    ctx.close();
  });

  it('puts the proxy of a dead process’s capture back', async () => {
    const { settings, device } = withSettings();
    settings.values.proxy = 'localhost:9090';
    const owner = await killedProcess();
    leave('network', device.serial, { via: 'proxy', since: 1, proxy: 'localhost:9090', owner });
    leave('conditions', device.serial, { proxy: { was: 'none', owner } });
    const { ctx, call } = connect(device);
    await call('use_device', { device: device.serial });
    expect(settings.values.proxy).toBe('none');
    ctx.close();
  });

  it('does not put a proxy back that a live process set', async () => {
    const { settings, device } = withSettings();
    settings.values.proxy = 'localhost:9090';
    const other = liveProcess();
    try {
      leave('network', device.serial, {
        via: 'proxy',
        since: 1,
        proxy: 'localhost:9090',
        owner: await killedProcess(),
      });
      leave('conditions', device.serial, { proxy: { was: 'none', owner: other.owner } });
      const { ctx, call } = connect(device);
      await call('use_device', { device: device.serial });
      expect(settings.values.proxy).toBe('localhost:9090');
      ctx.close();
    } finally {
      await other.kill();
    }
  });

  it('a session’s end stops its own recording and capture', async () => {
    const device = equipped();
    const { ctx, call } = connect(device);
    await call('record', { action: 'start', file: join(tmpdir(), 'appdyno-own.mp4') });
    await call('network', { action: 'start', via: 'bytes' });
    expect(await ctx.end()).toEqual([]);
    expect(stops.recording).toHaveBeenCalledOnce();
    expect(stops.network).toHaveBeenCalledOnce();
  });

  it('a command line’s recording outlives a session, and its next command stops it', async () => {
    const device = equipped();
    const remember = join(mkdtempSync(join(tmpdir(), 'appdyno-cli-')), 's');
    const start = connect(device, { remember });
    await start.call('record', { action: 'start', file: join(tmpdir(), 'appdyno-cli.mp4') });
    start.ctx.close();
    const session = connect(device);
    await session.call('use_device', { device: device.serial });
    expect(await session.ctx.end()).toEqual([]);
    expect(stops.recording).not.toHaveBeenCalled();
    const stop = connect(device, { remember });
    await stop.call('record', { action: 'stop' });
    expect(stops.recording).toHaveBeenCalledOnce();
  });
});

describe('a flow recording', () => {
  const recording = (serial: string) =>
    JSON.parse(readFileSync(stateFile('recordings', serial), 'utf8')) as {
      running: boolean;
      steps: unknown[];
      owner?: { pid: number };
    };

  it('a dead process left is stopped with its steps kept', async () => {
    const device = new FakeDevice();
    await connect(device).call('flow', { action: 'start' });
    expect(recording(device.serial).owner?.pid).toBe(process.pid);
    const left = {
      ...recording(device.serial),
      steps: [{ action: 'launch', line: 0, args: {}, flags: [] }],
      owner: await killedProcess(),
    };
    leave('recordings', device.serial, left);
    const { ctx, call } = connect(device);
    const used = await call('use_device', { device: device.serial });
    expect(used.text).toContain('flow recording stopped');
    expect(recording(device.serial)).toMatchObject({ running: false, steps: left.steps });
    ctx.close();
  });

  it('a live process runs is left going', async () => {
    const device = new FakeDevice();
    const other = liveProcess();
    try {
      await connect(device).call('flow', { action: 'start' });
      leave('recordings', device.serial, { ...recording(device.serial), owner: other.owner });
      const { ctx, call } = connect(device);
      await call('use_device', { device: device.serial });
      expect(recording(device.serial).running).toBe(true);
      ctx.close();
    } finally {
      await other.kill();
    }
  });

  it('a command line started has no owner, and goes on across its commands', async () => {
    const device = new FakeDevice();
    const remember = join(mkdtempSync(join(tmpdir(), 'appdyno-cli-')), 's');
    await connect(device, { remember }).call('flow', { action: 'start' });
    expect(recording(device.serial).owner).toBeUndefined();
    const { ctx, call } = connect(device);
    await call('use_device', { device: device.serial });
    expect(recording(device.serial).running).toBe(true);
    ctx.close();
  });
});
