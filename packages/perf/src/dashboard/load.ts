import type { GateAnswer } from '../answer.js';
import type { Baseline, BudgetRule } from '../compare.js';
import type { PerfRecord } from '../record.js';
import {
  loadAnswer,
  loadBaseline,
  loadBudgets,
  loadRefusals,
  readRun,
  runFiles,
  runKeys,
  type Refusal,
  type RunKey,
} from '../store.js';
import { UNIT_STEPS } from './format.js';

/** What a trend shows of a key: reading more only slows every kept run down. */
export const SHOWN_RUNS = 30;

export type KeyRuns = {
  key: RunKey;
  /** Newest first, at most SHOWN_RUNS. */
  runs: PerfRecord[][];
  /** How many runs the store holds of this key. */
  total: number;
  baseline?: Baseline;
  /** What `perf why` kept last, of whichever run that was. */
  answer?: GateAnswer;
};

export type DashboardData = {
  /** The moment ages are counted from. */
  now: string;
  /** The app asked for, when only one was. */
  app?: string;
  keys: KeyRuns[];
  rules: BudgetRule[];
  refusals: Refusal[];
  /** What could not be read, in words; the rest of the page still holds. */
  unread: string[];
};

const usable = (r: PerfRecord) =>
  typeof r?.kind === 'string' &&
  typeof r.device?.platform === 'string' &&
  Number.isFinite(r.value) &&
  Array.isArray(r.samples) &&
  r.samples.length > 0 &&
  r.samples.every(Number.isFinite) &&
  Array.isArray(r.noise) &&
  Number.isFinite(Date.parse(r.at)) &&
  Object.hasOwn(UNIT_STEPS, r.unit);

const usableAnswer = (a: GateAnswer | undefined) =>
  Array.isArray(a?.notes) &&
  Array.isArray(a?.findings) &&
  a.findings.every((f) =>
    [f?.worse, f?.causes, f?.evidence, f?.cannot].every((list) => Array.isArray(list)),
  );

/** What the page shows from the store, and no more; a file half written or edited by hand is no reason to fail. */
export async function loadDashboard(
  dir: string,
  projectDir: string,
  filter: { app?: string } = {},
): Promise<DashboardData> {
  const unread: string[] = [];
  const attempt = async <T>(what: string, read: () => Promise<T>, otherwise: T) => {
    try {
      return await read();
    } catch (e) {
      unread.push(`${what}: ${(e as Error).message}`);
      return otherwise;
    }
  };
  const loadKey = async (key: RunKey): Promise<KeyRuns> => {
    const files = await attempt(`runs of ${key.scenario}`, () => runFiles(dir, key), []);
    const runs = await Promise.all(
      files
        .slice(-SHOWN_RUNS)
        .reverse()
        .map((f) => attempt(f, () => readRun(dir, key, f), [])),
    );
    const baseline = await attempt(
      `baseline of ${key.scenario}`,
      () => loadBaseline(projectDir, key),
      undefined,
    );
    const answer = await attempt(
      `answer of ${key.scenario}`,
      () => loadAnswer(dir, key),
      undefined,
    );
    return {
      key,
      runs: runs
        .map((run) => (Array.isArray(run) ? run.filter(usable) : []))
        .filter((run) => run.length > 0),
      total: files.length,
      ...(baseline && { baseline }),
      ...(usableAnswer(answer) && { answer: answer! }),
    };
  };
  const keys: KeyRuns[] = [];
  // a key at a time: a large store must not hold thousands of files open at once
  for (const key of await attempt('runs', () => runKeys(dir, filter), [])) {
    const loaded = await loadKey(key);
    if (loaded.runs.length > 0) keys.push(loaded);
  }
  const [rules, refusals] = await Promise.all([
    attempt('budgets', () => loadBudgets(projectDir), []),
    attempt('refusals', () => loadRefusals(dir), []),
  ]);
  return {
    now: new Date().toISOString(),
    ...(filter.app && { app: filter.app }),
    keys,
    rules,
    refusals: refusals.filter(
      (r) =>
        typeof r?.reason === 'string' &&
        typeof r.deviceClass === 'string' &&
        Number.isFinite(Date.parse(r.at)),
    ),
    unread,
  };
}
