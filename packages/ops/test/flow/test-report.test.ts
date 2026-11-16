import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodePng, encodePng, must } from '@appdyno/core';
import { RunRecord } from '@appdyno/flows';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flowFiles, type TestOptions } from '../../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { callerOf, flowsFor, SECRET, flowHelpers } from './harness.js';

/** A device whose images are real PNGs: white, one pixel of tap units per pixel. */
class ImagingDevice extends FakeDevice {
  override screenshot(): ReturnType<FakeDevice['screenshot']> {
    const img = {
      width: 1080,
      height: 2400,
      channels: 3 as const,
      data: new Uint8Array(1080 * 2400 * 3).fill(255),
    };
    const data = encodePng(img);
    return Promise.resolve({ meta: { w: 1080, h: 2400, format: 'png', bytes: data.length }, data });
  }
}

const WHO = 'ayse-4411';

describe("a test run's report", () => {
  let dir: string;
  let device: FakeDevice;
  const { context, refusal } = flowHelpers(
    () => device,
    () => dir,
  );
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'appdyno-run-'));
    vi.stubEnv('APPDYNO_STATE_DIR', join(dir, 'state'));
    device = new ImagingDevice();
    device.screen = 'login';
    device.logLines = [`signed in with ${SECRET}`, 'drew the list'];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  /** A file that passes and one that fails on a screen holding a secret, as a job would run them. */
  const run = async (o: Partial<TestOptions> = {}) => {
    const tests = mkdtempSync(join(dir, 'tests-'));
    writeFileSync(join(tests, 'a-good.flow'), 'app dev.app\nopen_link "app://x"\n');
    writeFileSync(
      join(tests, 'b-bad.flow'),
      'app dev.app\nsecret CODE\nparam WHO\nassert id=none check=text equals="${CODE} ${WHO}" timeoutMs=300\n',
    );
    const artifacts = join(dir, 'artifacts');
    const bad = join(tests, 'b-bad.flow');
    const r = await flowsFor(context()).test({
      files: flowFiles([tests]),
      devices: [],
      artifacts,
      params: { CODE: SECRET, WHO },
      command: ['appdyno', 'test', tests, '--param', 'CODE', '--param', 'WHO'],
      ...o,
    });
    const read = (name: string) => readFileSync(join(artifacts, name), 'utf8');
    return { ...r, artifacts, bad, read, kept: `${device.serial}/b-bad.flow` };
  };

  it('keeps one record of the run, which says what failed and how to run it alone', async () => {
    const { read, bad, kept, record } = await run();
    const r = RunRecord.parse(JSON.parse(read('run.json')));
    expect(r).toEqual(record);
    expect(r).toMatchObject({ verdict: 'FAIL', why: ['1 failed'], tool: { version: 'unknown' } });
    expect(r.devices).toMatchObject([{ serial: device.serial, virtual: true }]);
    expect(r.cases.map((c) => [c.label, c.outcome])).toEqual([
      ['a-good.flow', 'passed'],
      ['b-bad.flow', 'failed'],
    ]);
    const failed = must(r.cases[1], 'the failed case');
    expect(failed.rerun).toBe(`appdyno test ${bad} --device ${device.serial}`);
    expect(failed.needs).toEqual(['CODE', 'WHO']);
    expect(failed.app).toMatchObject({ id: 'dev.app' });
    expect(failed.attempts[0]).toMatchObject({
      outcome: 'failed',
      failure: { line: 4, n: 1 },
      evidence: {
        shot: `${kept}/screen.png`,
        tree: `${kept}/tree.json`,
        log: `${kept}/log.txt`,
      },
    });
    expect(r.contents).toMatchObject({ shots: 1, painted: 1, trees: 1, logs: 1, videos: 0 });
  });

  it('holds no secret in any file it writes, and no value of a param in a command', async () => {
    const { read, record, kept } = await run();
    for (const name of ['run.json', 'verdict.txt', 'index.html', 'pr.md', 'junit.xml'])
      expect(read(name), name).not.toContain(SECRET);
    expect(read(`${kept}/log.txt`)).toBe('signed in with •••\ndrew the list\n');
    expect(JSON.stringify([record.command, record.cases.map((c) => c.rerun)])).not.toContain(WHO);
  });

  it("paints the failure's picture over a password field and an element holding a secret", async () => {
    const { artifacts, kept } = await run();
    const img = must(decodePng(readFileSync(join(artifacts, kept, 'screen.png'))), 'its image');
    const red = (x: number, y: number) => img.data[(y * img.width + x) * img.channels];
    expect(red(540, 950)).toBe(0); // the greeting holding the secret
    expect(red(540, 350)).toBe(0); // the password field
    expect(red(540, 150)).toBe(255); // a field holding neither
  });

  it("keeps the app's crash reports beside the failure, a secret hidden in them", async () => {
    device.crashReports = [
      { at: '2026-11-16 10:15:02', reason: `SIGABRT after ${SECRET}`, detail: 'main + 12' },
    ];
    const { read, record, kept } = await run();
    expect(record.cases[1]?.attempts[0]?.evidence.crash).toBe(`${kept}/crash.txt`);
    expect(read(`${kept}/crash.txt`)).toBe('2026-11-16 10:15:02 SIGABRT after •••\nmain + 12');
    expect(record.contents.crashes).toBe(1);
    expect(read('index.html')).toContain(`<a href="${kept}/crash.txt">its crash reports</a>`);
  });

  it('keeps no picture it could not paint over', async () => {
    device = new FakeDevice();
    device.screen = 'login';
    const { artifacts, kept, record } = await run();
    expect(existsSync(join(artifacts, kept, 'tree.json'))).toBe(true);
    expect(record.cases[1]?.attempts[0]?.evidence.shot).toBeUndefined();
    expect(record.contents.shots).toBe(0);
  });

  it('writes the verdict first, then each case to look at', async () => {
    const { read, bad, artifacts, kept } = await run();
    const [first, why, line] = read('verdict.txt').split('\n');
    expect(first).toMatch(/^FAIL: 1 passed, 0 flaky, 1 failed on 1 device in \d+s$/);
    expect(why).toBe('because: 1 failed');
    expect(line).toMatch(/^FAIL emulator-5580 b-bad\.flow line 4, step 1: /);
    expect(line).toContain(
      ` | ${join(artifacts, kept, 'screen.png')} | rerun: appdyno test ${bad} `,
    );
  });

  it('writes one page that loads nothing but the files beside it', async () => {
    const { read, kept, lines } = await run().then((r) => ({ ...r, lines: r.page }));
    const page = read('index.html');
    expect(lines).toBe(join(dir, 'artifacts', 'index.html'));
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain("default-src 'none'; img-src 'self' file:");
    expect(page).not.toContain('<script');
    expect(page).toContain('<p class="verdict fail">FAIL</p>');
    expect(page).toContain(`<img alt="the screen at the failure" src="${kept}/screen.png">`);
    expect(page).toContain('To run it alone, set CODE, WHO in the environment or an env file');
    expect(page).toContain('What this folder holds');
    expect(page).toContain('Passed (1)');
    expect(page).not.toContain('NOT painted');
  });

  it('attaches the picture in JUnit by a path a job finds it by, and writes the pull request text', async () => {
    const { read, artifacts, kept } = await run({ prBody: join(dir, 'out', 'body.md') });
    const xml = read('junit.xml');
    const shot = join(artifacts, kept, 'screen.png');
    expect(xml).toContain(`<property name="attachment" value="${shot}"/>`);
    expect(xml).toContain(`[[ATTACHMENT|${shot}]]\n`);
    expect(xml).toContain('<property name="appdyno.rerun" value="appdyno test ');
    expect(existsSync(join(artifacts, 'pr.md'))).toBe(false);
    const body = readFileSync(join(dir, 'out', 'body.md'), 'utf8');
    expect(body).toContain('## appdyno test: FAIL');
    expect(body).toContain(`[picture](${kept}/screen.png)`);
  });

  describe('asked for by a tool call', () => {
    const flows = () => {
      const tests = mkdtempSync(join(dir, 'tests-'));
      writeFileSync(join(tests, 'a-good.flow'), 'app dev.app\ntag smoke\nopen_link "app://x"\n');
      writeFileSync(
        join(tests, 'b-bad.flow'),
        'app dev.app\nassert text="Ana sayfa" timeoutMs=200\n',
      );
      return tests;
    };

    it('answers with the verdict and each failure, and fails no call for a run that failed', async () => {
      const call = callerOf(context());
      const to = join(dir, 'artifacts', 'run');
      const r = await call('run_flow', { action: 'test', file: flows(), to });
      const [first, , line] = r.text.split('\n');
      expect(first).toMatch(/^FAIL: 1 passed, 0 flaky, 1 failed on 1 device in \d+s$/);
      expect(line).toMatch(
        /^FAIL emulator-5580 b-bad\.flow line 2, step 1: .* \| rerun: appdyno test /,
      );
      expect(r.data).toMatchObject({
        done: 'FAIL',
        verdict: 'FAIL',
        failed: ['b-bad.flow'],
        record: join(to, 'run.json'),
        page: join(to, 'index.html'),
      });
      expect(
        RunRecord.parse(JSON.parse(readFileSync(join(to, 'run.json'), 'utf8'))).command,
      ).toEqual(['run_flow', 'test', expect.any(String)]);
    });

    it('runs the files its tags select, and writes nowhere this server may not', async () => {
      const call = callerOf(context());
      const file = flows();
      const to = join(dir, 'artifacts', 'smoke');
      const r = await call('run_flow', { action: 'test', file, to, tags: ['smoke'] });
      expect(r.data).toMatchObject({ verdict: 'PASS', failed: [] });
      const outside = await refusal(
        call('run_flow', { action: 'test', file, to: join(dir, 'elsewhere') }),
      );
      expect(outside.code).toBe('POLICY_DENIED');
      expect(existsSync(join(dir, 'elsewhere'))).toBe(false);
      expect((await refusal(call('run_flow', { action: 'test' }))).message).toContain('needs file');
    });
  });

  it('writes the record and JUnit alone where no report is wanted', async () => {
    const { artifacts } = await run({ report: false });
    const has = (name: string) => existsSync(join(artifacts, name));
    expect([has('run.json'), has('junit.xml')]).toEqual([true, true]);
    expect([has('verdict.txt'), has('index.html'), has('pr.md')]).toEqual([false, false, false]);
  });
});
