import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { latestRuns, recordsOf, saveRun } from '../src/index.js';

const device = { serial: 'e', platform: 'android', model: 'm', os: '14', virtual: false } as const;
const key = { app: 'com.example.app', scenario: 'default', deviceClass: 'android-physical-m-14' };

/** A kept run of one launch, on disk, as `edit` leaves its records. */
async function kept(edit: (r: Record<string, unknown>) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-store-'));
  const records = recordsOf(
    {
      run: 'r1',
      app: key.app,
      scenario: key.scenario,
      source: 'test',
      raw: '',
      device,
      build: 'release',
      compile: 'speed',
      load: { host: [1, 1, 1], hostCpus: 8 },
      tool: 'appdyno',
      at: '2026-11-10T10:00:00.000Z',
    },
    [{ kind: 'launch.ttid_ms', unit: 'ms', samples: [400, 410, 405] }],
  );
  const file = must(await saveRun(dir, records), 'the run file');
  const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[];
  json.forEach(edit);
  writeFileSync(file, JSON.stringify(json));
  return { dir, file };
}

describe('a kept run read back', () => {
  it('is its records, with what another version wrote kept', async () => {
    const { dir } = await kept((r) => (r.later = { x: 1 }));
    const [[record] = []] = await latestRuns(dir, key);
    expect(record).toMatchObject({ compile: 'speed', later: { x: 1 }, value: 405 });
  });

  it('is refused by its path where it names a compile state no launch asks for', async () => {
    const { dir, file } = await kept((r) => (r.compile = 'speed; reboot #'));
    await expect(latestRuns(dir, key)).rejects.toThrow(file);
    await expect(latestRuns(dir, key)).rejects.toThrow(/compile/);
  });

  it('is refused by its path where it is no list of records', async () => {
    const { dir, file } = await kept(() => undefined);
    writeFileSync(file, '{"compile": "speed"}');
    await expect(latestRuns(dir, key)).rejects.toThrow(`${file} is not a run this tool kept`);
    writeFileSync(file, 'not json');
    await expect(latestRuns(dir, key)).rejects.toThrow(`${file} is not a run this tool kept`);
  });
});
