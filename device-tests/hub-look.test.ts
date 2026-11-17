import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  viewerTestBinary,
  ViewerProcess,
  type DeviceProvider,
  type Startable,
  type ViewerMessage,
} from '../packages/core/src/index.js';
import { simulatorProvider } from '../packages/driver-apple/src/index.js';
import { androidProvider, Adb } from '../packages/driver-android/src/index.js';
import { DEFAULT_POLICY, ServerContext } from '../packages/ops/src/index.js';
import { runHub } from '../packages/hub/src/index.js';
import { untilWithin } from './until.js';

/**
 * How the hub looks from its first open, for a person to judge: its real window kept off every screen, a picture of each
 * state into the folder APPDYNO_HUB_SHOTS names, with every word it shows beside it. APPDYNO_HUB_LOOK and
 * APPDYNO_HUB_LANGUAGE say how it is drawn. APPDYNO_HUB_MAKE=1 makes a simulator and an emulator by the sheet, as a
 * person does, and starts them: they are named `appdyno-mac-1` and `appdyno-mac-2`, and left for the caller to delete.
 * APPDYNO_HUB_OURS names ours that run already, by id, serial or name, comma between: each is shown, every pane of its
 * Inspector pictured, and the window narrowed to where the Inspector and then the sidebar give way.
 *
 * What another runs is no one's to look at: the lists keep to what is shut down and what this run made, no phone is
 * listed, and nothing the window asks of a device that is not ours reaches the hub.
 */
const shots = process.env.APPDYNO_HUB_SHOTS ?? '';
const look = process.env.APPDYNO_HUB_LOOK ?? 'light';
const language = process.env.APPDYNO_HUB_LANGUAGE ?? 'en';
const make = process.env.APPDYNO_HUB_MAKE === '1';
const BOOT_MS = 300_000;

const until = untilWithin(60_000);
const quiet = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ours, by id, serial or name: what this run made, as each is told. */
const ours = new Set<string>((process.env.APPDYNO_HUB_OURS ?? '').split(',').filter(Boolean));
/** Each pane of the Inspector, by the name a real click finds its tab by. */
const PANES = [
  'tabPerformance',
  'tabFlows',
  'tabApps',
  'tabActivity',
  'tabLogs',
  'tabNetwork',
  'tabAccessibility',
  'tabDevice',
  'tabLinks',
  'tabPush',
];
const isOurs = (...keys: (string | undefined)[]) =>
  keys.some((k) => k !== undefined && ours.has(k));

/** A provider that lists no phone, and of its virtual devices only what is shut down or ours. */
function keptTo(provider: DeviceProvider): DeviceProvider {
  const { virtual } = provider;
  if (virtual) {
    const all = virtual.startable.bind(virtual);
    virtual.startable = async () =>
      (await all()).filter(
        (d: Startable) => d.state === 'stopped' || isOurs(d.id, d.serial, d.name),
      );
  }
  const list = provider.list.bind(provider);
  return { ...provider, list: async () => (await list()).filter((d) => isOurs(d.serial)) };
}

