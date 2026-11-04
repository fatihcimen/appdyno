import { frameCauseText, hangText, round1 } from '@appdyno/core';
import type { HangCause, SlowFrameCauses } from '@appdyno/core';
import { ALPHA, FLOOR, type Baseline, type Comparison } from './compare.js';
import { when } from './dashboard/format.js';
import { functionDiff, moved, type FunctionChange, type Profile } from './functions.js';
import {
  JOURNEY_TOTAL,
  journeyStep,
  measureOf,
  type Build,
  type DeviceInfo,
  type MeasureId,
  type PerfRecord,
} from './record.js';
import type { KeyReport } from './report.js';
import type { RunKey } from './store.js';

/** What a device is asked about a change: a start's phases, why frames were late or the main thread stood, a CPU profile. */
export type Look = 'launch' | 'frames' | 'profile';

const LOOKS: Partial<Record<MeasureId, Look[]>> = {
  launch: ['launch'],
  'launch-why': ['launch'],
  frames: ['profile', 'frames'],
  frozen: ['profile', 'frames'],
  stalls: ['profile', 'frames'],
  cpu: ['profile'],
  journey: ['profile', 'frames'],
};

/** What fits one number: a step's memory is a journey's number and no CPU profile explains it. */
const lookOf = (kind: string) =>
  journeyStep(kind)?.what === 'memory_kb' ? [] : (LOOKS[measureOf(kind) as MeasureId] ?? []);

/** What is looked at for these numbers: none, for a kind no tool here can explain. */
export const looksFor = (kinds: string[]) => [...new Set(kinds.flatMap(lookOf))];

/** The place of a change that is no step of a journey. */
export const WHOLE_RUN = 'run';

/**
 * Where the gate's regressions are, with what moved there: each step of a journey, and all else as the run. A journey's
 * whole goes with the step that moved most, of whatever verdict, as a whole is only its steps added up.
 */
export function placesOf(comparisons: Comparison[]): Map<string, Comparison[]> {
  const places = new Map<string, Comparison[]>();
  const add = (place: string, c: Comparison) =>
    places.set(place, [...(places.get(place) ?? []), c]);
  const worse = comparisons.filter((c) => c.verdict === 'regression');
  for (const c of worse.filter((x) => x.kind !== JOURNEY_TOTAL))
    add(journeyStep(c.kind)?.step ?? WHOLE_RUN, c);
  const whole = worse.find((c) => c.kind === JOURNEY_TOTAL);
  if (whole) {
    const steps = comparisons.filter((c) => journeyStep(c.kind)?.what === 'ms');
    const most = steps.toSorted((a, b) => (b.shift ?? 0) - (a.shift ?? 0))[0];
    add(most ? journeyStep(most.kind)!.step : WHOLE_RUN, whole);
  }
  return places;
}

/** What a look at one place read. On the baseline's build, its profile and phases are the other side of a diff. */
export type Seen = {
  profile?: Profile;
  phases?: { phase: string; ms: number }[];
  /** What the platform itself says of a start. */
  reasons?: string[];
  frames?: SlowFrameCauses;
  hangs?: HangCause[];
  /** What it took while it was looked at. */
  againMs?: number;
  /** The Mac's load then: what a virtual device's look shared the cores with. */
  hostLoad?: number;
  /** What read it, each with the measurement that keeps it. */
  read: string[];
  /** What could not be read, and why. */
  cannot: string[];
};

/** A place's profile and phases on the baseline's build, by place: what a later look is diffed against. */
export type Reference = RunKey & {
  schema: 1;
  at: string;
  build: Build;
  compile?: string;
  places: Record<string, Pick<Seen, 'profile' | 'phases'>>;
};

/** One reason for a change, with what shows it. */
export type Cause = {
  kind: 'function' | 'phase' | 'frames' | 'hang';
  name: string;
  says: string;
};

