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
