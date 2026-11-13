import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { assert, describe, expect, it } from 'vitest';
import {
  answerMarkdown,
  answerOf,
  answerRows,
  answerText,
  commentOf,
  exitCode,
  gateAnswers,
  loadReference,
  looksFor,
  placesOf,
  recordsOf,
  runKeys,
  saveAnswer,
  saveReference,
  saveRun,
  toJUnit,
  toText,
  WHOLE_RUN,
  writeComment,
  type Baseline,
  type Comparison,
  type KeyReport,
  type PerfRecord,
  type Reference,
  type Seen,
} from '../src/index.js';

const STEP = '04_tap_id_load';
const key = { app: 'dev.app', scenario: 'journey-a', deviceClass: 'android-virtual-Pixel_6-14' };

const worse = (kind: string, over: Partial<Comparison> = {}): Comparison => ({
  kind,
  unit: 'ms',
  verdict: 'regression',
  current: 1_660,
  baseline: 950,
  shift: 700,
  percent: 73.7,
  floor: 143,
  p: 0.0002,
  n: { current: 5, baseline: 15 },
  ...over,
});

const report = (comparisons: Comparison[], budgets: KeyReport['budgets'] = []): KeyReport => ({
  ...key,
  run: 'run-1',
  at: '2026-11-04T10:00:00.000Z',
  baselined: true,
  noise: [],
  comparisons,
  budgets,
});

const run = [
  { device: { model: 'Pixel 6', os: '14', virtual: true } } as PerfRecord,
] satisfies PerfRecord[];

const baseline: Baseline = {
  schema: 1,
  ...key,
  metrics: {
    [`journey.${STEP}.ms`]: {
      unit: 'ms',
      better: 'lower',
      runs: ['a', 'b', 'c'].map((d) => ({
        at: `2026-11-0${d === 'a' ? 1 : d === 'b' ? 2 : 3}T00:00:00.000Z`,
        samples: [950],
        build: 'debug',
        noise: [],
      })),
    },
  },
};

const seen = (over: Partial<Seen> = {}): Seen => ({ read: [], cannot: [], ...over });
const profile = (entries: Record<string, number>) => ({
  durationMs: 3_000,
  top: Object.entries(entries).map(([symbol, samples]) => ({ symbol, samples })),
});
const reference = (places: Reference['places']): Reference => ({
  schema: 1,
  ...key,
  at: '2026-11-03T00:00:00.000Z',
  build: 'debug',
  places,
});

const stepAlarm = [worse(`journey.${STEP}.ms`)];
const answer = (s: Seen, r?: Reference, c = stepAlarm) =>
  answerOf(report(c), run, baseline, { [STEP]: s }, r);
const only = (a: ReturnType<typeof answer>) => must(a.findings[0], 'a finding');

describe('where a change is looked for', () => {
  it('takes a journey step by step, and the whole with the step that moved most', () => {
    const places = placesOf([
      worse('journey.total_ms'),
      worse(`journey.${STEP}.ms`),
      worse(`journey.${STEP}.frames_worst_ms`),
      worse('journey.02_launch.ms', { verdict: 'ok', shift: 3 }),
    ]);
    expect([...places.keys()]).toEqual([STEP]);
    expect(places.get(STEP)?.map((c) => c.kind)).toEqual([
      `journey.${STEP}.ms`,
      `journey.${STEP}.frames_worst_ms`,
      'journey.total_ms',
    ]);
  });

  it('calls a journey whose whole moved and no step did by its largest step', () => {
    const places = placesOf([
      worse('journey.total_ms'),
      worse('journey.01_a.ms', { verdict: 'ok', shift: 10 }),
      worse('journey.02_b.ms', { verdict: 'ok', shift: 90 }),
    ]);
    expect([...places.keys()]).toEqual(['02_b']);
  });

  it('puts more steps never settling at the step that kept no time, and else at the run', () => {
    const gone = worse('journey.03_tap_id_open_catalog.ms', {
      verdict: 'few-samples',
      n: { current: 0, baseline: 15 },
    });
    const more = worse('journey.unsettled', { unit: 'count' });
    expect([...placesOf([more, gone]).keys()]).toEqual(['03_tap_id_open_catalog']);
    expect([...placesOf([more]).keys()]).toEqual([WHOLE_RUN]);
  });

  it('takes anything else as the run, and nothing that the gate did not call', () => {
    expect([...placesOf([worse('launch.ttid_ms')]).keys()]).toEqual([WHOLE_RUN]);
    expect(placesOf([worse('launch.ttid_ms', { verdict: 'noisy' })]).size).toBe(0);
  });

  it('asks a device what fits the number, and nothing for what no tool here explains', () => {
    expect(looksFor(['launch.ttid_ms'])).toEqual(['launch']);
    expect(looksFor(['launch.phase.main_ms'])).toEqual(['launch']);
    expect(looksFor(['frames.p95_ms', 'stalls.worst_ms'])).toEqual(['profile', 'frames']);
    expect(looksFor(['cpu.percent'])).toEqual(['profile']);
    expect(looksFor(['network.rx_bytes', 'memory.kb'])).toEqual([]);
    expect(looksFor([`journey.${STEP}.memory_kb`])).toEqual([]);
    expect(looksFor([`journey.${STEP}.ms`])).toEqual(['profile', 'frames']);
  });
});

