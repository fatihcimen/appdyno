import { it } from 'vitest';
import { AndroidDevice } from 'appdyno';

it.skipIf(!process.env.APPDYNO_DEBUG)('debug', async () => {
  const d = new AndroidDevice(process.env.APPDYNO_ANDROID_SERIAL!);
  await d.open();
  await d.shell('am start -W -n dev.appdyno.fixture/.MainActivity -f 0x10008000');
  await new Promise((r) => setTimeout(r, 1500));
  const home = await d.read('dev.appdyno.fixture');
  const r = await d.tap(
    home.list.find((e) => e.label === 'SAYAÇ')!,
    { settle: { quietMs: 250, maxMs: 3000 }, read: 'tree', before: home.hash },
  );
  console.log('open ticker settle', JSON.stringify(r.settle));
  const hs = [];
  for (let i = 0; i < 5; i++) hs.push((await d.tree()).hash);
  console.log('ticker hashes', JSON.stringify(hs));
  const a = await d.tree();
  await new Promise((x) => setTimeout(x, 300));
  const b = await d.tree();
  const key = (n: (typeof a.nodes)[number]) =>
    `${n.w}|${n.c}|${n.id ?? ''}|${n.b.join(',')}|${n.f}`;
  const A = new Set(a.nodes.map(key));
  const B = new Set(b.nodes.map(key));
  console.log(
    'only a',
    JSON.stringify([...A].filter((x) => !B.has(x))),
    'only b',
    JSON.stringify([...B].filter((x) => !A.has(x))),
  );
  console.log('windows', JSON.stringify(b.windows));
  d.close();
});
