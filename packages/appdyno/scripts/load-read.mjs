// Reads under load: the storefront screen (an auto-advancing carousel, a few hundred nodes) read <n>
// times while two device cores are kept busy and a screenshot is taken every second. Counts failed and
// truncated reads. Usage: node scripts/load-read.mjs <serial> [n]  (build first; a quiet host)
import { Adb, AndroidDevice, stats } from '../dist/index.js';

const [serial, nArg] = process.argv.slice(2);
if (!serial) {
  console.error('usage: load-read.mjs <serial> [n]');
  process.exit(2);
}
const n = Number(nArg ?? 500);
const APP = 'dev.appdyno.fixture';
const adb = new Adb();
const d = new AndroidDevice(serial, adb);
await d.open();
await adb.exec(
  serial,
  `am start -W -a android.intent.action.VIEW -d gdfixture://open/showcase ${APP}`,
);
await new Promise((r) => setTimeout(r, 1_500));
// two busy device cores (the emulator has four), stopped at the end; detached like the agent (a background
// process dies with a start session that ends at once)
const stress = await adb.startDetached(
  serial,
  "for i in 1 2; do setsid nohup sh -c 'while :; do :; done' > /dev/null 2>&1 < /dev/null & done",
);
await new Promise((r) => setTimeout(r, 3_000));
stress.close();
const vitalsBefore = (await d.measure.vitals()).value;
let shots = 0;
let shotFailures = 0;
const shooter = setInterval(() => {
  d.screenshot({ maxPx: 1024 }).then(
    () => shots++,
    () => shotFailures++,
  );
}, 1_000);
const ms = [];
let failed = 0;
let truncated = 0;
const errors = {};
try {
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    try {
      const tree = await d.tree();
      ms.push(performance.now() - t);
      if (tree.truncated) truncated++;
    } catch (e) {
      failed++;
      errors[e.code ?? 'ERROR'] = (errors[e.code ?? 'ERROR'] ?? 0) + 1;
    }
  }
  // navigations under the same load: the settled read must be the new screen at its final place
  var navWrong = 0;
  var navMs = [];
  for (let i = 0; i < 20; i++) {
    await adb.exec(serial, `am start -W -n ${APP}/.MainActivity -f 0x10008000`);
    await new Promise((r) => setTimeout(r, 1_500));
    const home = await d.read(APP);
    const form = home.list.find((e) => e.label === 'FORM');
    const r = await d.tap(form, {
      settle: { quietMs: 200, maxMs: 3_000 },
      read: 'tree',
      before: home.hash,
    });
    navMs.push(r.settle.ms);
    const now = await d.read(APP);
    const key = (x) => x.list.map((e) => `${e.id ?? e.label}@${e.x},${e.y}`).join(' ');
    const settled = await import('../dist/index.js').then((m) =>
      m.buildScreen(r.tree, { platform: 'android', appId: APP }),
    );
    if (!settled.list.some((e) => e.label === 'Enter your details') || key(settled) !== key(now))
      navWrong++;
  }
} finally {
  clearInterval(shooter);
  await adb.exec(serial, "pkill -f 'while :; do :; done'; true").catch(() => undefined);
}
const vitalsAfter = (await d.measure.vitals()).value;
d.close();
console.log(
  JSON.stringify(
    {
      reads: n,
      failed,
      failedPercent: Math.round((failed / n) * 1000) / 10,
      truncated,
      errors,
      latency: stats(ms, failed),
      navigations: 20,
      navigationsSettledWrong: navWrong,
      navigationSettleMs: stats(navMs, 0),
      screenshots: shots,
      screenshotFailures: shotFailures,
      deviceLoadBefore: vitalsBefore.load,
      deviceLoadAfter: vitalsAfter.load,
      cpuPressureAfter: vitalsAfter.cpuPressure,
    },
    null,
    2,
  ),
);
