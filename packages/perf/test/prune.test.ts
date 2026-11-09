import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import {
  addToBaseline,
  pinBaseline,
  pruneTraces,
  recordsOf,
  saveBaseline,
  saveRun,
  type Metric,
} from '../src/index.js';

const DAY = 86_400_000;
const MB = 1 << 20;

const device = { serial: 'e', platform: 'android', model: 'm', os: '14', virtual: false } as const;
const metric: Metric = { kind: 'launch.ttid_ms', unit: 'ms', samples: [1, 2, 3, 4, 5] };

/** A state folder on disk, and a project's baselines beside it. */
function store() {
  const root = mkdtempSync(join(tmpdir(), 'appdyno-prune-'));
  const state = join(root, 'state');
  const traces = join(state, 'traces');
  const measurements = join(state, 'measurements');
  const project = join(root, 'project');
  for (const d of [traces, measurements, project]) mkdirSync(d, { recursive: true });
  const key = { app: 'dev.app', scenario: 's', deviceClass: 'android-physical-m-14' };
  /** A trace of `mb` that is `days` old: a folder of two files, as Instruments keeps one, or a file. */
  const trace = (name: string, mb: number, days: number) => {
    const path = join(traces, name);
    const at = new Date(Date.now() - days * DAY);
    if (name.endsWith('.trace')) {
      mkdirSync(path);
      writeFileSync(join(path, 'a'), Buffer.alloc(mb * MB));
      writeFileSync(join(path, 'b'), '');
    } else writeFileSync(path, Buffer.alloc(mb * MB));
    utimesSync(path, at, at);
    return path;
  };
  /** A kept run that names a trace, as an operation keeps one: its measurement's files hold the path. */
  const run = async (id: string, days: number, named?: string, inJson = false) => {
    const raw = join(measurements, `${id}.txt`);
    const path = named ? join(traces, named) : '';
    writeFileSync(raw, inJson ? 'no path here' : path);
    writeFileSync(
      join(measurements, `${id}.json`),
      JSON.stringify({ tracePath: inJson ? path : '' }),
    );
    const records = recordsOf(
      {
        run: `run-${id}`,
        app: key.app,
        scenario: key.scenario,
        source: 'test',
        raw,
        device,
        build: 'release',
        load: { host: [1], hostCpus: 8 },
        tool: 'test',
        at: new Date(Date.now() - days * DAY).toISOString(),
      },
      [metric],
    );
    const file = await saveRun(measurements, records);
    return { records, file: must(file, 'a run file'), raw };
  };
  const prune = (limitMb: number, dryRun = false) =>
    pruneTraces({ state, project, limitBytes: limitMb * MB, dryRun });
  /** A run so that a store has one to go by, with no trace of its own. */
  const anyRun = () => run('pm-a0a0a0a0', 1);
  return { root, state, traces, measurements, project, key, trace, run, anyRun, prune };
}

