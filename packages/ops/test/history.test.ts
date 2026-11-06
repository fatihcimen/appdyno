import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recordsOf, saveRun } from '@appdyno/perf';
import { spokenDone } from '../src/mirror/follow.js';
import { measureHistory } from '../src/mirror/history.js';

const phone = {
  serial: 'R58M' as string,
  platform: 'android' as const,
  model: 'SM',
  os: '16',
  virtual: false,
};
const NOW = Date.parse('2026-11-05T12:00:00Z');
const dirs: string[] = [];

const dir = () => {
  const made = mkdtempSync(join(tmpdir(), 'appdyno-history-'));
  dirs.push(made);
  return made;
};

const run = (
  name: string,
  at: string,
  samples: number[],
  device = phone,
  context: Partial<Parameters<typeof recordsOf>[0]> = {},
) =>
  recordsOf(
    {
      run: name,
      app: 'dev.app',
      scenario: 'launch-cold',
      source: '',
      raw: '',
      device,
      build: 'release',
      load: { host: [1, 1, 1], hostCpus: 10 },
      tool: '',
      at,
      ...context,
    },
    [{ kind: 'launch.ttid_ms', unit: 'ms', samples }],
  );

const steady = [400, 402, 398, 401, 399];
const slow = [950, 955, 948, 952, 951];
const fourDays = async (d: string) => {
  for (const [i, day] of ['01', '02', '03', '04'].entries())
    await saveRun(d, run(`r${i}`, `2026-11-${day}T10:00:00Z`, steady));
};
const late = '2026-11-05T11:00:00Z';

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('what a window says of past measures', () => {
  it('has nothing to say of an app never measured', async () => {
    expect(await measureHistory(dir(), 'dev.app', phone.serial, NOW)).toEqual([]);
  });

  it('says a first number as a number, with when', async () => {
    const d = dir();
    await saveRun(d, run('a', '2026-11-05T10:00:00Z', steady));
    const [line] = await measureHistory(d, 'dev.app', phone.serial, NOW);
    expect(line).toMatchObject({ title: 'Cold launch', value: '400 ms', flagged: false });
    expect(line?.detail).toBe('2 hours ago');
  });

  it('calls a regression what the gate would, newest first, in words', async () => {
    const d = dir();
    for (const [i, day] of ['01', '02', '03', '04'].entries())
      await saveRun(d, run(`r${i}`, `2026-11-${day}T10:00:00Z`, steady));
    await saveRun(d, run('late', '2026-11-05T11:00:00Z', [950, 955, 948, 952, 951]));
    const lines = await measureHistory(d, 'dev.app', phone.serial, NOW);
    expect(lines[0]).toMatchObject({ verdict: 'regression', flagged: true });
    expect(lines[0]?.title).toMatch(/^Regression \+55\d ms$/);
    expect(lines[0]?.detail).toBe('Cold launch 951 ms · 1 hour ago');
    expect(lines[1]?.title).toBe('Cold launch');
  });

  it('will not call what has too few samples', async () => {
    const d = dir();
    for (const [i, day] of ['01', '02', '03', '04'].entries())
      await saveRun(d, run(`r${i}`, `2026-11-${day}T10:00:00Z`, steady));
    await saveRun(d, run('few', '2026-11-05T11:00:00Z', [950, 955, 948]));
    const [line] = await measureHistory(d, 'dev.app', phone.serial, NOW);
    expect(line).toMatchObject({ title: 'Could not judge: 3 of 5 samples', flagged: true });
    expect(line?.verdict).toBeUndefined();
  });

  it('leaves a run under load out of what later runs are judged by, as the gate does', async () => {
    const d = dir();
    await saveRun(
      d,
      run('hot', '2026-10-31T10:00:00Z', steady, phone, {
        load: { host: [1, 1, 1], hostCpus: 10 },
        thermal: 3,
      }),
    );
    await fourDays(d);
    await saveRun(d, run('late', late, slow));
    const [line] = await measureHistory(d, 'dev.app', phone.serial, NOW);
    expect(line).toMatchObject({ verdict: 'regression', flagged: true });
    expect(line?.title).toMatch(/^Regression \+55\d ms$/);
  });

  it('judges a run by the runs of its own build alone, an earlier debug build or not', async () => {
    const d = dir();
    await saveRun(d, run('debug', '2026-10-31T10:00:00Z', steady, phone, { build: 'debug' }));
    await fourDays(d);
    await saveRun(d, run('late', late, slow));
    const [line] = await measureHistory(d, 'dev.app', phone.serial, NOW);
    expect(line).toMatchObject({ verdict: 'regression', flagged: true });
  });

  it('holds a run of another compile state apart too', async () => {
    const d = dir();
    await fourDays(d);
    await saveRun(d, run('late', late, slow, phone, { compile: 'speed' }));
    const [line] = await measureHistory(d, 'dev.app', phone.serial, NOW);
    expect(line).toMatchObject({ title: 'Cold launch', value: '951 ms', flagged: false });
  });

  it('calls a first number of a build a first number, with nothing of its kind to judge by', async () => {
    const d = dir();
    await fourDays(d);
    await saveRun(d, run('late', late, slow, phone, { build: 'debug' }));
    const [line] = await measureHistory(d, 'dev.app', phone.serial, NOW);
    expect(line).toMatchObject({ title: 'Cold launch', value: '951 ms', flagged: false });
  });

  it('says a worse run under load is one it could not judge', async () => {
    const d = dir();
    await fourDays(d);
    await saveRun(d, run('late', late, slow, phone, { thermal: 3 }));
    const [line] = await measureHistory(d, 'dev.app', phone.serial, NOW);
    expect(line).toMatchObject({ title: 'Could not judge: measured under load', flagged: true });
    expect(line?.verdict).toBeUndefined();
  });

  it('says a mirror where a mirror is why, as a window is no load', async () => {
    const d = dir();
    await fourDays(d);
    await saveRun(
      d,
      run('late', late, slow, phone, {
        load: { host: [1, 1, 1], hostCpus: 10, mirrored: true },
      }),
    );
    const [line] = await measureHistory(d, 'dev.app', phone.serial, NOW);
    expect(line).toMatchObject({
      title: 'Could not judge: measured with a mirror running',
      flagged: true,
    });
  });

  it('keeps a run from a window out of what the next is judged by', async () => {
    const d = dir();
    await fourDays(d);
    await saveRun(
      d,
      run('mirrored', '2026-11-05T09:00:00Z', slow, phone, {
        load: { host: [1, 1, 1], hostCpus: 10, mirrored: true },
      }),
    );
    await saveRun(d, run('late', late, slow));
    const [line] = await measureHistory(d, 'dev.app', phone.serial, NOW);
    expect(line).toMatchObject({ verdict: 'regression' });
  });

  it('says too few runs when a whole run has nothing but two runs to go by', async () => {
    const d = dir();
    await saveRun(d, run('a', '2026-11-01T10:00:00Z', steady));
    await saveRun(d, run('b', '2026-11-02T10:00:00Z', steady));
    await saveRun(d, run('late', late, slow));
    const [line] = await measureHistory(d, 'dev.app', phone.serial, NOW);
    expect(line).toMatchObject({ title: 'Could not judge: too few runs before it', flagged: true });
  });

  it('shows only this device, while judging by its class', async () => {
    const d = dir();
    await saveRun(d, run('other', '2026-11-05T10:00:00Z', steady, { ...phone, serial: 'OTHER' }));
    expect(await measureHistory(d, 'dev.app', phone.serial, NOW)).toEqual([]);
  });
});

describe('what a tool did, as a person reads it', () => {
  it('drops the ref and the quotes', () => {
    expect(spokenDone('tapped e12 "Sign in"')).toBe('Tapped Sign in');
    expect(spokenDone('dragged e1 "A" to e2 "B"')).toBe('Dragged A to B');
    expect(spokenDone('swiped (up)')).toBe('Swiped');
    expect(spokenDone('tapped 100,200')).toBe('Tapped 100,200');
    expect(spokenDone(undefined)).toBeUndefined();
  });
});
