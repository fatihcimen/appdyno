import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, type DeviceProvider, type ScreenRecorder } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { ServerContext } from '../src/context.js';
import { DEFAULT_POLICY } from '../src/policy.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { checkedOps } from '@appdyno/testing/calls.js';

function connect(recorder: ScreenRecorder) {
  const device = Object.assign(new FakeDevice(), { recorder });
  const provider: DeviceProvider = {
    list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext(DEFAULT_POLICY, [provider], { app: 'dev.app' });
  const op = must(checkedOps(ctx).record, 'record');
  const call = (args: Record<string, unknown>) => op.handler(op.input.parse(args));
  return { ctx, call };
}

describe('record', () => {
  let file: string;
  beforeEach(() => {
    process.env.APPDYNO_STATE_DIR = mkdtempSync(join(tmpdir(), 'appdyno-state-'));
    file = join(mkdtempSync(join(tmpdir(), 'appdyno-video-')), 'a.mp4');
  });
  const recorder = (stop: ScreenRecorder['stop']): ScreenRecorder => ({
    extension: 'mp4',
    start: (to) => Promise.resolve({ file: to }),
    stop,
  });

  it('refuses a file that does not play, and lets the next recording start', async () => {
    const { call } = connect(
      recorder((h) => {
        writeFileSync(String(h.file), 'not a video');
        return Promise.resolve({ files: [String(h.file)] });
      }),
    );
    await call({ action: 'start', file });
    await expect(call({ action: 'start', file })).rejects.toThrow(/stop it first/);
    await expect(call({ action: 'stop' })).rejects.toThrow(/not a playable video/);
    await expect(call({ action: 'stop' })).rejects.toThrow(/no recording runs/);
    await call({ action: 'start', file });
  });

  it('keeps a recording whose device went away, for when it comes back', async () => {
    let gone = true;
    const { call } = connect(
      recorder(() => {
        if (gone) return Promise.reject(new DeviceError('DEVICE_GONE', 'unplugged'));
        return Promise.reject(
          new DeviceError('INTERNAL', 'the recording failed: its file is torn'),
        );
      }),
    );
    await call({ action: 'start', file });
    await expect(call({ action: 'stop' })).rejects.toThrow(/unplugged/);
    gone = false;
    await expect(call({ action: 'stop' })).rejects.toThrow(/its file is torn/);
    await expect(call({ action: 'stop' })).rejects.toThrow(/no recording runs/);
  });

  it('a failed end is said at the end of the session', async () => {
    const { call, ctx } = connect(
      recorder(() => Promise.resolve({ files: [join(tmpdir(), 'none.mp4')] })),
    );
    await call({ action: 'start', file });
    expect((await ctx.end())[0]).toMatch(/^recording: .*not a playable video/);
  });
});
