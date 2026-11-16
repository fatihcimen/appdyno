import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commentRun, mergeRuns, readRun, shareLines, ToolError, zipRun } from '../../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { flowsFor, flowHelpers } from './harness.js';

describe('runs that are already there', () => {
  let dir: string;
  let device: FakeDevice;
  const { context } = flowHelpers(
    () => device,
    () => dir,
  );
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'appdyno-share-'));
    vi.stubEnv('APPDYNO_STATE_DIR', join(dir, 'state'));
    device = new FakeDevice();
    device.screen = 'form';
    device.logLines = ['drew the form'];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  /** A part of three files, of which `b.flow` fails on the form: its folder. */
  const part = async (
    i: number,
    n: number,
    before: (artifacts: string) => void = () => undefined,
  ) => {
    const flows = join(dir, 'flows');
    mkdirSync(flows, { recursive: true });
    const files = ['a.flow', 'b.flow', 'c.flow'].map((f) => {
      const fails = f === 'b.flow' ? 'assert text="Ana sayfa" timeoutMs=200\n' : '';
      writeFileSync(join(flows, f), `app dev.app\nopen_link "app://x"\n${fails}`);
      return join(flows, f);
    });
    const artifacts = join(dir, `part-${i}`);
    before(artifacts);
    await flowsFor(context()).test({ files, devices: [], artifacts, shard: { i, n } });
    return artifacts;
  };
  const refused = (act: () => unknown) => {
    try {
      act();
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      return e as ToolError;
    }
    throw new Error('it was not refused');
  };

  describe('merged', () => {
    it("are one folder: every case, each failure's files, one verdict and one page", async () => {
      const parts = [await part(1, 2), await part(2, 2)];
      const out = join(dir, 'whole');
      const { record, page } = mergeRuns(parts, out);
      expect(record.cases.map((c) => [c.label, c.outcome])).toEqual([
        ['a.flow', 'passed'],
        ['c.flow', 'passed'],
        ['b.flow', 'failed'],
      ]);
      expect(record).toMatchObject({ verdict: 'FAIL', why: ['1 failed'] });
      expect(record.shard).toBeUndefined();
      const shot = record.cases[2]?.attempts[0]?.evidence.shot;
      expect(shot).toBe(`${device.serial}/b.flow/screen.jpg`);
      expect(existsSync(join(out, String(shot)))).toBe(true);
      expect(record.contents).toMatchObject({ shots: 1, trees: 1, logs: 1 });
      expect(page).toBe(join(out, 'index.html'));
      expect(readRun(out)).toEqual(record);
      expect(readFileSync(join(out, 'verdict.txt'), 'utf8')).toMatch(
        /^FAIL: 2 passed, 0 flaky, 1 failed on 1 device in \d+s\n/,
      );
      const xml = readFileSync(join(out, 'junit.xml'), 'utf8');
      expect(xml).toContain('<testsuites tests="3" failures="1"');
      expect(xml).toContain(`[[ATTACHMENT|${join(out, String(shot))}]]`);
    });

    it('fail where a part of the split is not among them, and say which', async () => {
      const { record } = mergeRuns([await part(1, 3), await part(3, 3)], join(dir, 'whole'));
      expect(record).toMatchObject({ verdict: 'FAIL', why: ['shard 2/3 did not run'] });
    });

    it('are refused, with nothing written, where they cannot be one run', async () => {
      const one = await part(1, 2);
      const out = join(dir, 'whole');
      const twice = refused(() => mergeRuns([one, one], out));
      expect(twice.code).toBe('INVALID_ARGUMENT');
      expect(twice.message).toContain(`a.flow on ${device.serial}`);
      expect(existsSync(out)).toBe(false);
      expect(refused(() => mergeRuns([join(dir, 'none')], out)).code).toBe('NOT_FOUND');
      writeFileSync(join(one, 'run.json'), '{"schema":2}');
      expect(refused(() => readRun(one)).message).toContain("not a run's record");
    });
  });

  describe('shared', () => {
    const video = (artifacts: string) => {
      mkdirSync(artifacts, { recursive: true });
      writeFileSync(join(artifacts, 'clip.mp4'), 'a video');
    };
    const namesIn = (zip: string) =>
      execFileSync('/usr/bin/unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
    const textIn = (zip: string, name: string) =>
      execFileSync('/usr/bin/unzip', ['-p', zip, name], { encoding: 'utf8' });

    it('say what the folder holds, a video first', async () => {
      const lines = shareLines(readRun(await part(2, 2, video)));
      expect(lines[0]).toBe('This folder holds:');
      expect(lines[1]).toMatch(/^ {2}1 video, NOT painted: /);
      expect(lines.join('\n')).toContain('1 screen tree, 1 log tail and 0 crash reports');
    });

    it('are not packed with a video until someone says whether it goes', async () => {
      const run = await part(2, 2, video);
      const zip = join(dir, 'run.zip');
      const e = refused(() => zipRun(run, zip));
      expect(e.code).toBe('INVALID_ARGUMENT');
      expect(e.message).toContain('NOT painted');
      expect(e.message).toContain('--without video');
      expect(existsSync(zip)).toBe(false);
      expect(namesIn(zipRun(run, zip, { with: 'video' }).file)).toContain('clip.mp4');
      expect(refused(() => zipRun(run, zip, { without: 'pictures' })).message).toContain(
        'video, logs, trees',
      );
    });

    it('are packed without the kinds named, and the copy says so and names no file it lacks', async () => {
      const run = await part(2, 2, video);
      const zip = join(dir, 'run.zip');
      const { contents } = zipRun(run, zip, { without: 'video,logs' });
      expect(contents).toMatchObject({ videos: 0, logs: 0, shots: 1, without: ['video', 'logs'] });
      const names = namesIn(zip);
      const kept = `${device.serial}/b.flow`;
      expect(names).toEqual(
        expect.arrayContaining(['index.html', 'run.json', `${kept}/screen.jpg`]),
      );
      expect(names).not.toContain('clip.mp4');
      expect(names).not.toContain(`${kept}/log.txt`);
      expect(textIn(zip, 'index.html')).toContain('left out of this copy: video, logs');
      expect(textIn(zip, 'index.html')).not.toContain('log.txt');
      expect(textIn(zip, 'verdict.txt')).toContain(` | ${kept}/screen.jpg | rerun: `);
      expect(textIn(zip, 'junit.xml')).toContain(`[[ATTACHMENT|${kept}/screen.jpg]]`);
      // the folder itself is as it was
      expect(existsSync(join(run, 'clip.mp4'))).toBe(true);
      expect(readRun(run).contents.without).toBeUndefined();
    });
  });

  it("writes a pull request's text again from the record", async () => {
    const run = await part(2, 2);
    const out = join(dir, 'out', 'body.md');
    expect(commentRun(run, out)).toBe(out);
    expect(readFileSync(out, 'utf8')).toBe(readFileSync(join(run, 'pr.md'), 'utf8'));
  });
});
