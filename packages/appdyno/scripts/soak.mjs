// Soak: reads, taps, typing and screenshots on the fixture app for <minutes>, sampling the agent's RSS.
// Usage: node scripts/soak.mjs <serial> <minutes>  (build first; one device; a quiet machine)
import { Adb, AndroidDevice, stats } from '../dist/index.js';

const [serial, minutesArg] = process.argv.slice(2);
if (!serial) {
  console.error('usage: soak.mjs <serial> <minutes>');
  process.exit(2);
}
const APP = 'dev.appdyno.fixture';
const adb = new Adb();
const d = new AndroidDevice(serial, adb);
const hello = await d.open();
const end = Date.now() + Number(minutesArg ?? 30) * 60_000;
const rss = async () =>
  Number(
    /VmRSS:\s+(\d+)/.exec(await adb.exec(serial, `cat /proc/${d.hello.pid}/status`))?.[1] ?? NaN,
  );
const samples = [{ at: 0, rssKb: await rss() }];
const ms = { read: [], tap: [], type: [], shot: [] };
const failures = [];
let i = 0;
const timed = async (k, fn) => {
  const t = performance.now();
  try {
    await fn();
    ms[k].push(performance.now() - t);
  } catch (e) {
    failures.push(`${k}: ${e.code ?? ''} ${e.message}`);
  }
};
await adb.exec(serial, `am start -W -a android.intent.action.VIEW -d appdyno-fixture://open/form ${APP}`);
const start = Date.now();
while (Date.now() < end) {
  const s = await d.read(APP).catch(() => undefined);
  await timed('read', () => d.read(APP));
  const field = s?.list.find((e) => e.id === 'name_input');
  if (field) {
    await timed('tap', () => d.tap(field, { settle: { quietMs: 200, maxMs: 3000 }, read: 'hash' }));
    await timed('type', () =>
      d.typeText(`Sample ${i} çğış`, { at: field, replace: true, settle: false }),
    );
  }
  if (i % 10 === 0) await timed('shot', () => d.screenshot({ maxPx: 1024 }));
  if (i % 50 === 0)
    samples.push({ at: Math.round((Date.now() - start) / 1000), rssKb: await rss() });
  i++;
}
samples.push({ at: Math.round((Date.now() - start) / 1000), rssKb: await rss() });
d.close();
const growth = (samples.at(-1).rssKb - samples[1]?.rssKb) / samples[1]?.rssKb;
console.log(
  JSON.stringify(
    {
      pid: hello.pid,
      iterations: i,
      seconds: Math.round((Date.now() - start) / 1000),
      ops: Object.fromEntries(
        Object.entries(ms).map(([k, v]) => [
          k,
          stats(v, failures.filter((f) => f.startsWith(k)).length),
        ]),
      ),
      failures: failures.slice(0, 20),
      rssKb: samples,
      rssGrowthAfterWarmup: Math.round(growth * 1000) / 10,
    },
    null,
    2,
  ),
);
