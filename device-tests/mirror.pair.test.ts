import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest';
import { androidProvider, iphoneProvider, simulatorProvider, type WireNode } from './workspace.js';
import { viewerBinary, ViewerProcess, type Device } from '../packages/core/src/index.js';
import { NODE_FLAGS } from '../packages/protocol/src/index.js';
import { DEFAULT_POLICY, ServerContext } from '../packages/ops/src/index.js';
import { runHub } from '../packages/hub/src/index.js';
import { Parent } from '../packages/hub/src/parent.js';
import { liveMirror } from '../packages/ops/src/mirror-state.js';
import { untilWithin } from './until.js';

/**
 * Two windows as one hand, on two devices we hold with the fixture on them (APPDYNO_PAIR=A,B; never a default): real
 * windows kept off every screen, driven by their own events, with each step read back from each device itself. A window
 * the hub opens is a process of its own, from what is built, so build first. APPDYNO_SHOTS names a folder for pictures.
 */
const serials = process.env.APPDYNO_PAIR?.split(',') ?? [];
const main = join(import.meta.dirname, '../packages/appdyno/dist/main.js');
const APP = 'dev.appdyno.fixture';
const FORM = 'appdyno-fixture://open/form';
const LIST = 'appdyno-fixture://open/list';
const MS = 20_000;
const LONG_MS = 300_000;

const until = untilWithin(MS);

const has = (n: WireNode, name: string) => n.id?.split('/').pop() === name;

