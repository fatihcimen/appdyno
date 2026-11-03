// False alarms and catches of the gate's run-to-run floor, on simulated launches: the numbers docs/perf.md quotes.
// Needs a build: pnpm --filter @appdyno/perf build; then node scripts/perf-floor-sim.mjs
import { median, rankTest, shift } from '../packages/perf/dist/index.js';

let seed = 7;
const r = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
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
  for (const [name, floorOf] of [
    ['range', (m) => Math.max(...m) - Math.min(...m)],
    ['2*range', (m) => 2 * (Math.max(...m) - Math.min(...m))],
    ['3sd', (m) => 3 * sd(m)],
    ['4sd', (m) => 4 * sd(m)],
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
