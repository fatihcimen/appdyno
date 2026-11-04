import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { DeviceProvider, DeviceSettings, SettingName } from '@appdyno/core';
import { DEFAULT_POLICY, ServerContext } from '@appdyno/ops';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '../../ops/test/fake-device.js';
import { callerOf } from '../../ops/test/helpers.js';
import { endWithClient } from '../src/lifetime.js';

function serving() {
  const values: Record<string, string> = { dark_mode: 'no' };
  const settings = {
    get: async (name: SettingName) => values[name]!,
    set: vi.fn(async (name: SettingName, value: string) => {
      values[name] = value;
    }),
  } as unknown as DeviceSettings;
  const device = Object.assign(new FakeDevice(), { settings });
  const provider: DeviceProvider = {
    list: async () => [{ serial: device.serial, state: 'device', ready: true }],
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext(DEFAULT_POLICY, [provider], { claims: true });
  const close = vi.spyOn(ctx, 'close');
  const exit = vi.fn();
  const stdin = new PassThrough();
  const log = vi.fn();
  endWithClient(ctx, log, exit, stdin);
  return { values, settings, ctx, close, exit, stdin, log, call: callerOf(ctx) };
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
    const end = vi.fn(async () => []);
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
    expect(s.settings.set).toHaveBeenCalledTimes(2);
  });

  it('says what it could not put back, and still exits', async () => {
    const s = serving();
    await s.call('device_setting', { name: 'dark_mode', value: 'yes' });
    vi.mocked(s.settings.set).mockRejectedValueOnce(new Error('broke'));
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalled());
    expect(s.log.mock.calls[0]![0].conditionNotRestored).toContain('broke');
    drain();
  });

  it('gives up on a device that does not answer, and still exits', async () => {
    const s = serving();
    await s.call('device_setting', { name: 'dark_mode', value: 'yes' });
    vi.mocked(s.settings.set).mockReturnValueOnce(new Promise(() => undefined));
    vi.useFakeTimers();
    process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.exit).toHaveBeenCalledWith(0);
    expect(s.log).toHaveBeenCalledWith({ conditionNotRestored: 'timed out' });
    drain();
  });
});
