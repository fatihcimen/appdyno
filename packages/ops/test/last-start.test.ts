import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recordsOf, saveRun } from '@appdyno/perf';
import { lastStartSeen } from '../src/perf/starts.js';

const phone = (serial: string) => ({
  serial,
  platform: 'android' as const,
  model: 'SM',
  os: '16',
  virtual: false,
});
const dirs: string[] = [];

const dir = () => {
  const made = mkdtempSync(join(tmpdir(), 'appdyno-last-start-'));
  dirs.push(made);
  return made;
};

const run = (name: string, at: string, serial: string, startedNs?: number) =>
  recordsOf(
    {
      run: name,
      app: 'dev.app',
      scenario: 'snapshot',
      source: 'perf_snapshot',
      raw: '',
      device: phone(serial),
      build: 'release',
      load: { host: [1, 1, 1], hostCpus: 10 },
      tool: '',
      at,
      ...(startedNs !== undefined && { startedNs }),
    },
    [{ kind: 'cpu.percent', unit: 'percent', samples: [5] }],
  );

const seen = (measurementsDir: string, serial: string) =>
  lastStartSeen(
    { measurementsDir } as never,
    {
      device: {
        serial,
        platform: 'android',
        virtual: false,
        hello: { model: 'SM', osVersion: '16' },
      },
    } as never,
    'dev.app',
    'snapshot',
  );

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('the start a run saw', () => {
  it('is the newest kept', async () => {
    const d = dir();
    await saveRun(d, run('a', '2026-11-05T10:00:00Z', 'PHONE1', 100));
    await saveRun(d, run('b', '2026-11-05T11:00:00Z', 'PHONE1', 200));
    expect(await seen(d, 'PHONE1')).toBe(200);
  });

  it('outlasts a run that did not ask for one', async () => {
    const d = dir();
    await saveRun(d, run('a', '2026-11-05T10:00:00Z', 'PHONE1', 100));
    await saveRun(d, run('b', '2026-11-05T11:00:00Z', 'PHONE1'));
    expect(await seen(d, 'PHONE1')).toBe(100);
  });

  it("is this phone's and not another of its kind's", async () => {
    const d = dir();
    await saveRun(d, run('a', '2026-11-05T10:00:00Z', 'PHONE1', 100));
    await saveRun(d, run('b', '2026-11-05T11:00:00Z', 'PHONE2', 200));
    expect(await seen(d, 'PHONE1')).toBe(100);
    expect(await seen(d, 'PHONE2')).toBe(200);
  });

  it('is nothing with no run', async () => {
    expect(await seen(dir(), 'PHONE1')).toBeUndefined();
  });
});
