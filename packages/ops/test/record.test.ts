import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, type DeviceProvider, type ScreenRecorder } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerContext } from '../src/context.js';
import { DEFAULT_POLICY } from '../src/policy.js';
import { filming } from '../src/record.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { fakeVideo } from '@appdyno/testing/fake-video.js';
import { checkedOps } from '@appdyno/testing/calls.js';

function connect(recorder: ScreenRecorder) {
  const device = Object.assign(new FakeDevice(), { recorder });
  const provider: DeviceProvider = {
    list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext({ ...DEFAULT_POLICY, writeDirs: [tmpdir()] }, [provider], {
    app: 'dev.app',
  });
  const op = must(checkedOps(ctx).record_session, 'record_session');
  const call = (args: Record<string, unknown>) =>
    op.handler(op.input.parse({ kind: 'video', ...args }));
  return { ctx, call, serial: device.serial };
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

  it('says how long the file plays, which a still screen at its end makes longer than its frames', async () => {
    const { call } = connect(
      recorder((h) => {
        writeFileSync(
          String(h.file),
          fakeVideo([Buffer.from('aaa'), Buffer.from('bb')], { heldMs: 7_418 }),
        );
        return Promise.resolve({ files: [String(h.file)] });
      }),
    );
    await call({ action: 'start', file });
    const r = await call({ action: 'stop' });
    expect(r.blocks[0]).toMatchObject({ text: `${file}: 7.4 s, 2 frames, 1080x2400, avc1` });
    expect(r.data).toMatchObject({ durationMs: 7_418 });
  });

  it('refuses a file that does not play, and lets the next recording start', async () => {
    const { call } = connect(
      recorder((h) => {
        writeFileSync(String(h.file), 'not a video');
        return Promise.resolve({ files: [String(h.file)] });
      }),
    );
    await call({ action: 'start', file });
    await expect(call({ action: 'start', file })).rejects.toThrow(/a recording has run/);
    await expect(call({ action: 'stop' })).rejects.toThrow(/not a playable video/);
    await expect(call({ action: 'stop' })).rejects.toThrow(/no recording runs/);
    await call({ action: 'start', file, overwrite: true });
  });

  it('writes over no file that is there, nor one that is not a video, unless asked', async () => {
    const { call } = connect(recorder(() => Promise.resolve({ files: [] })));
    const other = join(file, '..', 'notes.txt');
    writeFileSync(other, 'kept');
    await expect(call({ action: 'start', file: other })).rejects.toThrow(/a \.mp4 file/);
    writeFileSync(file, 'kept');
    await expect(call({ action: 'start', file })).rejects.toThrow(/is there already/);
    expect(readFileSync(file, 'utf8')).toBe('kept');
    expect(readFileSync(other, 'utf8')).toBe('kept');
    await call({ action: 'start', file, overwrite: true });
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

  describe('a recording that has ended by itself gives way to the next', () => {
    const kept = (h: Record<string, string | number>) => {
      writeFileSync(String(h.file), fakeVideo([Buffer.from('aaa'), Buffer.from('bb')]));
      return Promise.resolve({ files: [String(h.file)] });
    };
    const second = () => join(file, '..', 'b.mp4');

    it('when its process has gone, keeping its file, and says when it ended', async () => {
      const ended = Date.parse('2026-11-18T22:40:00.000Z');
      const { call, serial } = connect({
        ...recorder(kept),
        endedAt: () => Promise.resolve(ended),
      });
      await call({ action: 'start', file });
      const r = await call({ action: 'start', file: second() });
      const line = `the last recording on ${serial} ended on its own at 2026-11-18T22:40:00.000Z: ${file}`;
      expect(r.blocks[0]).toMatchObject({ text: expect.stringContaining(`\n${line}`) as string });
      expect(r.data).toMatchObject({ files: [second()], note: line });
      expect(readFileSync(file).length).toBeGreaterThan(0);
      const end = await call({ action: 'stop' });
      expect(end.data).toMatchObject({ files: [second()] });
    });

    it('when its time has passed, whatever its process says, as on a Mac that slept', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const { call } = connect({ ...recorder(kept), endedAt: () => Promise.resolve(undefined) });
        await call({ action: 'start', file, maxSeconds: 5 });
        const until = new Date(Date.now() + 5_000).toISOString();
        await expect(call({ action: 'start', file: second() })).rejects.toMatchObject({
          code: 'DEVICE_CLAIMED',
        });
        vi.setSystemTime(Date.now() + 6_000);
        const r = await call({ action: 'start', file: second() });
        expect(String(r.data.note)).toContain(`ended on its own at ${until}: ${file}`);
      } finally {
        vi.useRealTimers();
      }
    });

    it('even where its file cannot be kept, which it says', async () => {
      const torn = (h: Record<string, string | number>) => {
        writeFileSync(String(h.file), 'not a video');
        return Promise.resolve({ files: [String(h.file)] });
      };
      const { call } = connect({ ...recorder(torn), endedAt: () => Promise.resolve(0) });
      await call({ action: 'start', file });
      const r = await call({ action: 'start', file: second() });
      expect(String(r.data.note)).toMatch(
        /ended on its own: it could not be kept: .*not a playable video/,
      );
      expect(r.data).toMatchObject({ files: [second()] });
    });

    it('but one still running is refused, saying how to end it', async () => {
      const { call } = connect({ ...recorder(kept), endedAt: () => Promise.resolve(undefined) });
      await call({ action: 'start', file });
      await expect(call({ action: 'start', file: second() })).rejects.toMatchObject({
        code: 'DEVICE_CLAIMED',
        message: expect.stringMatching(/^a recording has run on .* \(to .*a\.mp4\)$/) as string,
        hint: 'record_session with kind video and action stop ends it',
      });
    });

    it("and a timeline's, ended or not, is the timeline's to end", async () => {
      const { call, serial } = connect({ ...recorder(kept), endedAt: () => Promise.resolve(1) });
      filming.write(serial, {
        handle: { file },
        since: new Date().toISOString(),
        file,
        by: 'timeline',
      });
      await expect(call({ action: 'start', file: second() })).rejects.toMatchObject({
        code: 'DEVICE_CLAIMED',
        hint: 'record_session with kind timeline and action stop ends it',
      });
    });
  });

  it('a failed end is said at the end of the session', async () => {
    const { call, ctx } = connect(
      recorder(() => Promise.resolve({ files: [join(tmpdir(), 'none.mp4')] })),
    );
    await call({ action: 'start', file });
    expect((await ctx.end())[0]).toMatch(/^recording: .*not a playable video/);
  });
});
