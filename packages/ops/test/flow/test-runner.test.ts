import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, type DeviceProvider } from '@appdyno/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, flowFiles, flowsTagged, ServerContext } from '../../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { callerOf, flowsFor, SECRET, flowHelpers } from './harness.js';

describe('flows', () => {
  let dir: string;
  let device: FakeDevice;
  const { context, refusal } = flowHelpers(
    () => device,
    () => dir,
  );
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'appdyno-flow-'));
    vi.stubEnv('APPDYNO_STATE_DIR', join(dir, 'state'));
    device = new FakeDevice();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('export', () => {
    it('gives Maestro YAML with no device, and refuses a step it has no form for', async () => {
      const ctx = new ServerContext(DEFAULT_POLICY, []);
      const call = callerOf(ctx);
      const ok = join(dir, 'ok.flow');
      writeFileSync(ok, 'app dev.app\nlaunch\ntap id=x\n');
      expect((await call('flow', { action: 'export', file: ok })).text).toContain('tapOn:');
      const no = join(dir, 'no.flow');
      writeFileSync(no, 'app dev.app\nlaunch\nalert allow\n');
      const e = await refusal(call('flow', { action: 'export', file: no }));
      expect(e.message).toContain('step 2');
    });

    it('writes the YAML inside the state or project folder, and refuses a path elsewhere', async () => {
      const call = callerOf(new ServerContext(DEFAULT_POLICY, []));
      const file = join(dir, 'ok.flow');
      writeFileSync(file, 'app dev.app\nlaunch\ntap id=x\n');
      const to = join(dir, 'state', 'flows', 'list.yaml');
      const out = await call('flow', { action: 'export', file, to });
      expect(out.data.file).toBe(to);
      expect(out.text).toBe(`${readFileSync(to, 'utf8')}\nwritten to ${to}`);
      expect(out.text).toContain('tapOn:');
      expect((await refusal(call('flow', { action: 'export', file, to }))).message).toContain(
        'exists',
      );
      await call('flow', { action: 'export', file, to, overwrite: true });
      const outside = await refusal(
        call('flow', { action: 'export', file, to: join(dir, 'list.yaml') }),
      );
      expect(outside.code).toBe('POLICY_DENIED');
      expect(existsSync(join(dir, 'list.yaml'))).toBe(false);
      symlinkSync(dir, join(dir, 'state', 'out'));
      const linked = await refusal(
        call('flow', { action: 'export', file, to: join(dir, 'state', 'out', 'list.yaml') }),
      );
      expect(linked.code).toBe('POLICY_DENIED');
      const named = refusal(call('flow', { action: 'export', file, to: join(dir, 'state', 'a') }));
      expect((await named).message).toContain('.yaml');
    });
  });

  describe('the test runner', () => {
    it('finds flows in a directory in order; finding none is a failure', () => {
      expect(() => flowFiles([join(dir, 'none')])).toThrow(/no such file/);
      expect(() => flowFiles([dir])).toThrow(/no .flow files/);
      const tests = mkdtempSync(join(dir, 'tests-'));
      for (const f of ['b.flow', 'a.flow', 'c.txt']) writeFileSync(join(tests, f), 'launch\n');
      expect(flowFiles([tests])).toEqual([join(tests, 'a.flow'), join(tests, 'b.flow')]);
    });

    it('selects files by their tags, and a broken file stays to fail', () => {
      const tests = mkdtempSync(join(dir, 'tests-'));
      const file = (name: string, text: string) => {
        writeFileSync(join(tests, name), text);
        return join(tests, name);
      };
      const smoke = file('a.flow', 'tag smoke login\nlaunch\n');
      const slow = file('b.flow', 'tag smoke slow\nlaunch\n');
      const plain = file('c.flow', 'launch\n');
      const broken = file('d.flow', 'fly\n');
      const files = [smoke, slow, plain, broken];
      expect(flowsTagged(files)).toEqual(files);
      expect(flowsTagged(files, ['login'])).toEqual([smoke, broken]);
      expect(flowsTagged(files, ['login', 'slow'])).toEqual([smoke, slow, broken]);
      expect(flowsTagged(files, [], ['slow'])).toEqual([smoke, plain, broken]);
      expect(flowsTagged(files, ['smoke'], ['slow'])).toEqual([smoke, broken]);
      expect(() => flowsTagged([smoke, slow], ['none'], ['slow'])).toThrow(
        'no flow of 2 is selected by --tag none --exclude-tag slow',
      );
    });

    it('runs every file, writes JUnit, and keeps a failure’s screenshot and tree', async () => {
      const tests = mkdtempSync(join(dir, 'tests-'));
      writeFileSync(join(tests, 'a-good.flow'), 'app dev.app\nlaunch\nassert text="Ana sayfa"\n');
      writeFileSync(
        join(tests, 'b-bad.flow'),
        'app dev.app\nsecret CODE\nlaunch\nassert id=none check=text equals="${CODE}" timeoutMs=300\n',
      );
      writeFileSync(join(tests, 'c-broken.flow'), 'fly\n');
      writeFileSync(join(tests, 'd-good.flow'), 'app dev.app\nlaunch\n');
      const artifacts = join(dir, 'artifacts');
      const junit = join(artifacts, 'junit.xml');
      const lines: string[] = [];
      const r = await flowsFor(context()).test({
        files: flowFiles([tests]),
        devices: ['emulator-5580'],
        artifacts,
        junit,
        params: { CODE: 'sifre-1' },
        log: (l) => lines.push(l),
      });
      expect(r.passed).toBe(false);
      expect(r.suites[0]?.cases.map((c) => [c.name, !!c.failure])).toEqual([
        ['a-good.flow', false],
        ['b-bad.flow', true],
        ['c-broken.flow', true],
        ['d-good.flow', false],
      ]);
      const xml = readFileSync(junit, 'utf8');
      expect(xml).toContain('<testsuites tests="4" failures="2"');
      expect(xml).toContain('<testsuite name="emulator-5580"');
      expect(xml).toContain('message="line 4, step 2:');
      expect(xml).toContain('settled in');
      expect(xml).not.toContain('sifre-1');
      const kept = join(artifacts, 'emulator-5580', 'b-bad.flow');
      expect(existsSync(join(kept, 'screen.jpg'))).toBe(true);
      const tree = readFileSync(join(kept, 'tree.json'), 'utf8');
      expect(JSON.parse(tree)).toHaveProperty('nodes');
      expect(lines.join('\n')).toContain('FAIL b-bad.flow');
      expect(lines.join('\n')).toContain('ok   d-good.flow');
    });

    it('hides a secret typed on the screen in the saved tree', async () => {
      const tests = mkdtempSync(join(dir, 'tests-'));
      device.screen = 'login';
      writeFileSync(
        join(tests, 'echo.flow'),
        'app dev.app\nsecret CODE\nassert id=none check=text equals="${CODE}" timeoutMs=300\n',
      );
      const artifacts = join(dir, 'artifacts');
      await flowsFor(context()).test({
        files: flowFiles([tests]),
        devices: [],
        artifacts,
        junit: join(artifacts, 'j.xml'),
        params: { CODE: SECRET },
      });
      const tree = readFileSync(join(artifacts, device.serial, 'echo.flow', 'tree.json'), 'utf8');
      expect(tree).not.toContain(SECRET);
      expect(tree).toContain('Merhaba •••');
      expect(readFileSync(join(artifacts, 'j.xml'), 'utf8')).not.toContain(SECRET);
    });

    describe('a retry', () => {
      const flow = 'app dev.app\nopen_link "app://x"\nassert text="Ana sayfa" timeoutMs=200\n';
      /** The test run of one file, on a screen that fails it, with `onRetry` as a retry begins. */
      const run = async (text: string, retries: number, onRetry: () => void = () => undefined) => {
        const tests = mkdtempSync(join(dir, 'tests-'));
        writeFileSync(join(tests, 'a.flow'), text);
        const artifacts = join(dir, 'artifacts');
        const lines: string[] = [];
        device.screen = 'form';
        const r = await flowsFor(context()).test({
          files: flowFiles([tests]),
          devices: [],
          artifacts,
          junit: join(artifacts, 'j.xml'),
          retries,
          log: (l) => {
            lines.push(l);
            if (l.includes('retry')) onRetry();
          },
        });
        return {
          ...r,
          lines,
          kept: join(artifacts, device.serial, 'a.flow'),
          xml: readFileSync(join(artifacts, 'j.xml'), 'utf8'),
        };
      };
      const firstSteps = () => device.calls.filter((c) => c.name === 'openUrl').length;

      it('calls a file that passed only on a retry flaky, never a plain pass', async () => {
        const r = await run(flow, 2, () => (device.screen = 'home'));
        expect(r.passed).toBe(true);
        expect(r.flaky).toEqual([`${device.serial}/a.flow`]);
        expect(r.xml).toContain('failures="0" errors="0" flakes="1"');
        expect(r.xml).toMatch(
          /<flakyFailure message="line 3, step 2: .+" type="flow"><stackTrace>/,
        );
        expect(r.xml).toContain('flaky: passed on attempt 2 of 3');
        expect(r.xml.indexOf('</flakyFailure>')).toBeLessThan(r.xml.indexOf('<system-out>'));
        expect(r.xml).not.toContain('rerunFailure');
        const said = r.lines.join('\n');
        expect(said).toContain('FLAKY a.flow: passed on attempt 2 of 3');
        expect(said).toContain('0 passed, 1 flaky, 0 failed');
        expect(said).toContain('flaky, passed only on a retry');
        expect(said).not.toContain('ok   a.flow');
        // what failed stays, and a passing retry leaves nothing over it
        expect(existsSync(join(r.kept, 'screen.jpg'))).toBe(true);
        expect(existsSync(join(r.kept, 'attempt-2'))).toBe(false);
      });

      it('starts the file over at its first step: a failed step never passes within a run', async () => {
        const r = await run(flow, 1, () => (device.screen = 'home'));
        expect(r.flaky).toHaveLength(1);
        expect(firstSteps()).toBe(2);
      });

      it('fails a file that fails every attempt, with each one in the report', async () => {
        const r = await run(flow, 2);
        expect(r.passed).toBe(false);
        expect(r.flaky).toEqual([]);
        expect(firstSteps()).toBe(3);
        expect(r.xml).toContain('failures="1" errors="0" flakes="0"');
        expect(r.xml.match(/<rerunFailure /g)).toHaveLength(2);
        expect(r.xml).not.toContain('flakyFailure');
        for (const f of [r.kept, join(r.kept, 'attempt-2'), join(r.kept, 'attempt-3')])
          expect(existsSync(join(f, 'screen.jpg'))).toBe(true);
      });

      it('leaves a run with no retries as it was', async () => {
        const r = await run(flow, 0);
        expect(firstSteps()).toBe(1);
        expect(r.lines.at(-1)).toBe('0 passed, 0 flaky, 1 failed');
        expect(r.lines.join('\n')).not.toContain('retry');
        expect(r.xml).not.toContain('rerunFailure');
      });

      it('does not run again what cannot end otherwise', async () => {
        const r = await run('fly\n', 3);
        expect(r.passed).toBe(false);
        expect(r.lines.join('\n')).not.toContain('retry');
      });

      it('refuses to retry a measured flow', async () => {
        const o = { files: [], devices: [], artifacts: dir, junit: join(dir, 'j.xml') };
        const test = flowsFor(context()).test({ ...o, retries: 1, iterations: 5 });
        expect((await refusal(test)).code).toBe('INVALID_ARGUMENT');
      });
    });

    it('runs on each device in turn, and a device that will not open fails its files alone', async () => {
      const tests = mkdtempSync(join(dir, 'tests-'));
      writeFileSync(join(tests, 'a.flow'), 'app dev.app\nlaunch\n');
      const devices = new Map([
        ['one', new FakeDevice('one')],
        ['two', new FakeDevice('two')],
      ]);
      const provider: DeviceProvider = {
        list: () =>
          Promise.resolve(
            [...devices.keys()].map((serial) => ({ serial, state: 'device', ready: true })),
          ),
        handles: (serial) => devices.has(serial),
        open: (serial) => must(devices.get(serial), serial),
      };
      const ctx = new ServerContext(DEFAULT_POLICY, [provider]);
      const artifacts = join(dir, 'artifacts');
      const r = await flowsFor(ctx).test({
        files: flowFiles([tests]),
        devices: ['one', 'gone', 'two'],
        artifacts,
        junit: join(artifacts, 'j.xml'),
      });
      expect(
        r.suites.map((s) => [s.name, must(s.cases[0], 'its case').failure === undefined]),
      ).toEqual([
        ['one', true],
        ['gone', false],
        ['two', true],
      ]);
      for (const d of devices.values()) expect(d.calls.some((c) => c.name === 'launch')).toBe(true);
    });
  });
});
