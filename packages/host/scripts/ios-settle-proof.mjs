// What the settle window catches on iOS: taps on the late-reaction buttons (a line appears after the
// button's delay) and a navigation push, per window. A miss: the settle ended before the change.
// Usage: node scripts/ios-settle-proof.mjs <simulator id> [n] [windows ms, comma separated]
import { IosSimulatorDevice, buildScreen } from '../dist/index.js';

const [udid, nArg, windowsArg] = process.argv.slice(2);
const n = Number(nArg ?? 10);
const windows = (windowsArg ?? '200,500,800').split(',').map(Number);
const APP = 'dev.appdyno.fixture';
const d = new IosSimulatorDevice(udid);
const screen = async () => buildScreen(await d.tree(), { platform: 'ios', appId: APP });
const find = async (pred, what) => {
  for (let i = 0; i < 10; i++) {
    const s = await screen();
    const e = s.list.find(pred);
    if (e) return { s, e };
    await new Promise((x) => setTimeout(x, 300));
  }
  const s = await screen();
  throw new Error(`no ${what}: ${s.list.map((e) => `${e.label}|${e.id ?? ''}`).join(', ')}`);
};
const out = { n, windows: {} };
try {
  await d.open();
  await d.terminate(APP);
  await d.launch(APP);
  for (const quietMs of windows) {
    const settle = { quietMs, maxMs: 3_000 };
    const r = { late: {}, navigate: { missed: 0, ms: [] } };
    await d.openUrl('gdfixture://open/late', APP);
    await new Promise((x) => setTimeout(x, 800));
    for (const delay of [0, 100, 300, 450, 700]) {
      let missed = 0;
      for (let i = 0; i < n; i++) {
        await d.tap((await find((e) => e.id === 'late_clear', 'late_clear')).e, { settle: false });
        const { s, e } = await find((x) => x.id === `late_${delay}`, `late_${delay}`);
        const res = await d.tap(e, { settle, read: 'tree', before: s.hash });
        if (
          !buildScreen(res.tree, { platform: 'ios' }).list.some((e) => e.label === `Tepki ${delay}`)
        )
          missed++;
        await new Promise((x) => setTimeout(x, delay + 300)); // a missed reaction lands before the next trial
      }
      r.late[delay] = missed;
    }
    for (let i = 0; i < n; i++) {
      await d.terminate(APP);
      await d.launch(APP);
      await new Promise((x) => setTimeout(x, 800));
      const { s, e } = await find((x) => x.label === 'Form', 'Form');
      const t = performance.now();
      const res = await d.tap(e, { settle, read: 'tree', before: s.hash });
      r.navigate.ms.push(Math.round(performance.now() - t));
      if (!buildScreen(res.tree, { platform: 'ios' }).list.some((e) => e.id === 'name_input'))
        r.navigate.missed++;
    }
    out.windows[quietMs] = r;
    console.error(quietMs, JSON.stringify(r));
  }
} finally {
  await d.stopAgent();
}
console.log(JSON.stringify(out, null, 2));