describe('kept traces pruned', () => {
  it('leaves everything under the limit', async () => {
    const s = store();
    const a = s.trace('a.pftrace', 2, 5);
    const r = await s.prune(10);
    expect(r).toMatchObject({ removed: [], over: false, beforeBytes: 2 * MB });
    expect(existsSync(a)).toBe(true);
  });

  it('goes oldest first, a folder whole, and stops at the limit', async () => {
    const s = store();
    await s.anyRun();
    const oldest = s.trace('oldest.trace', 4, 9);
    const older = s.trace('older.pftrace', 4, 5);
    const newer = s.trace('newer.pftrace', 4, 3);
    const r = await s.prune(5);
    expect(r.removed.map((x) => x.name)).toEqual(['oldest.trace', 'older.pftrace']);
    expect(r.afterBytes).toBe(4 * MB);
    expect(r.over).toBe(false);
    expect([existsSync(oldest), existsSync(older), existsSync(newer)]).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('counts a saved flight as it counts a trace, and takes it by the same rules', async () => {
    const s = store();
    await s.anyRun();
    const old = s.trace('dev.app-flight-1.timeline.html', 4, 3);
    const young = s.trace('dev.app-flight-2.timeline.html', 4, 0);
    const other = s.trace('timeline.html', 4, 3);
    const r = await s.prune(3);
    expect(r.removed.map((x) => x.name)).toEqual(['dev.app-flight-1.timeline.html']);
    expect(r.beforeBytes).toBe(8 * MB);
    // under a day old stays; what a person kept under the plain name is not among them
    expect([existsSync(old), existsSync(young), existsSync(other)]).toEqual([false, true, true]);
  });

  it("counts a simulator's frame probe reads as it counts a trace, and keeps one a run names", async () => {
    const s = store();
    const old = s.trace('probe-1.jsonl', 4, 5);
    const named = s.trace('probe-2.jsonl', 4, 5);
    await s.run('pm-90909090', 2, 'probe-2.jsonl');
    const r = await s.prune(1);
    expect(r.removed.map((x) => x.name)).toEqual(['probe-1.jsonl']);
    expect([existsSync(old), existsSync(named)]).toEqual([false, true]);
  });

  it('never takes a trace a recent run names, by either of its files', async () => {
    const s = store();
    const named = s.trace('named.pftrace', 4, 9);
    const inJson = s.trace('json.trace', 4, 9);
    const free = s.trace('free.pftrace', 4, 8);
    await s.run('pm-11111111', 2, 'named.pftrace');
    await s.run('pm-22222222', 2, 'json.trace', true);
    const r = await s.prune(1);
    expect(r.removed.map((x) => x.name)).toEqual(['free.pftrace']);
    expect(existsSync(named) && existsSync(inJson)).toBe(true);
    expect(existsSync(free)).toBe(false);
    expect(r.over).toBe(true);
  });

  it('never takes what a baseline took its numbers from, however old the run', async () => {
    const s = store();
    const t = s.trace('baseline.pftrace', 4, 40);
    const { records } = await s.run('pm-33333333', 40, 'baseline.pftrace');
    await saveBaseline(s.project, addToBaseline(s.key, undefined, records));
    // pushed out of the recent runs
    for (let i = 0; i < 31; i++) await s.run(`pm-4${String(i).padStart(7, '0')}`, 1);
    const r = await s.prune(1);
    expect(r.removed).toEqual([]);
    expect(existsSync(t)).toBe(true);
    expect(r.over).toBe(true);
  });

  it('never takes what the baseline of another project took: it is pinned, however old', async () => {
    const s = store();
    const t = s.trace('elsewhere.pftrace', 4, 40);
    const { records } = await s.run('pm-77777777', 40, 'elsewhere.pftrace');
    await pinBaseline(s.state, records);
    // no baseline of this project names it, and it is out of the recent runs
    for (let i = 0; i < 31; i++) await s.run(`pm-8${String(i).padStart(7, '0')}`, 1);
    const r = await s.prune(1);
    expect(r.removed).toEqual([]);
    expect(existsSync(t)).toBe(true);
  });

  it('takes the trace of a run that is neither recent nor in a baseline', async () => {
    const s = store();
    s.trace('old-run.pftrace', 4, 40);
    await s.run('pm-55555555', 40, 'old-run.pftrace');
    for (let i = 0; i < 31; i++) await s.run(`pm-6${String(i).padStart(7, '0')}`, 1);
    expect((await s.prune(1)).removed.map((x) => x.name)).toEqual(['old-run.pftrace']);
  });

  it('takes nothing under a day old', async () => {
    const s = store();
    await s.anyRun();
    const t = s.trace('today.pftrace', 4, 0.5);
    const r = await s.prune(1);
    expect(r.removed).toEqual([]);
    expect(existsSync(t)).toBe(true);
  });

  it('counts a heap dump too, and goes on no other file', async () => {
    const s = store();
    await s.anyRun();
    const heap = join(s.measurements, 'heap-a.hprof');
    writeFileSync(heap, Buffer.alloc(4 * MB));
    const at = new Date(Date.now() - 5 * DAY);
    utimesSync(heap, at, at);
    const other = join(s.traces, 'notes.txt');
    writeFileSync(other, Buffer.alloc(4 * MB));
    utimesSync(other, at, at);
    const r = await s.prune(1);
    expect(r.removed.map((x) => x.name)).toEqual(['heap-a.hprof']);
    expect(existsSync(other)).toBe(true);
  });

  it('follows no link, out of an entry or as the folder itself', async () => {
    const s = store();
    await s.anyRun();
    const outside = mkdtempSync(join(tmpdir(), 'appdyno-prune-outside-'));
    writeFileSync(join(outside, 'precious.pftrace'), Buffer.alloc(4 * MB));
    symlinkSync(outside, join(s.traces, 'link.trace'));
    expect((await s.prune(0)).removed).toEqual([]);
    rmSync(s.traces, { recursive: true });
    symlinkSync(outside, s.traces);
    const r = await s.prune(0);
    expect(r.removed).toEqual([]);
    expect(r.stopped).toContain('is a link');
    expect(existsSync(join(outside, 'precious.pftrace'))).toBe(true);
  });
});

describe('what it does not know, it does not delete', () => {
  it.each([
    ['no run at all', () => undefined],
    [
      'an empty folder of runs',
      (s: ReturnType<typeof store>) => mkdirSync(join(s.measurements, 'runs')),
    ],
  ])('%s: removes nothing, and says why', async (_what, make) => {
    const s = store();
    make(s);
    const t = s.trace('a.pftrace', 4, 40);
    const r = await s.prune(0);
    expect(r.removed).toEqual([]);
    expect(r.stopped).toContain('no kept runs');
    expect(existsSync(t)).toBe(true);
  });

  it.each([
    ['a run that is half written', 'run'],
    ['a measurement that is gone', 'raw'],
    ['a list of pins that does not read', 'pins'],
    ['a baseline that does not read', 'baseline'],
  ])('%s: removes nothing, and says why', async (_what, broken) => {
    const s = store();
    const t = s.trace('free.pftrace', 4, 40);
    const { file, raw } = await s.run('pm-12121212', 2);
    if (broken === 'run') writeFileSync(file, '[{"half');
    if (broken === 'raw') rmSync(raw);
    if (broken === 'pins') writeFileSync(join(s.state, 'traces-pinned.json'), 'not json');
    if (broken === 'baseline') {
      const f = join(s.project, 'baselines', s.key.app, s.key.scenario);
      mkdirSync(f, { recursive: true });
      writeFileSync(join(f, `${s.key.deviceClass}.json`), 'not json');
    }
    const r = await s.prune(0);
    expect(r.removed).toEqual([]);
    expect(r.stopped).toBeTruthy();
    expect(existsSync(t)).toBe(true);
  });
});

describe('what it removed is on the record', () => {
  it('logs each removal with its time and size, and a dry run lists the same and logs nothing', async () => {
    const s = store();
    await s.anyRun();
    s.trace('a.pftrace', 4, 9);
    s.trace('b.trace', 4, 8);
    const dry = await s.prune(1, true);
    expect(dry.removed.map((x) => x.name)).toEqual(['a.pftrace', 'b.trace']);
    expect(existsSync(join(s.traces, 'a.pftrace'))).toBe(true);
    expect(existsSync(dry.log)).toBe(false);

    const real = await s.prune(1);
    expect(real.removed).toEqual(dry.removed);
    const lines = readFileSync(real.log, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT.*\t4194304\ta\.pftrace$/);
    expect(lines[1]).toMatch(/\tb\.trace$/);
  });
});