describe.runIf(shots)('the hub, looked at', () => {
  const told: ViewerMessage[] = [];
  const sent: Record<string, unknown>[] = [];
  let link: ViewerProcess;
  let done: Promise<number>;
  let ctx: ServerContext;

  const poke = (m: Record<string, unknown>) => link.send({ op: 'poke', ...m });
  const clicked = async (m: Record<string, unknown>) => {
    const from = told.length;
    poke(m);
    await until(`a click on ${JSON.stringify(m)}`, () =>
      told.slice(from).some((t) => t.op === 'clicked'),
    );
    await quiet(800);
    return told.slice(from).find((t) => t.op === 'clicked')?.found === true;
  };
  const looked = async (state: string) => {
    await quiet(1_200);
    const file = join(shots, `${state}-${look}-${language}.png`);
    const from = told.length;
    link.send({ op: 'snapshot', file });
    await until('a picture', () => told.slice(from).some((m) => m.op === 'snapped'));
    const snapped = told.slice(from).find((m) => m.op === 'snapped') as unknown as {
      ok: boolean;
      parts: unknown;
    };
    expect(snapped.ok).toBe(true);
    writeFileSync(file.replace('.png', '.json'), JSON.stringify(snapped.parts, null, 1));
  };
  const listed = () =>
    (sent.findLast((m) => Array.isArray(m.devices))?.devices ?? []) as {
      id: string;
      name: string;
      state: string;
    }[];
  const answered = (key: 'choices' | 'made') => sent.filter((m) => m[key] !== undefined).length;

  /** Made by its sheet as a person makes one, then started by the hub: listed running under its name. */
  const makeOne = async (kind: 'simulator' | 'emulator', name: string) => {
    const asked = answered('choices');
    poke({ ask: kind });
    await until(`what a ${kind} is made of`, () => answered('choices') > asked, 120_000);
    await looked(`new-${kind}-filled`);
    const made = answered('made');
    ours.add(name);
    poke({ press: 'create', name });
    await until(`a ${kind} made`, () => answered('made') > made, BOOT_MS);
    const said = sent.filter((m) => m.made !== undefined).at(-1)?.made as { id?: string };
    expect(said.id, JSON.stringify(said)).toBeTruthy();
    ours.add(String(said.id));
    await looked(`made-${kind}-starting`);
    await until(
      `${name} running`,
      () => listed().some((d) => d.name.startsWith(name) && d.state === 'running'),
      BOOT_MS,
    );
    await quiet(8_000);
    await looked(`made-${kind}-running`);
  };

  beforeAll(async () => {
    mkdirSync(shots, { recursive: true });
    process.env.APPDYNO_STATE_DIR = join(mkdtempSync(join(tmpdir(), 'appdyno-hub-look-')), 'state');
    // an emulator's own window stays off the screen a person uses
    process.env.APPDYNO_EMULATOR_ARGS ??= '-no-window -no-snapshot-save -no-boot-anim -gpu host';
    ctx = new ServerContext(
      DEFAULT_POLICY,
      [keptTo(androidProvider(new Adb())), keptTo(simulatorProvider())],
      {},
    );
    const binary = await viewerTestBinary();
    done = runHub(ctx, {
      focus: false,
      behind: true,
      log: () => undefined,
      viewer: () => {
        link = new ViewerProcess(binary, [
          '--hub',
          '--behind',
          '--appearance',
          look,
          ...(language === 'en' ? [] : ['-AppleLanguages', `(${language})`]),
        ]);
        link.onMessage((m) => told.push(m));
        // the hub hears nothing the window asks of a device that is not ours
        const listen = link.onMessage.bind(link);
        link.onMessage = (hub) =>
          listen((m) => {
            const { action, id, serial } = m as { action?: string; id?: string; serial?: string };
            const acts = ['start', 'stop', 'open', 'close', 'pair'].includes(String(action));
            if (m.op === 'hub' && acts && !isOurs(id, serial)) return;
            hub(m);
          });
        const tell = link.send.bind(link);
        link.send = (m) => {
          sent.push(m);
          tell(m);
        };
        return link;
      },
    });
  }, 240_000);

  afterAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- unset where beforeAll failed
    link?.send({ op: 'quit' });
    await done;
    ctx.close();
  }, 120_000);

  it('shows its first open, its list, each place and each sheet', async () => {
    await until('the list', () => sent.some((m) => Array.isArray(m.devices)), 120_000);
    writeFileSync(
      join(shots, `told-${look}-${language}.json`),
      JSON.stringify(
        sent.findLast((m) => Array.isArray(m.devices)),
        null,
        1,
      ),
    );
    await looked('first');
    for (const title of ['Connect a Phone', 'Tools', 'AI Clients', 'Help']) {
      expect(await clicked({ clickRow: title }), title).toBe(true);
      await looked(`place-${title.replaceAll(' ', '-').toLowerCase()}`);
    }
    for (const kind of ['simulator', 'emulator']) {
      const asked = answered('choices');
      poke({ ask: kind });
      await until(`what a ${kind} is made of`, () => answered('choices') > asked, 120_000);
      await looked(`new-${kind}`);
      await clicked({ clickOn: 'cancel' });
    }
  }, 600_000);

  it.runIf(ours.size > 0)(
    'shows each device of ours live, each pane of its Inspector, and the window narrowed',
    async () => {
      const running = () =>
        (sent.findLast((m) => Array.isArray(m.devices))?.devices ?? []) as {
          id: string;
          serial?: string;
          kind: string;
          state: string;
        }[];
      await until(
        'our devices listed',
        () => running().some((d) => isOurs(d.id) && d.state === 'running'),
        120_000,
      );
      for (const device of running().filter(
        (d) => d.state === 'running' && isOurs(d.id, d.serial),
      )) {
        const stage = device.serial ?? device.id;
        poke({ id: device.id });
        // live already where it was chosen as the hub opened
        await until(
          `${device.kind} live`,
          () => told.some((m) => m.op === 'first' && m.stage === stage),
          120_000,
        );
        await quiet(4_000);
        await looked(`live-${device.kind}`);
        for (const pane of PANES) {
          const at = told.length;
          link.send({ op: 'poke', stage, clickOn: pane });
          await until(
            `the ${pane} tab`,
            () => told.slice(at).some((m) => m.op === 'clicked'),
            30_000,
          );
          await quiet(2_500);
          await looked(`pane-${device.kind}-${pane.slice(3).toLowerCase()}`);
        }
      }
      for (const [w, h] of [
        [1000, 760],
        [820, 700],
      ] as const) {
        poke({ size: [w, h] });
        await looked(`narrow-${w}`);
      }
      poke({ size: [1240, 820] });
    },
    1_200_000,
  );

  it.runIf(make)(
    'makes a simulator and an emulator by the sheet, chooses each and starts it',
    async () => {
      expect(
        execFileSync('xcrun', ['simctl', 'list', 'devices'], { encoding: 'utf8' }),
      ).not.toContain('appdyno-mac-1');
      await makeOne('simulator', 'appdyno-mac-1');
      await makeOne('emulator', 'appdyno-mac-2');
    },
    4 * BOOT_MS,
  );
});
