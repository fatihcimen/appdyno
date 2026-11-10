import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { DeviceProvider, DeviceSettings, SettingName } from '@appdyno/core';
import { conditions, DEFAULT_POLICY, ServerContext } from '@appdyno/ops';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '../../ops/test/fake-device.js';
import { callerOf } from '../../ops/test/helpers.js';
import { endWithClient, putBackAfter } from '../src/lifetime.js';

const providerOf = (device: FakeDevice): DeviceProvider => ({
  list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
  handles: () => true,
  open: () => device,
});

function serving(handOff?: (devices: string[]) => string[]) {
  const values: Record<string, string> = { dark_mode: 'no' };
  const set = vi.fn((name: SettingName, value: string) => {
    values[name] = value;
    return Promise.resolve();
  });
  const persist = vi.fn(() => Promise.resolve());
  const settings = {
    get: (name: SettingName) => Promise.resolve(values[name]),
    set,
    persist,
  } as unknown as DeviceSettings;
  const device = Object.assign(new FakeDevice(), { settings });
  const ctx = new ServerContext(DEFAULT_POLICY, [providerOf(device)], { claims: true });
  const close = vi.spyOn(ctx, 'close');
  const exit = vi.fn();
  const stdin = new PassThrough();
  const log = vi.fn<(line: object) => void>();
  endWithClient(ctx, log, exit, stdin, handOff);
  return { values, set, persist, ctx, close, exit, stdin, log, call: callerOf(ctx), device };
}

const signals = ['SIGTERM', 'SIGINT'] as const;

/** A signal that nothing here should still be waiting for. */
const drain = () => signals.forEach((s) => process.emit(s));

describe('the end of the server', () => {
  beforeEach(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-end-')));
  });
  afterEach(() => vi.useRealTimers());

  it.each(signals)('%s ends the session as the client leaving does', async (signal) => {
    const s = serving();
    await s.call('device_setting', { name: 'dark_mode', value: 'yes' });
    process.emit(signal);
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(0));
    expect(s.values.dark_mode).toBe('no');
    expect(s.close).toHaveBeenCalledOnce();
    drain();
  });

  it('the client closing stdin does the same', async () => {
    const s = serving();
    await s.call('device_setting', { name: 'dark_mode', value: 'yes' });
    s.stdin.destroy();
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(0));
    expect(s.values.dark_mode).toBe('no');
    drain();
  });

  it('with no stdin to watch, as over HTTP, goes on until a signal', async () => {
    const end = vi.fn(() => Promise.resolve([]));
    const exit = vi.fn();
    endWithClient({ end, close: () => undefined }, vi.fn(), exit, null);
    await new Promise((r) => setTimeout(r, 5));
    expect(end).not.toHaveBeenCalled();
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    drain();
  });

  it('ends once, however many ask', async () => {
    const s = serving();
    await s.call('device_setting', { name: 'dark_mode', value: 'yes' });
    s.stdin.destroy();
    drain();
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(s.exit).toHaveBeenCalledOnce();
    expect(s.close).toHaveBeenCalledOnce();
    expect(s.set).toHaveBeenCalledTimes(2);
  });

  it('hands what is kept on disk to the process that puts it back once this one has gone', async () => {
    const handOff = vi.fn((devices: string[]) => devices);
    const s = serving(handOff);
    await s.call('device_setting', { name: 'dark_mode', value: 'yes' });
    // as claude -p ends its server: a kill half a second after, which no put-back of seconds outlasts
    process.emit('SIGINT');
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(0));
    expect(handOff).toHaveBeenCalledWith([s.device.serial]);
    expect(s.set).toHaveBeenCalledTimes(1);
    expect(conditions.read(s.device.serial)).toMatchObject({ dark_mode: { was: 'no' } });
    drain();
  });

  it('puts back what a server that has gone left, and lets the settings reach the disk', async () => {
    const s = serving();
    s.values.dark_mode = 'yes';
    const gone = { pid: 999_999, started: 'gone', tool: 'appdyno mcp', since: '' };
    conditions.update(s.device.serial, () => ({ dark_mode: { was: 'no', owner: gone } }));
    const ctx = new ServerContext(DEFAULT_POLICY, [providerOf(s.device)], {
      claims: true,
      device: s.device.serial,
    });
    await putBackAfter(gone.pid, ctx, s.log);
    expect(s.values.dark_mode).toBe('no');
    expect(s.log).toHaveBeenCalledWith({
      putBackAfter: gone.pid,
      serial: s.device.serial,
      restored: ['dark_mode: off'],
      failed: [],
    });
    expect(s.persist).toHaveBeenCalledOnce();
    drain();
  });

  it('says what it could not put back, and still exits', async () => {
    const s = serving();
    await s.call('device_setting', { name: 'dark_mode', value: 'yes' });
    s.set.mockRejectedValueOnce(new Error('broke'));
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalled());
    expect(s.log.mock.calls[0]?.[0]).toMatchObject({
      conditionNotRestored: expect.stringContaining('broke') as unknown,
    });
    drain();
  });

  it('gives up on a device that does not answer, and still exits', async () => {
    const s = serving();
    await s.call('device_setting', { name: 'dark_mode', value: 'yes' });
    s.set.mockReturnValueOnce(new Promise(() => undefined));
    vi.useFakeTimers();
    process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.exit).toHaveBeenCalledWith(0);
    expect(s.log).toHaveBeenCalledWith({ conditionNotRestored: 'timed out' });
    drain();
  });
});
