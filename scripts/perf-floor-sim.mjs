// False alarms and catches of the gate's floors, on simulated launches and counts: the numbers docs/reference/perf.md quotes.
// Needs a build: pnpm --filter '@appdyno/perf...' build; then node scripts/perf-floor-sim.mjs
import { compareMetric, FLOOR, median, rankTest, seededRandom, shift } from '@appdyno/perf';

const r = seededRandom(7);
const g = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
/**
 * @param {number} c
 * @param {number} n
 * @param {number} rs
 * @param {number} s
 */
const run = (c, n, rs, s) => {
  const lv = c * (1 + rs * g());
  return Array.from({ length: n }, () => Math.round(lv * (1 + s * Math.abs(g()))));
};
/** @param {number[]} xs */
const sd = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const trials = 400;
/** @type {[number, number][]} */
const SPREADS = [
  [0.02, 3],
  [0.06, 3],
  [0.1, 3],
  [0.06, 5],
  [0.1, 5],
  [0.06, 8],
  [0.1, 8],
];
/** @type {{ name: string; floorOf: (m: number[]) => number }[]} */
const FLOORS = [
  { name: 'range', floorOf: (m) => Math.max(...m) - Math.min(...m) },
  { name: '2*range', floorOf: (m) => 2 * (Math.max(...m) - Math.min(...m)) },
  { name: '3sd', floorOf: (m) => 3 * sd(m) },
  { name: '4sd', floorOf: (m) => 4 * sd(m) },
];
for (const [runSd, k] of SPREADS) {
  /** @type {string[]} */
  const row = [];
  for (const { name, floorOf } of FLOORS) {
    let fa = 0,
      hit20 = 0,
      hit40 = 0;
    for (let i = 0; i < trials; i++) {
      const base = Array.from({ length: k }, () => run(1000, 6, runSd, 0.05));
      const pooled = base.flat();
      const medians = base.map(median);
      const floor = Math.max(150, floorOf(medians));
      /** @param {number[]} x */
      const call = (x) => Math.abs(shift(pooled, x)) > floor && rankTest(pooled, x, 2000) < 0.01;
      if (call(run(1000, 6, runSd, 0.05))) fa++;
      if (call(run(1200, 6, runSd, 0.05))) hit20++;
      if (call(run(1400, 6, runSd, 0.05))) hit40++;
    }
    row.push(
      `${name}: fa ${((fa / trials) * 100).toFixed(1)}% +20% ${((hit20 / trials) * 100).toFixed(0)}% +40% ${((hit40 / trials) * 100).toFixed(0)}%`,
    );
  }
  console.log(`runSd ${runSd} k ${k} | ${row.join(' | ')}`);
}

// What a count comes to at each absolute floor, by the gate itself: how often an unchanged count stops a gate, and how
// often a real rise passes it. Counts are small and whole, with a rise of 1 from none the case that matters most.
/** @param {number} rate */
const poisson = (rate) => {
  if (rate === 0) return 0;
  const limit = Math.exp(-rate);
  let k = 0;
  for (let p = r(); p > limit; p *= r()) k++;
  return k;
};
/**
 * @param {number} rate
 * @param {number} n
 * @param {number} plus
 */
const counts = (rate, n, plus) => Array.from({ length: n }, () => poisson(rate) + plus);
/**
 * @param {number} rate
 * @param {number} plus
 * @param {number} n
 * @param {number} runs
 */
const verdictOf = (rate, plus, n, runs) => {
  const build = /** @type {const} */ ('release');
  /** @param {number} i */
  const run = (i) => ({ at: String(i), samples: counts(rate, n, 0), build, noise: [] });
  const base = {
    unit: /** @type {const} */ ('count'),
    better: /** @type {const} */ ('lower'),
    runs: Array.from({ length: runs }, (_, i) => run(i)),
  };
  const now = { samples: counts(rate, n, plus), build, noise: [] };
  return compareMetric('count', now, base, 'count', 'lower').verdict;
};
/** @type {[string, number][]} */
const CHANGES = [
  ['unchanged', 0],
  ['+1', 1],
];
/**
 * The verdicts a row shows, each by its first letter.
 * @type {import('@appdyno/perf').Verdict[]}
 */
