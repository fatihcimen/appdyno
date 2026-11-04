import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceProvider, ScreenRecorder } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { ServerContext } from '../src/context.js';
import { DEFAULT_POLICY } from '../src/policy.js';
import type { Op } from '../src/tool.js';
import { FakeDevice } from './fake-device.js';
import { checkedOps } from './helpers.js';

function connect(recorder: ScreenRecorder | undefined) {
  const device = Object.assign(new FakeDevice(), recorder ? { recorder } : {});
  const provider: DeviceProvider = {
    list: async () => [{ serial: device.serial, state: 'device', ready: true }],
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext(DEFAULT_POLICY, [provider], { app: 'dev.app' });
  const op = checkedOps(ctx).record as Op;
  const call = (args: Record<string, unknown>) =>
    op.handler(op.input.parse(args) as Record<string, unknown>);
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
    start: async (to) => ({ file: to }),
    stop,
  });

  it('says what a device without a recorder cannot do', async () => {
    await expect(connect(undefined).call({ action: 'start' })).rejects.toThrow(/cannot record/);
  });

  it('refuses a file that does not play, and lets the next recording start', async () => {
    const { call } = connect(
      recorder(async (h) => {
        writeFileSync(String(h.file), 'not a video');
        return { files: [String(h.file)] };
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
      recorder(async () => {
        if (gone) throw new DeviceError('DEVICE_GONE', 'unplugged');
        throw new DeviceError('INTERNAL', 'the recording failed: its file is torn');
      }),
    );
    await call({ action: 'start', file });
    await expect(call({ action: 'stop' })).rejects.toThrow(/unplugged/);
    gone = false;
    await expect(call({ action: 'stop' })).rejects.toThrow(/its file is torn/);
    await expect(call({ action: 'stop' })).rejects.toThrow(/no recording runs/);
  });

  it('a failed end is said at the end of the session', async () => {
    const { call, ctx } = connect(recorder(async () => ({ files: [join(tmpdir(), 'none.mp4')] })));
    await call({ action: 'start', file });
    expect((await ctx.end())[0]).toMatch(/^recording: .*not a playable video/);
  });
});