export type Finding = {
  /** A step of the journey, or `WHOLE_RUN`. */
  place: string;
  worse: Comparison[];
  /** How sure the gate is of the change, which says nothing of its cause. */
  sure: string;
  /** Likeliest first. None: no cause is named, and `cannot` says what is missing. */
  causes: Cause[];
  evidence: string[];
  cannot: string[];
};

export type GateStatus =
  'regression' | 'over-budget' | 'noisy' | 'refused' | 'few-samples' | 'no-baseline' | 'clear';

/** What the gate says of a key's newest run, and why: the command line, the tool, the comment and the page read this. */
export type GateAnswer = RunKey & {
  schema: 1;
  status: GateStatus;
  run: string;
  at: string;
  device?: Pick<DeviceInfo, 'model' | 'os' | 'virtual'>;
  baseline?: { runs: number; from: string; to: string };
  findings: Finding[];
  /** What else the gate said: a change under noise, too few samples, a budget. */
  notes: string[];
};

/** Under this share of a change, what moved does not account for it: a frame's cause is held to the same. */
const NAMED_SHARE = 0.4;
/** A caller's rise and its callee's differ by what the sampler happened to catch. */
const NEAR_THE_MOST = 0.9;

export const UNEXPLAINED_FRAMES =
  'are unexplained: no cause holds the main thread long enough to name';

const NOTHING_NAMED =
  'no cause was found. A profile sees what is on the CPU and a frame trace what the main thread did in its frames, so a wait outside both (a sleep in a touch, a timer, the network) shows in neither';

const statusOf = (r: KeyReport): GateStatus => {
  const says = (v: Comparison['verdict']) => r.comparisons.some((c) => c.verdict === v);
  if (says('regression')) return 'regression';
  if (r.budgets.some((b) => !b.ok)) return 'over-budget';
  if (says('noisy')) return 'noisy';
  if (says('refused')) return 'refused';
  if (says('few-samples')) return 'few-samples';
  return r.comparisons.every((c) => c.verdict === 'new') ? 'no-baseline' : 'clear';
};

const shareOf = (changeMs: number, lead: Comparison) =>
  lead.unit === 'ms' && lead.shift ? changeMs / lead.shift : undefined;

const shareWords = (share: number | undefined) =>
  share === undefined
    ? ''
    : share >= 1
      ? ', all of the change'
      : `, ${Math.round(share * 100)} % of the change`;

const needsReference = (what: string) =>
  `nothing to compare ${what} with: \`appdyno perf reference\`, with the baseline's build installed, keeps its side`;

const sureOf = (lead: Comparison, runs: number) => {
  const times = round1(Math.abs(lead.shift!) / lead.floor!);
  return `p ${lead.p} (it takes under ${ALPHA}), ${lead.n.current} against ${lead.n.baseline} samples over ${runs} baseline runs; ${times} times the floor of ${lead.floor} ${lead.unit}${times < 2 ? ', just past it' : ''}`;
};

/** A step is work done once: what moved in it, in ms of CPU, can be held against its own change. */
const inAll = (p: Profile): Profile => ({ ...p, durationMs: 1_000 });

type Part = { causes?: Cause[]; evidence?: string[]; cannot?: string[] };

const functionWords = (f: FunctionChange, per: string, share?: number) =>
  `${f.symbol}, +${f.changeMs} ms of CPU${per} (${f.beforeMs} to ${f.afterMs})${shareWords(share)}`;

/**
 * Of a list that counts callers in, as an iPhone's and a simulator's does: a caller rises as far as what it called, so
 * `main` rises with everything. Of those that rose about as far, the deepest has the least time besides.
 */
const deepest = (rose: FunctionChange[]) =>
  rose
    .filter((f) => f.changeMs >= rose[0]!.changeMs * NEAR_THE_MOST)
    .toSorted((a, b) => a.afterMs - b.afterMs)[0];