const SHOWN = ['ok', 'few-samples', 'regression', 'improvement'];
for (const n of [1, 5]) {
  for (const [title, plus] of CHANGES) {
    for (const rate of [0, 0.1, 0.5, 1, 2, 3, 5, 10]) {
      /** @type {string[]} */
      const row = [];
      for (const absolute of [1, 0.75, 0.5, 0.25]) {
        FLOOR.count.absolute = absolute;
        /** @type {Record<import('@appdyno/perf').Verdict, number>} */
        const seen = {
          ok: 0,
          'few-samples': 0,
          regression: 0,
          improvement: 0,
          noisy: 0,
          refused: 0,
          new: 0,
        };
        for (let i = 0; i < trials; i++) seen[verdictOf(rate, plus, n, 3)]++;
        /** @param {import('@appdyno/perf').Verdict} v */
        const of = (v) => `${v.charAt(0)} ${((seen[v] / trials) * 100).toFixed(0)}%`;
        row.push(`${absolute}: ${SHOWN.map(of).join(' ')}`);
      }
      console.log(`${n} a run, rate ${rate}, ${title} | ${row.join(' | ')}`);
    }
  }
}

// The gate itself on launches, by verdict: an unchanged run, and one 20 % and 40 % slower. `tail` is a launch's chance of
// taking 1.5 to 3 times as long, as a simulator's do now and then. ok and improvement pass; noisy and regression stop.
/**
 * @param {number} c
 * @param {number} runSd
 * @param {number} tail
 */
const launches = (c, runSd, tail) =>
  run(c, 6, runSd, 0.05).map((x) => (r() < tail ? Math.round(x * (1.5 + 1.5 * r())) : x));
/** @type {[number, number, number][]} */
const GATED = [
  [0.02, 3, 0],
  [0.06, 3, 0],
  [0.1, 3, 0],
  [0.06, 5, 0],
  [0.06, 8, 0],
  [0.06, 3, 0.1],
  [0.06, 5, 0.1],
];
/** @type {[string, number][]} */
const SLOWER = [
  ['unchanged', 1000],
  ['+20%', 1200],
  ['+40%', 1400],
];
/** @type {import('@appdyno/perf').Verdict[]} */
const CALLED = ['ok', 'noisy', 'regression', 'improvement'];
for (const [runSd, k, tail] of GATED) {
  /** @type {string[]} */
  const row = [];
  for (const [title, c] of SLOWER) {
    /** @type {Record<import('@appdyno/perf').Verdict, number>} */
    const seen = {
      ok: 0,
      'few-samples': 0,
      regression: 0,
      improvement: 0,
      noisy: 0,
      refused: 0,
      new: 0,
    };
    const build = /** @type {const} */ ('release');
    for (let i = 0; i < trials; i++) {
      /** @param {number} j */
      const kept = (j) => ({
        at: String(j),
        samples: launches(1000, runSd, tail),
        build,
        noise: [],
      });
      const base = {
        unit: /** @type {const} */ ('ms'),
        better: /** @type {const} */ ('lower'),
        runs: Array.from({ length: k }, (_, j) => kept(j)),
      };
      const now = { samples: launches(c, runSd, tail), build, noise: [] };
      seen[compareMetric('launch', now, base, 'ms', 'lower').verdict]++;
    }
    /** @param {import('@appdyno/perf').Verdict} v */
    const of = (v) => `${v.charAt(0)} ${((seen[v] / trials) * 100).toFixed(1)}%`;
    row.push(`${title}: ${CALLED.map(of).join(' ')}`);
  }
  console.log(`launches, runSd ${runSd} k ${k} tail ${tail} | ${row.join(' | ')}`);
}