describe('a cause', () => {
  it('names the function that moved, in ms of CPU in the step, with its share of the change', () => {
    const a = answer(
      seen({ profile: profile({ steady: 200, stall: 690 }), read: ['CPU profile pm-b'] }),
      reference({ [STEP]: { profile: profile({ steady: 200 }) } }),
    );
    expect(a.status).toBe('regression');
    expect(only(a).causes).toEqual([
      {
        kind: 'function',
        name: 'stall',
        says: 'stall, +690 ms of CPU in the step (0 to 690), 99 % of the change',
      },
    ]);
    expect(only(a).cannot).toEqual([]);
    expect(only(a).evidence).toContain('CPU profile pm-b');
  });

  it('of a profile that counts callers in, names what was called and not main', () => {
    const counted = (entries: Record<string, number>) => {
      const p = profile(entries);
      return { ...p, appTop: p.top };
    };
    const f = only(
      answer(
        seen({
          profile: counted({ main: 1_700, closure: 805, knownCost: 790, steady: 300 }),
          read: ['CPU profile pm-b'],
        }),
        reference({ [STEP]: { profile: counted({ main: 900, closure: 5, steady: 300 }) } }),
      ),
    );
    expect(f.causes[0]?.name).toBe('knownCost');
    expect(f.causes[0]?.says).toContain('+790 ms of CPU in the step (0 to 790)');
  });

  it('names the innermost of a caller and a callee that read the same, as a simulator gave them', () => {
    const counted = (entries: Record<string, number>) => {
      const p = profile(entries);
      return { ...p, appTop: p.top };
    };
    const f = only(
      answer(
        seen({
          profile: counted({
            'static FixtureApp.$main()': 1_012,
            __debug_main_executable_dylib_entry_point: 1_012,
            'knownCost()': 786,
            'closure #3 in closure #1 in StallScreen.body.getter': 786,
          }),
        }),
        reference({
          [STEP]: {
            profile: counted({
              'static FixtureApp.$main()': 226,
              __debug_main_executable_dylib_entry_point: 226,
            }),
          },
        }),
      ),
    );
    expect(f.causes[0]?.name).toBe('knownCost()');
  });

  it('names no function that accounts for too little of the change, and says which it was', () => {
    const f = only(
      answer(
        seen({ profile: profile({ steady: 200, small: 100 }) }),
        reference({ [STEP]: { profile: profile({ steady: 200 }) } }),
      ),
    );
    expect(f.causes).toEqual([]);
    expect(f.evidence.join()).toContain('small, +100 ms of CPU');
    expect(f.cannot.join()).toContain('no function accounts for the change');
  });

  it('with no side to compare, names no function, and says what is missing', () => {
    const f = only(answer(seen({ profile: profile({ stall: 690 }) })));
    expect(f.causes).toEqual([]);
    expect(f.evidence.join()).toContain('the most CPU now: stall 690 ms');
    expect(f.cannot.join()).toContain('appdyno perf reference');
  });

  it('says "no cause was found" only of what it read', () => {
    expect(only(answer(seen({ cannot: ['no device'] }))).cannot).toEqual(['no device']);
  });

  it('says what no measure explains, and claims to have looked at nothing there', () => {
    const net = answerOf(report([worse('network.rx_bytes', { unit: 'bytes' })]), run, baseline, {
      [WHOLE_RUN]: seen(),
    });
    expect(only(net).cannot).toEqual(['no measure here explains network.rx_bytes']);
    const memory = [worse(`journey.${STEP}.memory_kb`, { unit: 'kb' })];
    expect(only(answer(seen(), undefined, memory)).cannot).toEqual([
      `no measure here explains journey.${STEP}.memory_kb`,
    ]);
  });

  it('says nothing was found rather than guess, when nothing moved', () => {
    const f = only(
      answer(
        seen({ profile: profile({ steady: 200 }), read: ['CPU profile pm-a'] }),
        reference({ [STEP]: { profile: profile({ steady: 205 }) } }),
      ),
    );
    expect(f.causes).toEqual([]);
    expect(f.cannot.join()).toContain('no cause was found');
    expect(f.cannot.join()).toContain('a wait outside both');
  });

  it('never calls a function that fell a cause', () => {
    const f = only(
      answer(
        seen({ profile: profile({}) }),
        reference({ [STEP]: { profile: profile({ gone: 900 }) } }),
      ),
    );
    expect(f.causes).toEqual([]);
  });

  it('names the phase of a start that moved', () => {
    const c = [worse('launch.ttid_ms')];
    const phases = [
      { phase: 'bindApplication', ms: 1_530 },
      { phase: 'activityStart', ms: 40 },
    ];
    const before = [
      { phase: 'bindApplication', ms: 820 },
      { phase: 'activityStart', ms: 38 },
    ];
    const a = answerOf(
      report(c),
      run,
      baseline,
      { [WHOLE_RUN]: seen({ phases, reasons: ['Main Thread - Time spent in Running'] }) },
      reference({ [WHOLE_RUN]: { phases: before } }),
    );
    expect(only(a).causes).toEqual([
      {
        kind: 'phase',
        name: 'bindApplication',
        says: 'bindApplication, +710 ms (820 to 1530), all of the change',
      },
    ]);
    expect(only(a).evidence.join()).toContain('Main Thread - Time spent in Running');
  });

  it('reads a frame cause and a hang straight from the trace, with no other side', () => {
    const frames = {
      slowFrames: 12,
      causes: [{ cause: 'lock', msPerFrame: 91.6, share: 96, detail: 'held by worker' }],
      top: 'lock',
    } as Seen['frames'];
    const f = only(answer(seen({ frames })));
    expect(f.causes[0]).toMatchObject({ kind: 'frames', name: 'lock' });
    expect(f.causes[0]?.says).toContain('91.6 ms a frame (96 %): held by worker');

    const hang = only(
      answer(
        seen({
          hangs: [
            { ms: 300, kind: 'blocked', cpuPercent: 2 },
            { ms: 505.2, kind: 'busy', cpuPercent: 100, function: 'busyMainThread()' },
          ],
        }),
      ),
    );
    expect(hang.causes[0]).toMatchObject({ kind: 'hang', name: 'busyMainThread()' });
    expect(hang.causes[0]?.says).toContain('busy, on the CPU 100 % of it');
  });

  it('says of slow frames with no cause that they are unexplained', () => {
    const frames = { slowFrames: 4, causes: [] } as unknown as Seen['frames'];
    const f = only(answer(seen({ frames })));
    expect(f.causes).toEqual([]);
    expect(f.cannot.join()).toContain('the 4 slow frames are unexplained');
  });

  it('says when the change did not show again while it was looked at', () => {
    expect(only(answer(seen({ againMs: 960 }))).cannot.join()).toContain('did not show again');
    expect(only(answer(seen({ againMs: 1_640 }))).evidence.join()).toContain('it showed again');
  });

  it('holds what could not be read beside what could', () => {
    const f = only(answer(seen({ cannot: ['a CPU profile: cannot measure a CPU profile'] })));
    expect(f.cannot[0]).toBe('a CPU profile: cannot measure a CPU profile');
  });

  it('says a regression was not looked into when it was not', () => {
    const f = only(answerOf(report(stepAlarm), run, baseline));
    expect(f.causes).toEqual([]);
    expect(f.cannot).toEqual(['no cause was looked for: `appdyno perf why` does']);
  });
});

