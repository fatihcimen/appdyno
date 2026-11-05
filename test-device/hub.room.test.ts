import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isAlive,
  viewerBinary,
  ViewerProcess,
  type ViewerMessage,
} from '../packages/core/src/index.js';
import { androidProvider } from '../packages/driver-android/src/index.js';
import { appleProvider } from '../packages/driver-apple/src/index.js';
import { DEFAULT_POLICY, ServerContext, runHub } from '../packages/ops/src/index.js';
import { liveMirror } from '../packages/ops/src/mirror/state.js';

/**
 * The hub as one window, on devices we hold (APPDYNO_HUB_DEVICES=A,B; never a default, and only those are listed): its
 * real window kept off every screen, with the device chosen live in it. APPDYNO_SHOTS names a folder for pictures.
 */
const serials = process.env.APPDYNO_HUB_DEVICES?.split(',') ?? [];
const LIVE_MS = 180_000;
const main = join(import.meta.dirname, '../packages/appdyno/dist/main.js');

const until = async (what: string, test: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`no ${what} in ${ms} ms`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

describe.runIf(serials.length > 0)('the hub as one window', () => {
  const told: ViewerMessage[] = [];
  const shots = process.env.APPDYNO_SHOTS;
  let link: ViewerProcess;
  let done: Promise<number>;
  const live = (stage: string) => told.some((m) => m.op === 'first' && m.stage === stage);
  const quiet = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const picture = async (name: string) => {
    if (!shots) return;
    link.send({ op: 'snapshot', file: join(shots, `room-${name}.png`) });
    await quiet(1_000);
  };
  const measured = (line: string) => {
    if (shots) appendFileSync(join(shots, 'room-times.txt'), `${line}\n`);
  };

  beforeAll(async () => {
    const look = process.env.APPDYNO_HUB_LOOK ?? 'dark';
    const binary = await viewerBinary();
    const policy = { ...DEFAULT_POLICY, devices: new RegExp(`^(${serials.join('|')})$`) };
    const ctx = new ServerContext(policy, [androidProvider(), appleProvider()], {
      mirrorCommand: [process.execPath, main, 'mirror'],
    });
    done = runHub(ctx, {
      focus: false,
      behind: true,
      log: measured,
      viewer: () => {
        link = new ViewerProcess(binary, ['--hub', '--behind', '--appearance', look]);
        link.onMessage((m) => told.push(m));
        return link;
      },
    });
  }, 60_000);

  afterAll(async () => {
    link?.send({ op: 'quit' });
    await done;
  }, 60_000);

  it(
    'shows the first device live in its window, the Inspector a click away, and another chosen',
    async () => {
      await until('a first device', () => serials.some(live), LIVE_MS);
      await quiet(2_000);
      await picture('first');
      const shown = serials.find(live)!;
      told.length = 0;
      link.send({ op: 'poke', stage: shown, clickOn: 'inspector' });
      await until('a click on the Inspector', () => told.some((m) => m.op === 'perfWatch'), 10_000);
      await quiet(6_000);
      await picture('inspector');
      link.send({ op: 'poke', stage: shown, clickOn: 'inspector' });
      const other = serials.find((s) => s !== shown);
      if (!other) return;
      for (const [to, from] of [
        [other, shown],
        [shown, other],
        [other, shown],
      ] as const) {
        const at = Date.now();
        told.length = 0;
        link.send({ op: 'poke', id: to });
        await until('the other device', () => live(to), LIVE_MS);
        measured(`switch to ${to}: ${Date.now() - at} ms`);
        expect(live(from)).toBe(false);
        await quiet(1_000);
      }
      await picture('other');
    },
    4 * LIVE_MS,
  );

  it(
    'gives a device a window of its own on request, and closes it again',
    async () => {
      const serial = serials[0]!;
      link.send({ op: 'poke', id: serial, press: 'window' });
      await until(
        'a window of its own',
        () => {
          const own = liveMirror(serial);
          return own?.pid !== process.pid && own?.status.state === 'live';
        },
        LIVE_MS,
      );
      const window = liveMirror(serial)!;
      await picture('own-window');
      // the hub's list follows within its poll, and a press acts on what it lists
      await quiet(5_000);
      link.send({ op: 'poke', id: serial, press: 'window' });
      await until('it to close', () => !isAlive(window), 60_000);
      await quiet(3_000);
    },
    LIVE_MS + 90_000,
  );

  it(
    'brings the device back when the viewer under it is killed',
    async () => {
      const shown = serials.findLast((s) => live(s) || serials.length === 1)!;
      const at = Date.now();
      told.length = 0;
      process.kill(link.pid!, 'SIGKILL');
      // the window that comes back keeps the device that stood in it
      await until('the device again', () => live(shown), LIVE_MS);
      measured(`back after a kill: ${Date.now() - at} ms`);
      await quiet(2_000);
      await picture('after-kill');
    },
    LIVE_MS + 30_000,
  );

  it(
    'stands two devices beside each other in one window',
    async () => {
      if (serials.length < 2) return;
      await until('a device', () => serials.some(live), LIVE_MS);
      await quiet(3_000);
      told.length = 0;
      link.send({ op: 'poke', id: serials[0], press: 'beside' });
      await until('both', () => serials.every(live), LIVE_MS);
      await until('the pair said', () => told.some((m) => m.op === 'pair'), 10_000).catch(
        () => undefined,
      );
      await quiet(3_000);
      await picture('split');
      link.send({ op: 'poke', id: serials[1] });
      await quiet(2_000);
    },
    LIVE_MS + 30_000,
  );
});