/** The function that rose against the other build's profile of the same place. */
function byFunction(place: string, lead: Comparison, seen: Seen, before?: Profile): Part {
  const { profile } = seen;
  if (!profile) return {};
  if (!before) {
    const most = (profile.appTop?.length ? profile.appTop : profile.top)
      .slice(0, 3)
      .map((e) => `${e.symbol} ${e.samples} ms`);
    return {
      evidence: [`the most CPU now: ${most.join(', ')}`],
      cannot: [needsReference('a profile')],
    };
  }
  const step = place !== WHOLE_RUN;
  const rose = (
    step ? functionDiff(inAll(before), inAll(profile)) : functionDiff(before, profile)
  ).filter((f) => f.changeMs > 0);
  const top = profile.appTop?.length && rose.length ? deepest(rose) : rose[0];
  if (!top) return { cannot: ['no function rose past its floor'] };
  const share = step ? shareOf(top.changeMs, lead) : undefined;
  const per = step ? ' in the step' : ' a second';
  if (share !== undefined && share < NAMED_SHARE)
    return {
      evidence: [`the most that rose: ${functionWords(top, per, share)}`],
      cannot: ['no function accounts for the change'],
    };
  return {
    causes: [{ kind: 'function', name: top.symbol, says: functionWords(top, per, share) }],
  };
}

/** The phase of a start that rose against the other build's. */
function byPhase(lead: Comparison, seen: Seen, before?: Seen['phases']): Part {
  const { phases } = seen;
  if (!phases?.length) return {};
  const evidence = seen.reasons?.length ? [`the platform says: ${seen.reasons.join('; ')}`] : [];
  if (!before?.length) {
    const longest = phases.toSorted((a, b) => b.ms - a.ms)[0]!;
    return {
      evidence: [...evidence, `the longest phase now: ${longest.phase} ${longest.ms} ms`],
      cannot: [needsReference('the phases of a start')],
    };
  }
  const read = (list: NonNullable<Seen['phases']>) => new Map(list.map((p) => [p.phase, p.ms]));
  const [top] = moved(read(before), read(phases), FLOOR.ms.absolute, FLOOR.ms.percent / 100).filter(
    (p) => p.changeMs > 0,
  );
  const share = top && shareOf(top.changeMs, lead);
  if (!top || (share !== undefined && share < NAMED_SHARE))
    return { evidence, cannot: ['no phase of the start accounts for the change'] };
  return {
    evidence,
    causes: [
      {
        kind: 'phase',
        name: top.name,
        says: `${top.name}, +${top.changeMs} ms (${top.beforeMs} to ${top.afterMs})${shareWords(share)}`,
      },
    ],
  };
}

/** What the main thread did: read straight from this run's trace, so it has no other side. */
function byMainThread(seen: Seen): Part {
  const worst = seen.hangs?.toSorted((a, b) => b.ms - a.ms)[0];
  const hang: Part = worst
    ? { causes: [{ kind: 'hang', name: worst.function ?? worst.kind, says: hangText(worst) }] }
    : {};
  const { frames } = seen;
  if (!frames) return hang;
  // a stall in a touch's handler holds up no frame in flight: the trace is right, and says nothing of that stall
  if (frames.slowFrames === 0)
    return { ...hang, evidence: ['no frame missed its deadline, so a frame trace names nothing'] };
  const [top] = frames.causes;
  return frames.top && top
    ? {
        causes: [
          ...(hang.causes ?? []),
          {
            kind: 'frames',
            name: top.cause,
            says: `the ${frames.slowFrames} slow frames: ${frameCauseText(top)}`,
          },
        ],
      }
    : { ...hang, cannot: [`the ${frames.slowFrames} slow frames ${UNEXPLAINED_FRAMES}`] };
}

