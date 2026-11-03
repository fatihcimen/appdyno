import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Baseline, BudgetRule } from './compare.js';
import type { PerfRecord } from './record.js';

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

/** The newest `last` runs of a key, newest first. */
export async function latestRuns(dir: string, k: RunKey, last = 1): Promise<PerfRecord[][]> {
  const d = runsDir(dir, k);
  const files = (await list(d))
    .filter((f) => f.endsWith('.json'))
    .slice(-last)
    .reverse();
  return Promise.all(
    files.map(async (f) => JSON.parse(await readFile(join(d, f), 'utf8')) as PerfRecord[]),
  );
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

/** A project's limits: `budgets.json`, a list of rules; none is fine. */
export async function loadBudgets(projectDir: string): Promise<BudgetRule[]> {
  const file = join(projectDir, 'budgets.json');
  if (!existsSync(file)) return [];
  const rules = JSON.parse(await readFile(file, 'utf8')) as unknown;
  if (!Array.isArray(rules) || rules.some((r: BudgetRule) => typeof r?.kind !== 'string'))
    throw new Error(`${file}: expected a list of rules, each with a "kind"`);
  return rules as BudgetRule[];
}
