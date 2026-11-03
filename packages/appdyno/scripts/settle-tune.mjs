// Settle tuning on the fixture: for each quiet window, how often a late reaction (a line added N ms
// after the tap, nothing in between) is missed, and how long an unchanged screen and a navigation take.
// Usage: node scripts/settle-tune.mjs <serial> [n per cell]  (build first; a quiet machine)
import { buildScreen, stats } from '../dist/index.js';
import { APP, openFixture } from './settle-fixture.mjs';

const [serial, nArg] = process.argv.slice(2);
if (!serial) {
  console.error('usage: settle-tune.mjs <serial> [n]');
  process.exit(2);
}
const n = Number(nArg ?? 10);
const QUIETS = [100, 150, 200, 250];
const DELAYS = [0, 50, 100, 150, 200, 300, 450, 700];
const { adb, d, pause, read } = await openFixture(serial);
const open = async (screen) => {
  await adb.exec(
    serial,
    `am start -W -a android.intent.action.VIEW -d appdyno-fixture://open/${screen} ${APP}`,
  );
  await pause(1_200);
  return read();
};

const results = [];
let late = await open('late');
const button = (s, label) =>
  s.list.find((e) => e.label === label.toUpperCase() || e.label === label);
for (const quietMs of QUIETS) {
  const row = { quietMs, missed: {}, settleMs: {} };
  for (const delay of DELAYS) {
    let missed = 0;
    const ms = [];
    for (let i = 0; i < n; i++) {
      const clear = button(late, 'Clear');
      await d.tap(clear, { settle: { quietMs: 250, maxMs: 3_000 }, read: 'none' });
      await pause(300);
      late = await read();
      if (late.tree.nodes.some((x) => x.t?.startsWith('Tepki')))
        throw new Error('a reaction is still on the screen');
      const b = button(late, `${delay} ms`);
      const r = await d.tap(b, {
        settle: { quietMs, maxMs: 3_000 },
        read: 'tree',
        before: late.hash,
      });
      if (!r.tree.nodes.some((x) => x.t === `Tepki ${delay}`)) missed++;
      ms.push(r.settle.ms);
      await pause(delay + 300); // the reaction lands before the next clear
    }
    row.missed[delay] = missed;
    row.settleMs[delay] = stats(ms, 0).p50;
    console.error(
      `quiet ${quietMs} delay ${delay}: missed ${missed}/${n}, settle p50 ${row.settleMs[delay]} ms`,
    );
  }
  // an unchanged screen and a navigation at this quiet window
  const title = button(late, 'Clear');
  const unchanged = [];
  for (let i = 0; i < n; i++) {
    const before = await read();
    unchanged.push(
      (await d.tap(title, { settle: { quietMs, maxMs: 3_000 }, read: 'hash', before: before.hash }))
        .settle.ms,
    );
  }
  row.unchangedMs = stats(unchanged, 0);
  const nav = [];
  let wrong = 0;
  for (let i = 0; i < n; i++) {
    await adb.exec(serial, `am start -W -n ${APP}/.MainActivity -f 0x10008000`);
    await pause(1_200);
    const home = await read();
    const form = home.list.find((e) => e.label === 'FORM');
    const r = await d.tap(form, {
      settle: { quietMs, maxMs: 3_000 },
      read: 'tree',
      before: home.hash,
    });
    nav.push(r.settle.ms);
    // the settled read must be the form screen at its final place
    const s = buildScreen(r.tree, { platform: 'android', appId: APP });
    const later = await read();
    const key = (x) => x.list.map((e) => `${e.id ?? e.label}@${e.x},${e.y}`).join(' ');
    if (!s.list.some((e) => e.label === 'Enter your details') || key(s) !== key(later)) wrong++;
  }
  row.navigateMs = stats(nav, 0);
  row.navigateWrong = wrong;
  results.push(row);
  late = await open('late');
}
d.close();
console.log(JSON.stringify({ n, delays: DELAYS, results }, null, 2));