function findingOf(
  place: string,
  worse: Comparison[],
  runs: number,
  seen: Seen | undefined,
  reference: Reference | undefined,
): Finding {
  const lead = worse.find((c) => journeyStep(c.kind)?.what === 'ms') ?? worse[0]!;
  const said = { place, worse, sure: sureOf(lead, runs) };
  if (!seen)
    return {
      ...said,
      causes: [],
      evidence: [],
      cannot: ['no cause was looked for: `appdyno perf why` does'],
    };
  const before = reference?.places[place];
  const parts = [
    byPhase(lead, seen, before?.phases),
    byFunction(place, lead, seen, before?.profile),
    byMainThread(seen),
  ];
  const causes = parts.flatMap((p) => p.causes ?? []);
  const unexplained = worse.filter((c) => lookOf(c.kind).length === 0).map((c) => c.kind);
  const showed =
    seen.againMs === undefined || lead.baseline === undefined || !lead.shift
      ? undefined
      : seen.againMs - lead.baseline >= lead.shift / 2;
  const again = `${seen.againMs} ms while it was looked at, against ${lead.baseline} ms`;
  return {
    ...said,
    causes,
    evidence: [
      ...parts.flatMap((p) => p.evidence ?? []),
      ...(showed ? [`it showed again: ${again}`] : []),
      ...seen.read,
      ...(reference
        ? [`the other side: the reference of ${when(reference.at)}, a ${reference.build} build`]
        : []),
      ...(seen.hostLoad === undefined ? [] : [`host load ${seen.hostLoad} while it was looked at`]),
    ],
    cannot: [
      ...(showed === false
        ? [`it did not show again: ${again}: what was read may not be that change`]
        : []),
      ...parts.flatMap((p) => p.cannot ?? []),
      ...seen.cannot,
      ...(unexplained.length ? [`no measure here explains ${unexplained.join(', ')}`] : []),
      // "not found" is a claim about what was read: with nothing read, the lines above are all there is to say
      ...(causes.length || seen.read.length === 0 ? [] : [NOTHING_NAMED]),
    ],
  };
}

const NOTE_OF: Partial<Record<Comparison['verdict'], (c: Comparison) => string>> = {
  noisy: (c) => `a change under noise, not called: ${c.kind}: ${c.note}`,
  'few-samples': (c) => `a change with too little to call it: ${c.kind}: ${c.note}`,
  refused: (c) => `not comparable: ${c.kind}: ${c.note}`,
  improvement: (c) => `improved: ${c.kind}`,
};

function notesOf(r: KeyReport) {
  const fresh = r.comparisons.filter((c) => c.verdict === 'new').length;
  return [
    ...r.comparisons.flatMap((c) => NOTE_OF[c.verdict]?.(c) ?? []),
    ...r.budgets.filter((b) => !b.ok).map((b) => `over budget: ${b.kind} ${b.value} (${b.limit})`),
    ...(fresh ? [`${fresh} numbers have no baseline yet`] : []),
  ];
}

const baselineOf = (b: Baseline | undefined) => {
  const times = [
    ...new Set(Object.values(b?.metrics ?? {}).flatMap((m) => m.runs.map((r) => r.at))),
  ].sort();
  return times.length ? { runs: times.length, from: times[0]!, to: times.at(-1)! } : undefined;
};

/** The gate's report of a key's newest run, joined with what was seen at each place: the same for the same data. */
export function answerOf(
  report: KeyReport,
  run: PerfRecord[],
  baseline: Baseline | undefined,
  seen: Record<string, Seen> = {},
  reference?: Reference,
): GateAnswer {
  const { app, scenario, deviceClass } = report;
  const device = run[0]?.device;
  const held = baselineOf(baseline);
  const findings = [...placesOf(report.comparisons)].map(([place, worse]) =>
    findingOf(
      place,
      worse,
      baseline?.metrics[worse[0]!.kind]?.runs.length ?? 0,
      seen[place],
      reference,
    ),
  );
  return {
    schema: 1,
    app,
    scenario,
    deviceClass,
    status: statusOf(report),
    run: report.run,
    at: report.at,
    ...(device && { device: { model: device.model, os: device.os, virtual: device.virtual } }),
    ...(held && { baseline: held }),
    findings,
    notes: notesOf(report),
  };
}