describe.runIf(serials.length === 2)('two windows as one hand', () => {
  const held = new Map<string, Device>();
  const ctx = new ServerContext(
    { ...DEFAULT_POLICY, devices: new RegExp(`^(${serials.join('|')})$`) },
    [androidProvider(), simulatorProvider(), iphoneProvider()].map((provider) => ({
      ...provider,
      // one driver object on a device: a second would be a second agent on it
      open: (serial: string) => {
        const own = held.get(serial) ?? provider.open(serial);
        held.set(serial, own);
        return own;
      },
    })),
    {
      mirrorCommand: [process.execPath, main, 'mirror'],
      perf: mkdtempSync(join(tmpdir(), 'pair-')),
    },
  );
  const [a, b] = serials as [string, string];
  const parent = new Parent(ctx, {
    serials,
    max: 2,
    options: { quality: 'auto' },
    headless: false,
    behind: true,
    pair: true,
    noInput: false,
    focus: false,
    inputOnClick: false,
    log: () => undefined,
  });
  const told = new Map<string, Record<string, unknown>[]>();
  const device = (serial: string) => ctx.deviceFor(serial);
  const session = (serial: string) => {
    const s = parent.sessions.get(serial);
    assert(s, `a window on ${serial}`);
    return s;
  };
  const toldOf = (serial: string) => {
    const t = told.get(serial);
    assert(t, `what the window on ${serial} was told`);
    return t;
  };
  const poke = (serial: string, m: Record<string, unknown>) =>
    session(serial).tell({ op: 'poke', ...m });
  const heard = (serial: string, m: Record<string, unknown>) =>
    toldOf(serial).some((said) => Object.entries(m).every(([k, v]) => said[k] === v));

  const shows = async (serial: string, link: string) => {
    // a link reaches Android's fixture as it starts, and the simulator's once it runs, where it is asked about first
    await device(serial).terminate(APP);
    if ((await device(serial).hardware()).platform === 'ios') await device(serial).launch(APP);
    await device(serial).openUrl(link, APP);
    await until(`${link} on ${serial}`, async () => {
      const { nodes } = await device(serial).tree();
      return nodes.some((n) => has(n, link === FORM ? 'submit' : 'add_button'));
    });
  };
  const nodeOf = async (serial: string, name: string) => {
    const tree = await device(serial).tree();
    return { tree, node: tree.nodes.find((n) => has(n, name)) };
  };
  const clickOn = async (serial: string, name: string) => {
    const { tree, node } = await nodeOf(serial, name);
    if (!node) throw new Error(`no ${name} on ${serial}`);
    const w = Math.max(...tree.windows.map((x) => x.b[2]));
    const h = Math.max(...tree.windows.map((x) => x.b[3]));
    poke(serial, { x: (node.b[0] + node.b[2]) / 2 / w, y: (node.b[1] + node.b[3]) / 2 / h });
  };
  const focused = async (serial: string, name: string) =>
    !!(((await nodeOf(serial, name)).node?.f ?? 0) & NODE_FLAGS.focused);
  const words = async (serial: string, name: string) => {
    const { node } = await nodeOf(serial, name);
    return node?.t || node?.d || '';
  };

  const picture = async (name: string) => {
    const shots = process.env.APPDYNO_SHOTS;
    if (!shots) return;
    for (const serial of serials)
      session(serial).tell({ op: 'snapshot', file: join(shots, `pair-${name}-${serial}.png`) });
    await new Promise((r) => setTimeout(r, 1_000));
  };

  beforeAll(async () => {
    await viewerBinary();
    for (const serial of serials) {
      await parent.open(serial);
      const s = session(serial);
      told.set(serial, []);
      const tell = s.tell.bind(s);
      s.tell = (m) => {
        toldOf(serial).push(m);
        tell(m);
      };
    }
    await until(
      'two pictures',
      () => serials.every((s) => session(s).status.state === 'live'),
      90_000,
    );
    // the pair starts each device agent, which a window does once
    for (const serial of serials) {
      await until(
        `an agent on ${serial}`,
        () =>
          device(serial)
            .tree()
            .then(
              () => true,
              () => false,
            ),
        200_000,
      );
      await shows(serial, FORM);
    }
  }, LONG_MS);

  afterAll(async () => {
    await parent.stopAll('the test ended');
  }, 60_000);

  it('a click on one is a click on the same thing on the other, wherever it stands there', async () => {
    await clickOn(a, 'name_input');
    await until('the field in focus on both', async () =>
      (await Promise.all(serials.map((s) => focused(s, 'name_input')))).every(Boolean),
    );
    expect(heard(b, { op: 'touchAt' })).toBe(true);
    await picture('touch');
  }, 60_000);

  it('text typed on one is typed on both', async () => {
    poke(b, { text: 'pair' });
    await until('the words on both', async () =>
      (await Promise.all(serials.map((s) => words(s, 'name_input')))).every((t) =>
        t.includes('pair'),
      ),
    );
  }, 60_000);

  it('a button on one presses the same one on the other', async () => {
    await clickOn(a, 'submit');
    await until('a result on both', async () =>
      (await Promise.all(serials.map((s) => words(s, 'result')))).every((t) => t.includes('pair')),
    );
  }, 60_000);

  it('says on the window where a thing is missing, and goes to no other thing there', async () => {
    await shows(b, LIST);
    const before = await device(b).tree();
    await clickOn(a, 'submit');
    await until('the words on the window', () =>
      toldOf(b).some((m) => typeof m.failing === 'string' && m.failing.endsWith('here')),
    );
    await picture('missing');
    expect((await device(b).tree()).nodes.length).toBe(before.nodes.length);
    await shows(b, FORM);
  }, 60_000);

  it('stays on one window when told to, and goes to both again', async () => {
    poke(a, { control: 'both' });
    await until('the window to say so', () => heard(a, { op: 'pair', both: false }));
    await picture('alone');
    const other = (await device(b).tree()).hash;
    await clickOn(a, 'name_input');
    await until('the field in focus', () => focused(a, 'name_input'));
    await clickOn(a, 'submit');
    await new Promise((r) => setTimeout(r, 1_000));
    expect((await device(b).tree()).hash).toBe(other);
    poke(a, { control: 'both' });
    await until('the window to say so', () => toldOf(a).at(-1)?.both === true);
  }, 60_000);

  it(
    'runs one journey on each, and compares them',
    async () => {
      const file = join(mkdtempSync(join(tmpdir(), 'pair-')), 'pair.flow');
      writeFileSync(file, 'stop\nlaunch\ntap text="Form"\ntap id=submit\nassert id=result\n');
      poke(a, { journey: file });
      const compared = (serial: string) =>
        toldOf(serial).find((m) => String(m.title).startsWith('Against'));
      await until('both compared', () => serials.every((s) => compared(s)), LONG_MS);
      for (const serial of serials) expect(String(compared(serial)?.detail)).toContain('ms there');
      await new Promise((r) => setTimeout(r, 1_000));
      await picture('journey');
    },
    LONG_MS + 30_000,
  );

  it('leaves the window left alone when the other closes', async () => {
    await session(a).stop('closed by the test');
    await until('the window to say so', () => heard(b, { op: 'pair', ended: true }));
  }, 60_000);

  it('starts from the hub, as one process with two windows', async () => {
    await parent.stopAll('the hub opens its own');
    const link = new ViewerProcess(await viewerBinary(), ['--hub', '--behind']);
    const done = runHub(ctx, {
      focus: false,
      behind: true,
      log: () => undefined,
      viewer: () => link,
    });
    await new Promise((r) => setTimeout(r, 3_000));
    if (process.env.APPDYNO_SHOTS)
      link.send({ op: 'snapshot', file: join(process.env.APPDYNO_SHOTS, 'pair-hub.png') });
    await new Promise((r) => setTimeout(r, 1_000));
    link.send({ op: 'poke', id: a, press: 'beside' });
    await until(
      'two windows',
      () => serials.every((s) => liveMirror(s)?.status.state === 'live'),
      120_000,
    );
    const [one, two] = [liveMirror(a), liveMirror(b)];
    assert(one && two, 'both windows');
    expect(one.pid).toBe(two.pid);
    // the hub's list follows within its poll, and a press acts on what it lists
    await new Promise((r) => setTimeout(r, 3_000));
    link.send({ op: 'quit' });
    await done;
    expect(serials.every((s) => !liveMirror(s))).toBe(true);
  }, 240_000);
});
