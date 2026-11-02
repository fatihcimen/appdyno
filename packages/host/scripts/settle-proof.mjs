// Proof of the settle: late reactions to an actionable tap (0–300 ms after it) and a 30 ms touch reaction
// on a non-clickable view are never missed; an unchanged screen ends quickly on an inert target.
// Usage: node scripts/settle-proof.mjs <serial> [n]  (build first; a quiet machine)
import { Adb, AndroidDevice, buildScreen, stats } from '../dist/index.js';

const [serial, nArg] = process.argv.slice(2);
if (!serial) {
  console.error('usage: settle-proof.mjs <serial> [n]');
  process.exit(2);
}
const n = Number(nArg ?? 50);
const APP = 'dev.appdyno.fixture';
const SETTLE = { quietMs: Number(process.env.QUIET ?? 200), maxMs: 3_000 };
const DELAYS = (process.env.DELAYS ?? '0,50,100,150,200,300').split(',').map(Number);
const adb = new Adb();
const d = new AndroidDevice(serial, adb);
await d.open();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const read = async () => buildScreen(await d.tree(), { platform: 'android', appId: APP });
await adb.exec(serial, `am start -W -a android.intent.action.VIEW -d gdfixture://open/late ${APP}`);
await pause(1_500);
let late = await read();
const find = (s, label) =>
  s.list.find((e) => e.label === label.toUpperCase() || e.label === label || e.id === label);
const clean = async () => {
  await d.tap(find(late, 'Clear'), { settle: SETTLE, read: 'none' });
  await pause(200);
  late = await read();
  if (late.tree.nodes.some((x) => x.t?.startsWith('Tepki') || x.t === 'Touch reaction'))
    throw new Error('not clean');
};
const out = { n, quietMs: SETTLE.quietMs, actionable: {}, touch: {}, unchanged: {} };
for (const delay of DELAYS) {
  let missed = 0;
  const ms = [];
  for (let i = 0; i < n; i++) {
    await clean();
    const r = await d.tap(find(late, `${delay} ms`), {
      settle: SETTLE,
      read: 'tree',
      before: late.hash,
    });
    if (!r.tree.nodes.some((x) => x.t === `Tepki ${delay}`)) missed++;
    ms.push(r.settle.ms);
    await pause(delay + 200);
  }
  out.actionable[delay] = { missed, settle: stats(ms, 0) };
  console.error(`actionable ${delay} ms: missed ${missed}/${n}`);
}
{
  let missed = 0;
  const ms = [];
  const quiet = [];
  for (let i = 0; i < n; i++) {
    await clean();
    const r = await d.tap(find(late, 'Touch area'), {
      settle: SETTLE,
      read: 'tree',
      before: late.hash,
    });
    if (!r.tree.nodes.some((x) => x.t === 'Touch reaction')) missed++;
    ms.push(r.settle.ms);
    quiet.push(r.settle.quietMs);
    await pause(200);
  }
  out.touch = { missed, settle: stats(ms, 0), quietMs: [...new Set(quiet)] };
  console.error(`touch 30 ms on a non-clickable view: missed ${missed}/${n}`);
}
await clean();
for (const [name, label] of [
  ['inert (empty space)', undefined],
  ['actionable (nothing to clear)', 'Clear'],
]) {
  const ms = [];
  const quiet = [];
  for (let i = 0; i < n; i++) {
    const before = await read();
    const t = label
      ? find(before, label)
      : { x: before.window.w / 2, y: Math.round(before.window.h * 0.85) };
    const r = await d.tap(t, { settle: SETTLE, read: 'hash', before: before.hash });
    ms.push(r.settle.ms);
    quiet.push(r.settle.quietMs);
  }
  out.unchanged[name] = { ...stats(ms, 0), quietMs: [...new Set(quiet)] };
  console.error(`unchanged ${name}: ${JSON.stringify(out.unchanged[name])}`);
}
d.close();
console.log(JSON.stringify(out, null, 2));