describe('how sure', () => {
  it('says the statistics of the gate, and when a change is only just past its floor', () => {
    expect(only(answer(seen())).sure).toBe(
      'p 0.0002 (it takes under 0.01), 5 against 15 samples over 3 baseline runs; 4.9 times the floor of 143 ms',
    );
    const near = [worse(`journey.${STEP}.ms`, { shift: 150 })];
    expect(only(answer(seen(), undefined, near)).sure).toContain('just past it');
  });

  it('calls noise no regression, and looks at nothing', () => {
    const a = answerOf(
      report([worse('launch.ttid_ms', { verdict: 'noisy', note: 'measure again' })]),
      run,
      baseline,
    );
    expect(a.status).toBe('noisy');
    expect(a.findings).toEqual([]);
    expect(a.notes.join()).toContain('a change under noise, not called');
  });

  it('holds a phase that moved against that phase of the look, not a whole start', () => {
    const phase = [worse('launch.phase.main_ms', { current: 816, baseline: 11, shift: 805 })];
    const looked = (againMs: number, ms: number) =>
      only(
        answerOf(report(phase), run, baseline, {
          [WHOLE_RUN]: seen({ againMs, phases: [{ phase: 'main', ms }] }),
        }),
      );
    expect(looked(1_451, 816).evidence.join()).toContain('it showed again: 816 ms');
    expect(looked(1_451, 12).cannot.join()).toContain('it did not show again: 12 ms');
  });

  it('goes by a phone’s own numbers when only what the Mac timed is under noise', () => {
    const onPhone = (c: Comparison[]) => ({
      ...report(c),
      deviceClass: 'ios-physical-iPhone14,3-27',
    });
    const mac = worse('journey.total_ms', {
      verdict: 'noisy',
      note: 'measure again',
      throughHost: true,
    });
    const own = worse('journey.04_tap.ms', { verdict: 'ok' });
    const clear = answerOf(onPhone([own, mac]), run, baseline);
    expect(clear.status).toBe('clear');
    expect(clear.notes.join()).toContain('a change under noise, not called');
    expect(exitCode([onPhone([own, mac])])).toBe(0);
    expect(toText([onPhone([own, mac])])).not.toContain('could not judge');
    expect(toJUnit([onPhone([own, mac])])).not.toContain('<failure');
    // a virtual device's numbers all share that load, and with none of its own a phone called nothing
    expect(answerOf(report([own, mac]), run, baseline).status).toBe('noisy');
    expect(exitCode([report([own, mac])])).toBe(1);
    expect(answerOf(onPhone([mac]), run, baseline).status).toBe('noisy');
    expect(exitCode([onPhone([mac])])).toBe(1);
    const loud = worse('journey.04_tap.ms', { verdict: 'noisy', note: 'measure again' });
    expect(answerOf(onPhone([own, mac, loud]), run, baseline).status).toBe('noisy');
    expect(exitCode([onPhone([own, mac, loud])])).toBe(1);
  });

  it('keeps too few samples, unlike builds and a budget apart from a regression', () => {
    const says = (c: Comparison[], b: KeyReport['budgets'] = []) =>
      answerOf(report(c, b), run, baseline).status;
    expect(says([worse('a', { verdict: 'few-samples', note: 'n' })])).toBe('few-samples');
    expect(says([worse('a', { verdict: 'refused', note: 'n' })])).toBe('refused');
    expect(says([worse('a', { verdict: 'ok' })])).toBe('clear');
    expect(says([worse('a', { verdict: 'new' })])).toBe('no-baseline');
    expect(
      says([worse('a', { verdict: 'ok' })], [{ kind: 'a', value: 3, ok: false, limit: 'max 2' }]),
    ).toBe('over-budget');
  });
});

