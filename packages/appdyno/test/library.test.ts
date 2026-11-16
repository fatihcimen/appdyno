import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { must } from '@appdyno/core';
import { DeviceError, type ErrorCode } from '@appdyno/protocol';
import * as library from '../src/index.js';
import { drive } from '../examples/drive.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';

const device = new FakeDevice();

vi.mock('../src/providers.js', () => ({
  deviceProviders: () => [
    {
      list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
      handles: () => true,
      open: () => device,
    },
  ],
}));

describe('the library', () => {
  it('has every code of a refusal in its own types, as the protocol has them', () => {
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const same: Same<library.ErrorCode, ErrorCode> = true;
    expect(same).toBe(true);
  });

  it('runs the example the docs show', async () => {
    const flow = join(mkdtempSync(join(tmpdir(), 'appdyno-library-')), 'a.flow');
    writeFileSync(flow, 'assert text="Bilgiler"\n');
    const lines: string[] = [];
    await expect(drive(flow, (l) => lines.push(l))).resolves.toBe(true);
    expect(lines[0]).toContain('tapped');
    expect(lines[1]).toMatch(/^assert text="Bilgiler": \d+ ms$/);
    expect(lines[2]).toMatch(/^NOT_FOUND: /);
    const shown = readFileSync(
      new URL('../../../docs/reference/library.md', import.meta.url),
      'utf8',
    );
    const example = readFileSync(new URL('../examples/drive.ts', import.meta.url), 'utf8');
    expect(shown).toContain(example.trim());
  });

  it('refuses an allowDevices that is no regular expression, saying what it takes', () => {
    // plain JavaScript can give anything: a string failed every call with a TypeError
    expect(() => library.connect({ allowDevices: '^emulator-' as never })).toThrow(
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        message: 'allowDevices takes a regular expression, as /^emulator-/, not a string',
      }),
    );
    expect(() => library.connect({ allowDevices: /^emulator-/ })).not.toThrow();
  });

  it('is refused a device another process holds, and drives it beside that process when it shares', async () => {
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    const pid = must(other.pid, "the other process's pid");
    const claims = join(must(process.env.APPDYNO_STATE_DIR, 'APPDYNO_STATE_DIR'), 'claims');
    const claim = join(claims, `${device.serial}.json`);
    try {
      const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
      }).trim();
      mkdirSync(claims, { recursive: true });
      const held = JSON.stringify({
        pid,
        started,
        tool: 'appdyno mcp',
        since: '2026-11-15T00:00:00Z',
      });
      writeFileSync(claim, held);

      const alone = library.connect();
      await expect(alone.tool('read_screen', {})).rejects.toMatchObject({
        code: 'DEVICE_CLAIMED',
        message: expect.stringContaining(`pid ${pid}`) as unknown,
        hint: expect.stringContaining('share: true in the options') as unknown,
      });
      await alone.close();

      const beside = library.connect({ share: true });
      expect((await beside.tool('read_screen', {})).data.elements).toBeGreaterThan(0);
      await beside.close();
      // the other's hold stands: sharing takes nothing from it
      expect(readFileSync(claim, 'utf8')).toBe(held);

      vi.stubEnv('APPDYNO_SHARE', '1');
      const byEnv = library.connect();
      expect((await byEnv.tool('read_screen', {})).data.elements).toBeGreaterThan(0);
      await byEnv.close();
    } finally {
      vi.unstubAllEnvs();
      other.kill('SIGKILL');
      // a killed process is listed for a moment more: its hold would refuse the tests after this one
      rmSync(claim, { force: true });
    }
  });

  it('stops a long call by its signal, and takes the next one', async () => {
    device.screen = 'home';
    const d = library.connect();
    const stop = new AbortController();
    const started = Date.now();
    const waiting = d.tool(
      'check_element',
      { selector: { text: 'Never on this screen' }, timeoutMs: 15_000 },
      { signal: stop.signal },
    );
    setTimeout(() => stop.abort(), 100);
    await expect(waiting).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect((await d.tool('read_screen', {})).data.elements).toBeGreaterThan(0);
    await d.close();
  });

  it('says of a stopped action whether its touch went out', async () => {
    device.screen = 'home';
    const d = library.connect();
    const act = device.act.bind(device);
    const acts = () => device.calls.filter((c) => c.name === 'act').length;
    const tap = (signal: AbortSignal) =>
      d.tool('tap_screen', { selector: { text: 'Form' } }, { signal }).then(
        () => undefined,
        (e: unknown) => e as library.Refusal,
      );
    try {
      await d.tool('read_screen', {});
      const before = acts();
      // stopped before it began, and while it waited for the action before it: nothing left for the device
      expect(await tap(AbortSignal.abort())).toMatchObject({
        code: 'CANCELLED',
        dispatched: false,
      });
      device.act = async (a, o) => {
        await new Promise((r) => setTimeout(r, 200));
        return act(a, o);
      };
      const first = d.tool('press_key', { key: 'tab' });
      const gaveUp = new AbortController();
      const second = tap(gaveUp.signal);
      gaveUp.abort();
      await first;
      expect(await second).toMatchObject({ code: 'CANCELLED', dispatched: false });
      expect(acts()).toBe(before + 1);

      // stopped once the action had left: the device may have made the touch
      const sent = new AbortController();
      device.act = () =>
        new Promise((_, reject) => {
          const gone = Object.assign(new DeviceError('CANCELLED', 'act: cancelled by the client'), {
            sent: true,
          });
          sent.signal.addEventListener('abort', () => reject(gone));
          setTimeout(() => sent.abort(), 50);
        });
      const stopped = await tap(sent.signal);
      expect(stopped).toMatchObject({ code: 'CANCELLED', dispatched: 'unknown' });
      expect(stopped?.message).toContain('the touch may have been sent');
    } finally {
      device.act = act;
      await d.close();
    }
  });

  it('says a touch may have gone out where its call was stopped while the app it watches was acting', async () => {
    device.screen = 'home';
    // with an app in front, an action is watched for the app's end while it runs
    const d = library.connect({ app: 'dev.app' });
    const act = device.act.bind(device);
    try {
      await d.tool('read_screen', {});
      // the touch is made at once, and the device answers later
      device.act = async (a, o) => {
        const done = await act(a, o);
        await new Promise((r) => setTimeout(r, 600));
        return done;
      };
      const stop = new AbortController();
      setTimeout(() => stop.abort(), 100);
      const stopped = await d
        .tool('tap_screen', { selector: { text: 'Form' } }, { signal: stop.signal })
        .then(
          () => undefined,
          (e: unknown) => e as library.Refusal,
        );
      expect(stopped).toMatchObject({ code: 'CANCELLED', dispatched: 'unknown' });
      expect(stopped?.message).toContain('the touch may have been sent');
    } finally {
      device.act = act;
      await d.close();
    }
  });

  it('stops a replay between its steps, and says a step was done', async () => {
    device.screen = 'home';
    const flow = join(mkdtempSync(join(tmpdir(), 'appdyno-library-')), 'stop.flow');
    writeFileSync(flow, 'tap text="Form"\nassert text="Bilgiler"\n');
    const d = library.connect();
    try {
      await expect(d.replay(flow, { signal: AbortSignal.abort() })).rejects.toMatchObject({
        code: 'CANCELLED',
        dispatched: false,
      });
      const stop = new AbortController();
      const steps: string[] = [];
      await expect(
        d.replay(flow, {
          signal: stop.signal,
          onStep: (e) => {
            steps.push(`${e.phase} ${e.n}`);
            if (e.phase === 'after') stop.abort();
          },
        }),
      ).rejects.toMatchObject({ code: 'CANCELLED', dispatched: true });
      expect(steps).toEqual(['before 1', 'after 1']);
      // with a signal that never stops it, a run is what it is without one
      const whole = await d.replay(flow, { signal: new AbortController().signal, from: 2 });
      expect(whole).toMatchObject({ passed: true, steps: [{ n: 2 }] });
    } finally {
      await d.close();
    }
  });

  it("gives what a flow's setup and teardown did, each step typed, beside its own steps", async () => {
    device.screen = 'home';
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-library-'));
    writeFileSync(join(dir, '_setup.flow'), 'assert text="Form"\n');
    writeFileSync(
      join(dir, '_teardown.flow'),
      'assert text="Form" timeoutMs=300\nassert text="Ana sayfa" timeoutMs=300\n',
    );
    const flow = join(dir, 'a.flow');
    writeFileSync(flow, 'tap text="Form"\n');
    const d = library.connect();
    try {
      const run: library.ReplayResult = await d.replay(flow);
      const lines = (steps: library.ReplayStep[] = []) => steps.map((s) => `${s.n} ${s.step}`);
      expect(lines(run.setup)).toEqual(['1 assert text="Form"']);
      expect(lines(run.steps)).toEqual(['1 tap text="Form"']);
      // neither text is on the form: both of the teardown's steps ran, and each failed
      expect(run.teardown?.ok).toBe(false);
      expect(lines(run.teardown?.steps)).toEqual([]);
      const failed: library.ReplayFailure[] = run.teardown?.failed ?? [];
      expect(failed.map((f) => [f.n, f.phase])).toEqual([
        [1, 'teardown'],
        [2, 'teardown'],
      ]);
      // its own steps passed, and it is no pass: the next run would start from what the teardown left
      expect(run).toMatchObject({ passed: false, teardownFailed: true });
      expect(run.failure).toBeUndefined();
      device.screen = 'home';
      const stoppable = await d.replay(flow, { signal: new AbortController().signal });
      expect(stoppable).toMatchObject({ passed: false, teardownFailed: true });
      // a teardown that cleans up leaves a pass a pass, and says nothing more
      writeFileSync(join(dir, '_teardown.flow'), 'assert text="Bilgiler"\n');
      device.screen = 'home';
      const clean = await d.replay(flow);
      expect(clean).toMatchObject({ passed: true, teardown: { ok: true, failed: [] } });
      expect('teardownFailed' in clean).toBe(false);
      // a failed step stays the failure, with the teardown's beside it
      writeFileSync(flow, 'assert text="Yok" timeoutMs=300\n');
      writeFileSync(join(dir, '_teardown.flow'), 'assert text="Yok" timeoutMs=300\n');
      device.screen = 'home';
      const both = await d.replay(flow);
      expect(both).toMatchObject({ passed: false, teardownFailed: true, failure: { n: 1 } });
      expect(both.failure?.phase).toBeUndefined();
    } finally {
      await d.close();
    }
  });

  it('gives the tree of the screen an action left, from the read its answer made', async () => {
    device.screen = 'home';
    const d = library.connect();
    const reads = () => device.calls.filter((c) => c.name === 'tree').length;
    try {
      await d.tool('read_screen', {});
      const start = reads();
      expect((await d.tool('tap_screen', { selector: { text: 'Form' } })).nodes).toBeUndefined();
      const plain = reads() - start;
      device.screen = 'home';
      await d.tool('read_screen', {});
      const before = reads();
      const tapped = await d.tool('tap_screen', { selector: { text: 'Form' } }, { raw: true });
      // the reads a tap makes of itself, and no other for the tree
      expect(reads() - before).toBe(plain);
      const nodes = tapped.nodes ?? [];
      expect(nodes.length).toBeGreaterThan(Number(tapped.data.elements));
      expect(nodes.some((n) => n.ref && n.rect && n.parent !== undefined)).toBe(true);
      // what `screen` with `raw` gives of the same screen, cleaned the same way
      expect(nodes).toEqual((await d.tool('read_screen', { raw: true })).data.nodes);

      // an action that reads nothing leaves the tree to a read of its own
      const settled = reads();
      const unread = await d.tool('press_key', { key: 'tab', read: 'none' }, { raw: true });
      expect(reads() - settled).toBe(1);
      expect(unread.nodes?.length).toBe(nodes.length);
    } finally {
      await d.close();
    }
  });

  it('has one name to call, and the rest are types', () => {
    expect(Object.keys(library)).toEqual(['connect']);
  });
});
