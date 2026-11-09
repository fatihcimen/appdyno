import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GateAnswer, Reference } from './answer.js';
import type { Baseline, BudgetRule } from './compare.js';
import { keyName, type MeasureId, type PerfRecord } from './record.js';

export const newId = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex')}`;

/**
 * A measurement's values and the raw tool output they came from, under `dir`: the id and the files. Nothing
 * leaves the machine.
 */
export async function store(dir: string, kind: string, value: unknown, raw: string) {
  const id = newId('pm');
  await mkdir(dir, { recursive: true });
  const json = join(dir, `${id}.json`);
  const txt = join(dir, `${id}.txt`);
  await writeFile(json, JSON.stringify({ id, kind, at: new Date().toISOString(), value }, null, 2));
  await writeFile(txt, raw);
  return { id, json, txt };
}

const MEASUREMENT = /^pm-[0-9a-f]{8}$/;

type Measurement = { id: string; kind: string; at: string; value: unknown };

/**
 * A kept measurement by the id its answer gave; none for anything else, which goes no further than this folder. Its
 * value is what its kind wrote, which the caller that knows the kind says.
 */
export async function loadMeasurement(dir: string, id: string): Promise<Measurement | undefined> {
  if (!MEASUREMENT.test(id)) return undefined;
  const file = join(dir, `${id}.json`);
  return existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as Measurement) : undefined;
}

export type RunKey = { app: string; scenario: string; deviceClass: string };

const runsDir = (dir: string, k: RunKey) => join(dir, 'runs', k.app, k.scenario, k.deviceClass);

/** A run's records: one file per run, its name sorted by time. */
export async function saveRun(dir: string, records: PerfRecord[]): Promise<string | undefined> {
  const first = records[0];
  if (!first) return undefined;
  const file = join(runsDir(dir, first), `${first.at.replace(/[:.]/g, '-')}-${first.run}.json`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(records, null, 2));
  return file;
}

const list = async (d: string) => (existsSync(d) ? (await readdir(d)).sort() : []);

/** Every app, scenario and device class with runs, narrowed by what is given. */
export async function runKeys(dir: string, f: Partial<RunKey> = {}): Promise<RunKey[]> {
  const out: RunKey[] = [];
  const root = join(dir, 'runs');
  for (const app of f.app ? [f.app] : await list(root))
    for (const scenario of f.scenario ? [f.scenario] : await list(join(root, app)))
      for (const deviceClass of await list(join(root, app, scenario)))
        if (!f.deviceClass || f.deviceClass === deviceClass)
          out.push({ app, scenario, deviceClass });
  return out;
}

/** A key's run files, oldest first. */
export const runFiles = async (dir: string, k: RunKey) =>
  (await list(runsDir(dir, k))).filter((f) => f.endsWith('.json'));

export const readRun = async (dir: string, k: RunKey, file: string) =>
  JSON.parse(await readFile(join(runsDir(dir, k), file), 'utf8')) as PerfRecord[];

/** The newest `last` runs of a key, newest first. */
export async function latestRuns(dir: string, k: RunKey, last = 1): Promise<PerfRecord[][]> {
  const files = (await runFiles(dir, k)).slice(-last).reverse();
  return Promise.all(files.map((f) => readRun(dir, k, f)));
}

/** A device saying it cannot give a measure, and why: the dashboard's answer until a reading is newer. */
export type Refusal = {
  deviceClass: string;
  measure: MeasureId;
  /** Whose: a phone may refuse a system app what it gives an app signed for development. */
  app?: string;
  reason: string;
  at: string;
};

const refusalFile = (dir: string, r: Pick<Refusal, 'deviceClass' | 'measure' | 'app'>) =>
  join(dir, 'refusals', r.deviceClass, `${r.app ? `${keyName(r.app)}.` : ''}${r.measure}.json`);

export async function saveRefusal(dir: string, r: Refusal): Promise<void> {
  const file = refusalFile(dir, r);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(r, null, 2));
}

/** The newest refusal of each device class, app and measure. */
export async function loadRefusals(dir: string): Promise<Refusal[]> {
  const root = join(dir, 'refusals');
  const out: Refusal[] = [];
  for (const deviceClass of await list(root))
    for (const f of await list(join(root, deviceClass)))
      if (f.endsWith('.json'))
        out.push(JSON.parse(await readFile(join(root, deviceClass, f), 'utf8')) as Refusal);
  return out;
}

const baselineFile = (projectDir: string, k: RunKey) =>
  join(projectDir, 'baselines', k.app, k.scenario, `${k.deviceClass}.json`);

export async function loadBaseline(projectDir: string, k: RunKey): Promise<Baseline | undefined> {
  const file = baselineFile(projectDir, k);
  if (!existsSync(file)) return undefined;
  return JSON.parse(await readFile(file, 'utf8')) as Baseline;
}

export async function saveBaseline(projectDir: string, b: Baseline): Promise<string> {
  const file = baselineFile(projectDir, b);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(b, null, 2)}\n`);
  return file;
}

const referenceFile = (projectDir: string, k: RunKey) =>
  join(projectDir, 'references', k.app, k.scenario, `${k.deviceClass}.json`);

/** Beside the baselines and committed with them: a baseline's other side, which that build alone could give. */
export async function saveReference(projectDir: string, r: Reference): Promise<string> {
  const file = referenceFile(projectDir, r);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(r, null, 2)}\n`);
  return file;
}

export async function loadReference(projectDir: string, k: RunKey): Promise<Reference | undefined> {
  const file = referenceFile(projectDir, k);
  return existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as Reference) : undefined;
}

const answerFile = (dir: string, k: RunKey) =>
  join(dir, 'answers', k.app, k.scenario, `${k.deviceClass}.json`);

/** The newest answer of a key: one file, as only the newest run's is ever read. */
export async function saveAnswer(dir: string, a: GateAnswer): Promise<void> {
  const file = answerFile(dir, a);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(a, null, 2));
}

export async function loadAnswer(dir: string, k: RunKey): Promise<GateAnswer | undefined> {
  const file = answerFile(dir, k);
  return existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as GateAnswer) : undefined;
}

/** A project's limits: `budgets.json`, a list of rules; none is fine. */
export async function loadBudgets(projectDir: string): Promise<BudgetRule[]> {
  const file = join(projectDir, 'budgets.json');
  if (!existsSync(file)) return [];
  const rules = JSON.parse(await readFile(file, 'utf8')) as unknown;
  if (
    !Array.isArray(rules) ||
    rules.some((r: { kind?: unknown } | null) => typeof r?.kind !== 'string')
  )
    throw new Error(`${file}: expected a list of rules, each with a "kind"`);
  return rules as BudgetRule[];
}

/** A rule kept in `budgets.json` in place of one of the same kind and scope, as a person would write it by hand. */
export async function saveBudget(projectDir: string, rule: BudgetRule): Promise<string> {
  const same = (b: BudgetRule) =>
    b.kind === rule.kind &&
    b.app === rule.app &&
    b.scenario === rule.scenario &&
    b.deviceClass === rule.deviceClass;
  const rules = [...(await loadBudgets(projectDir)).filter((b) => !same(b)), rule];
  await mkdir(projectDir, { recursive: true });
  const file = join(projectDir, 'budgets.json');
  await writeFile(file, `${JSON.stringify(rules, null, 2)}\n`);
  return file;
}