describe('the answer, written once', () => {
  const full = answer(
    seen({ profile: profile({ '<script>a|b_c*': 690 }), read: ['CPU profile pm-b'] }),
    reference({ [STEP]: { profile: profile({}) } }),
    [worse(`journey.${STEP}.ms`, { modelled: true, throughHost: true })],
  );

  it('says what got worse, how sure, its cause, against what and on which run', () => {
    const labels = answerRows(full).map((r) => r.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'What got worse',
        'How sure',
        'Likeliest cause',
        'Evidence',
        'Against',
        'Run',
      ]),
    );
    const text = answerText(full);
    expect(text).toContain('regression: dev.app, journey-a, Android emulator');
    expect(text).toContain('3 baseline runs, 2026-11-01 00:00 UTC to 2026-11-03 00:00 UTC');
    expect(text).toContain('run-1');
  });

  it('keeps a modelled number, one through the host and a virtual device marked everywhere', () => {
    for (const out of [answerText(full), answerMarkdown(full).replaceAll('\\', '')]) {
      expect(out).toContain('(modelled)');
      expect(out).toContain('(timed through the host)');
      expect(out).toContain('real frame rates, frozen frames, hitches and energy need a phone');
    }
  });

  it('leaves nothing from the app for Markdown to act on', () => {
    const md = answerMarkdown(full);
    expect(md).not.toMatch(/(^|[^\\])</);
    expect(md).toContain('\\<script\\>a\\|b\\_c\\*');
    const named = answer(
      seen({ profile: profile({ '@everyone\n# Hello &amp;': 690 }) }),
      reference({ [STEP]: { profile: profile({}) } }),
    );
    const out = answerMarkdown(named);
    // no mention to notify, no heading of its own, no entity
    expect(out).toContain('\\@everyone \\# Hello \\&amp;');
    expect(out).not.toMatch(/(^|[^\\])@/);
  });

  it('heads a comment with what most needs saying, and cuts it under what can be posted', () => {
    const clear = answerOf(report([worse('a', { verdict: 'ok' })]), run, baseline);
    expect(commentOf([full, clear]).split('\n')[0]).toBe('## appdyno: 1 of 2 scenarios got worse');
    expect(commentOf([clear]).split('\n')[0]).toBe('## appdyno: no regression in 1 scenario');
    expect(commentOf([])).toBe('## appdyno: no measured run\n');
    // what the gate did not call is no pass, in the line read first
    const noisy = answerOf(
      report([worse('a', { verdict: 'noisy', note: 'measure again' })]),
      run,
      baseline,
    );
    expect(commentOf([clear, noisy]).split('\n')[0]).toBe(
      '## appdyno: 1 of 2 scenarios not called',
    );
    expect(commentOf([noisy])).not.toContain('no regression:');
    const long = { ...full, notes: Array.from({ length: 3_000 }, () => 'x'.repeat(40)) };
    const cut = commentOf([long]);
    expect(cut.length).toBeLessThan(65_536);
    expect(cut).toContain('Cut here');
  });
});

