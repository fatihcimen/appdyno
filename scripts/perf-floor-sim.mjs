// False alarms and catches of the gate's floors, on simulated launches and counts: the numbers docs/reference/perf.md quotes.
// Needs a build: pnpm --filter '@appdyno/perf...' build; then node scripts/perf-floor-sim.mjs
import { compareMetric, FLOOR, median, rankTest, seededRandom, shift } from '@appdyno/perf';

const r = seededRandom(7);
const g = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const run = (c, n, rs, s) => {
  const lv = c * (1 + rs * g());
  return Array.from({ length: n }, () => Math.round(lv * (1 + s * Math.abs(g()))));
};
const sd = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const trials = 400;
for (const [runSd, k] of [
  [0.02, 3],
  [0.06, 3],
  [0.1, 3],
  [0.06, 5],
  [0.1, 5],
  [0.06, 8],
  [0.1, 8],
]) {
  const row = [];
  for (const { name, floorOf } of [
    { name: 'range', floorOf: (m) => Math.max(...m) - Math.min(...m) },
    { name: '2*range', floorOf: (m) => 2 * (Math.max(...m) - Math.min(...m)) },
    { name: '3sd', floorOf: (m) => 3 * sd(m) },
    { name: '4sd', floorOf: (m) => 4 * sd(m) },
  ]) {
    let fa = 0,
      hit20 = 0,
      hit40 = 0;
    for (let i = 0; i < trials; i++) {
      const base = Array.from({ length: k }, () => run(1000, 6, runSd, 0.05));
      const pooled = base.flat();
      const medians = base.map(median);
      const floor = Math.max(150, floorOf(medians));
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
const poisson = (rate) => {
  if (rate === 0) return 0;
  const limit = Math.exp(-rate);
  let k = 0;
  for (let p = r(); p > limit; p *= r()) k++;
  return k;
};
const counts = (rate, n, plus) => Array.from({ length: n }, () => poisson(rate) + plus);
const verdictOf = (rate, plus, n, runs) => {
  const build = /** @type {const} */ ('release');
  const run = (i) => ({ at: String(i), samples: counts(rate, n, 0), build, noise: [] });
  const base = {
    unit: /** @type {const} */ ('count'),
    better: /** @type {const} */ ('lower'),
    runs: Array.from({ length: runs }, (_, i) => run(i)),
  };
  const now = { samples: counts(rate, n, plus), build, noise: [] };
  return compareMetric('count', now, base, 'count', 'lower').verdict;
};
for (const n of [1, 5]) {
  for (const [title, plus] of [
    ['unchanged', 0],
    ['+1', 1],
  ]) {
    for (const rate of [0, 0.1, 0.5, 1, 2, 3, 5, 10]) {
      const row = [];
      for (const absolute of [1, 0.75, 0.5, 0.25]) {
        FLOOR.count.absolute = absolute;
        const seen = { ok: 0, 'few-samples': 0, regression: 0, improvement: 0 };
        for (let i = 0; i < trials; i++) seen[verdictOf(rate, plus, n, 3)]++;
        const of = (v) => `${v[0]} ${((seen[v] / trials) * 100).toFixed(0)}%`;
        row.push(`${absolute}: ${Object.keys(seen).map(of).join(' ')}`);
      }
      console.log(`${n} a run, rate ${rate}, ${title} | ${row.join(' | ')}`);
    }
  }
}
