import { describe, expect, it } from 'vitest';
import { holdsLines, prBody, took, verdictLine, verdictText } from '../src/index.js';
import { aCase, aRecord, failed } from './record-fixture.js';

const under = (path: string) => `appdyno-artifacts/${path}`;

describe('verdict.txt', () => {
  it('opens with the verdict and the counts, in one form', () => {
    const r = aRecord([aCase('a.flow'), aCase('b.flow', { outcome: 'flaky' })]);
    expect(verdictLine(r)).toBe('PASS: 1 passed, 1 flaky, 0 failed on 1 device in 6m12s');
    expect(verdictLine({ ...r, shard: { i: 2, n: 4 } })).toMatch(/ in 6m12s, shard 2\/4$/);
    expect(took(42_400)).toBe('42s');
  });

  it('has a line for each case to look at: what failed, its picture, and how to run it again', () => {
    const r = aRecord([aCase('a.flow'), failed('login.flow', { needs: ['PASSWORD'] })], {
      why: ['1 failed'],
    });
    expect(verdictText(r, under).split('\n')).toEqual([
      'FAIL: 1 passed, 0 flaky, 1 failed on 1 device in 6m12s',
      'because: 1 failed',
      'FAIL emulator-5554 login.flow line 14, step 6: no element matches {"text":"Continue"} | appdyno-artifacts/emulator-5554/login.flow/screen.png | rerun: appdyno test flows/login.flow --device emulator-5554 (set PASSWORD in the environment or an env file)',
      '',
    ]);
  });

  it('names a flaky case and a teardown that failed, and no case that passed clean', () => {
    const flaky = failed('b.flow', { outcome: 'flaky' });
    const left = aCase('c.flow', { teardown: { ok: false, failed: ['teardown line 2: left'] } });
    const text = verdictText(aRecord([aCase('a.flow'), flaky, left]), under);
    expect(text).toContain('FLAKY emulator-5554 b.flow line 14, step 6');
    expect(text).toContain('TEARDOWN FAILED emulator-5554 c.flow teardown line 2: left');
    expect(text).not.toContain('a.flow');
  });

  it('names a cleanup that failed beside the case’s own outcome, and a file not run with why', () => {
    const left = 'put back failed: dark_mode (was off): it reads on';
    const text = verdictText(
      aRecord([
        aCase('a.flow', { cleanup: [left] }),
        failed('b.flow', { cleanup: [left] }),
        aCase('c.flow', {
          outcome: 'not_run',
          attempts: [],
          why: 'a.flow was not cleaned up after',
        }),
      ]),
      under,
    );
    expect(text).toContain(`CLEANUP FAILED emulator-5554 a.flow ${left} |`);
    expect(text).toContain(
      `FAIL emulator-5554 b.flow line 14, step 6: no element matches {"text":"Continue"}; ${left} |`,
    );
    expect(text).toContain('NOT RUN emulator-5554 c.flow a.flow was not cleaned up after |');
  });

  it('stops at 30 cases, and says how many more the page has', () => {
    const many = Array.from({ length: 42 }, (_, i) => failed(`f${i}.flow`));
    const lines = verdictText(aRecord(many), under).trimEnd().split('\n');
    expect(lines).toHaveLength(32);
    expect(lines.at(-1)).toBe('and 12 more: see appdyno-artifacts/index.html');
  });
});

describe("a pull request's text", () => {
  const r = aRecord([aCase('a.flow'), failed('login|x.flow', { needs: ['PASSWORD'] })], {
    why: ['1 failed'],
  });
  const body = prBody(r);

  it('has the verdict, each case with a link inside the folder, and the commands', () => {
    expect(body).toContain('## appdyno test: FAIL');
    expect(body).toContain('[picture](emulator-5554/login|x.flow/screen.png)');
    expect(body).toContain('| FAIL | emulator-5554 | login\\|x.flow |');
    expect(body).toContain('```sh\nappdyno test flows/login|x.flow --device emulator-5554\n```');
    expect(body).toContain('set PASSWORD in the environment or an env file');
    expect(body).not.toMatch(/!\[/);
  });

  it('says what was tested and what the report holds', () => {
    expect(body).toContain('- commit: aaaaaaaaaaaa on main');
    expect(body).toContain('- device: Pixel 8 (emulator-5554), Android 15, virtual; dark_mode off');
    expect(body).toContain("1 picture: a failure's is painted over");
    expect(body).toContain('2.0 MB. Listed secrets: 2.');
  });
});

describe('what a folder holds', () => {
  it('says first that a video is not painted, and only where there is one', () => {
    const { contents } = aRecord([]);
    expect(holdsLines(contents).join('\n')).not.toContain('video');
    const lines = holdsLines({ ...contents, videos: 2, without: ['logs'] });
    expect(lines[0]).toBe(
      '2 videos, NOT painted: anything shown on screen is in them, typed passwords included',
    );
    expect(lines).toContain('left out of this copy: logs');
  });
});