describe('what is kept of an answer', () => {
  const fresh = () => mkdtempSync(join(tmpdir(), 'appdyno-answer-'));
  const records = (id: string, ms: number) =>
    recordsOf(
      {
        run: id,
        app: key.app,
        scenario: key.scenario,
        source: '',
        raw: '',
        device: {
          serial: 's',
          platform: 'android',
          model: 'Pixel 6',
          os: '14',
          virtual: true,
        },
        build: 'debug',
        load: { host: [1, 1, 1], hostCpus: 10 },
        tool: '',
        at: `2026-11-04T10:00:0${id.slice(-1)}.000Z`,
      },
      [{ kind: 'launch.ttid_ms', unit: 'ms', samples: [ms] }],
    );

  it('speaks only for the run it was found on', async () => {
    const [dir, project] = [fresh(), fresh()];
    await saveRun(dir, records('run-1', 100));
    const [kept] = await runKeys(dir);
    assert(kept);
    await saveAnswer(dir, {
      ...kept,
      schema: 1,
      status: 'regression',
      run: 'run-1',
      at: '2026-11-04T10:00:01.000Z',
      findings: [],
      notes: ['kept for run-1'],
    });
    expect((await gateAnswers(dir, project))[0]?.notes).toEqual(['kept for run-1']);
    // a newer run has no answer yet, and the one kept says nothing of it
    await saveRun(dir, records('run-2', 100));
    const [newest] = await gateAnswers(dir, project);
    assert(newest);
    expect(newest.run).toBe('run-2');
    expect(newest.notes).not.toContain('kept for run-1');
  });

  it('writes the comment to a file, and touches no device to do it', async () => {
    const [dir, project] = [fresh(), fresh()];
    await saveRun(dir, records('run-1', 100));
    const out = join(fresh(), 'in/a/folder/comment.md');
    expect(await writeComment(dir, project, out)).toBe(out);
    expect(readFileSync(out, 'utf8')).toContain('## appdyno: 1 of 1 scenario not called');
  });

  it('keeps a reference where a project can commit it, and reads it back', async () => {
    const project = fresh();
    const r = reference({ [STEP]: { profile: profile({ a: 10 }) } });
    const file = await saveReference(project, r);
    expect(file).toContain(`references/${key.app}/${key.scenario}/`);
    expect(await loadReference(project, key)).toEqual(r);
    expect(await loadReference(project, { ...key, scenario: 'other' })).toBeUndefined();
  });
});
