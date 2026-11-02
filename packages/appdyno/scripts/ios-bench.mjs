// Latency of the iOS runner on a simulator, on the fixture app: reads, tap acknowledgement, act-and-read
// (unchanged screen, new screen), typing 20 Turkish letters, screenshot, reconnect, cold start.
// Usage: node scripts/ios-bench.mjs <simulator id> [n]   (build first; a quiet host; prints JSON)
import { loadavg } from 'node:os';
import { IosSimulatorDevice, buildScreen, stats } from '../dist/index.js';

const [udid, nArg] = process.argv.slice(2);
if (!udid) {
  console.error('usage: ios-bench.mjs <simulator id> [n]');
  process.exit(2);
}
const n = Number(nArg ?? 30);
const APP = 'dev.appdyno.fixture';
const SETTLE = { quietMs: 200, maxMs: 3_000 };
const TEXT_20 = 'Çağrı İşgüzar Öğün Ş';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let d = new IosSimulatorDevice(udid);
const ops = {};
// APPDYNO_ONLY=read.home,tapRead.navigate runs only those operations (the others are skipped)
const only = process.env.APPDYNO_ONLY?.split(',');
const measure = async (name, count, fn, between) => {
  if (only && !only.includes(name)) return;
  const ms = [];
  let failed = 0;
  for (let i = 0; i < count + 3; i++) {
    const t = performance.now();
    try {
      await fn();
      if (i >= 3) ms.push(performance.now() - t);
    } catch (e) {
      if (i >= 3) failed++;
      console.error(`${name}: ${e.message}`);
    }
    if (between) await between();
  }
  ops[name] = stats(ms, failed);
  console.error(`${name}: ${JSON.stringify(ops[name])}`);
};
const screen = async () => buildScreen(await d.tree(), { platform: 'ios', appId: APP });
const find = async (pred) => {
  for (let i = 0; i < 10; i++) {
    const e = (await screen()).list.find(pred);
    if (e) return e;
    await pause(300);
  }
  throw new Error('not on the screen');
};
const home = async () => {
  await d.terminate(APP);
  await d.launch(APP);
  await pause(1_000);
};
const before = { at: new Date().toISOString(), hostLoad: loadavg().map((x) => +x.toFixed(2)) };
try {
  await d.open();
  await home();
  await measure('read.home', n, () => d.tree());
  await d.openUrl('gdfixture://open/list', APP);
  await pause(800);
  await measure('read.list', n, () => d.tree());
  await home();
  const title = await find((e) => e.label === 'appdyno fixture');
  await measure('tap.ack', n, () => d.tap(title, { settle: false }));
  let hash = (await screen()).hash;
  await measure('tapRead.unchanged', n, async () => {
    const r = await d.tap(title, { settle: SETTLE, read: 'tree', before: hash });
    hash = r.tree.hash;
  });
  // the screen is read before the timer starts (the first read after a launch is slow, measured apart)
  let nav = await screen();
  await measure(
    'tapRead.navigate',
    Math.min(n, 20),
    async () => {
      const form = nav.list.find((e) => e.label === 'Form');
      if (!form) throw new Error('no Form button');
      const r = await d.tap(form, { settle: SETTLE, read: 'tree', before: nav.hash });
      if (process.env.APPDYNO_DEBUG) console.error('navigate settle', JSON.stringify(r.settle));
      if (!buildScreen(r.tree, { platform: 'ios' }).list.some((e) => e.id === 'name_input'))
        throw new Error('settled before the form');
    },
    async () => {
      await home();
      nav = await screen();
    },
  );
  // the first read after the app starts
  await measure('read.afterLaunch', 10, () => d.tree(), home);
  await d.openUrl('gdfixture://open/form', APP);
  await pause(800);
  const field = await find((e) => e.id === 'name_input');
  await measure('type.20tr', n, async () => {
    const r = await d.typeText(TEXT_20, { at: field, replace: true, settle: false });
    if (!r.verified) throw new Error('not verified');
  });
  await home();
  // a shared simulator: few screenshots, spaced out (10 + 3 warm-up, 500 ms apart)
  await measure(
    'screenshot',
    10,
    () => d.screenshot({ format: 'jpeg', quality: 80, maxPx: 1024 }),
    () => pause(500),
  );
  await measure('reconnect', Math.min(n, 20), async () => {
    d.close();
    d = new IosSimulatorDevice(udid);
    await d.tree();
  });
  await measure('coldStart', 3, async () => {
    await d.stopAgent();
    d = new IosSimulatorDevice(udid);
    await d.tree();
  });
} finally {
  await d.stopAgent().catch(() => undefined);
}
console.log(
  JSON.stringify(
    {
      udid,
      n,
      before,
      after: { at: new Date().toISOString(), hostLoad: loadavg().map((x) => +x.toFixed(2)) },
      ops,
    },
    null,
    2,
  ),
);
