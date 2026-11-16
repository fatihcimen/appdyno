// What a tap costs on iOS beside a part of the screen that never stops moving: on the fixture's carousel and banner
// screens and on a still one, the time of each tap and whether its settle ended settled.
// Usage: node scripts/ios-cycling-proof.mjs <simulator id> [n]     APPDYNO_SIM_DIRECT=off: by the runner alone
import { buildScreen } from '@appdyno/core';
import { IosSimulatorDevice } from '@appdyno/driver-apple';
import { answered } from './timed.mjs';

const [udid, nArg] = process.argv.slice(2);
if (!udid) {
  console.error('usage: ios-cycling-proof.mjs <simulator id> [n]');
  process.exit(2);
}
const n = Number(nArg ?? 10);
const APP = 'dev.appdyno.fixture';
const d = new IosSimulatorDevice(udid);
const pause = (/** @type {number} */ ms) => new Promise((x) => setTimeout(x, ms));
const median = (/** @type {number[]} */ ms) => [...ms].sort((a, b) => a - b)[ms.length >> 1];
/** @type {Record<string, unknown>} */
const out = {};
try {
  await d.open();
  await d.terminate(APP);
  await d.launch(APP);
  for (const { name, id } of [
    { name: 'copies_carousel', id: 'carousel_tap' },
    { name: 'copies_banner', id: 'dup_close' },
    { name: 'late', id: 'late_0' },
  ]) {
    await d.openUrl(`appdyno-fixture://open/${name}`, APP);
    await pause(1_500);
    /** @type {number[]} */
    const ms = [];
    let settled = 0;
    for (let i = 0; i < n; i++) {
      const s = buildScreen(await d.tree(), { port: d.platformScreen, appId: APP });
      const e = s.list.find((x) => x.id === id);
      if (!e) throw new Error(`no ${id} on ${name}: ${s.list.map((x) => x.id).join(', ')}`);
      const t = performance.now();
      const r = answered(await d.tap(e, { settle: {}, read: 'hash', before: s.hash }));
      ms.push(Math.round(performance.now() - t));
      if (r.settle.settled) settled++;
      // as a caller that thinks between two taps, and as a script that does not
      await pause(i % 2 ? 4_000 : 300);
    }
    out[name] = { first: ms[0], median: median(ms), settled, n, ms };
    console.error(name, JSON.stringify(out[name]));
  }
  // what the slides taught must cost no other answer: a push away from them, and a late line on another screen
  const read = async () => buildScreen(await d.tree(), { port: d.platformScreen, appId: APP });
  /** @param {string} id */
  const tapped = async (id) => {
    const s = await read();
    const e = s.list.find((x) => x.id === id);
    if (!e) throw new Error(`no ${id}: ${s.list.map((x) => x.id).join(', ')}`);
    const r = answered(await d.tap(e, { settle: {}, read: 'tree', before: s.hash }));
    return buildScreen(r.tree, { port: d.platformScreen, appId: APP }).list;
  };
  let pushes = 0;
  /** @type {Record<number, number>} */
  const late = {};
  for (let i = 0; i < n; i++) {
    await d.openUrl('appdyno-fixture://open/copies_carousel', APP);
    await pause(800);
    await tapped('carousel_tap');
    if ((await tapped('BackButton')).some((e) => e.id === 'carousel_tap')) pushes++;
    await d.openUrl('appdyno-fixture://open/late', APP);
    await pause(800);
    for (const delay of [0, 100, 300, 450, 700]) {
      if (!(await tapped(`late_${delay}`)).some((e) => e.label === `Tepki ${delay}`))
        late[delay] = (late[delay] ?? 0) + 1;
      await pause(delay + 300);
      const clear = (await read()).list.find((e) => e.id === 'late_clear');
      if (clear) await d.tap(clear, { settle: false });
    }
  }
  out.after = { n, pushesMissed: pushes, lateMissed: late };
  console.error('after the slides', JSON.stringify(out.after));
} finally {
  await d.stopAgent();
}
console.log(JSON.stringify(out));
