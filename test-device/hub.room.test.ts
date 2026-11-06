import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isAlive,
  viewerBinary,
  ViewerProcess,
  type ViewerMessage,
} from '../packages/core/src/index.js';
import { Adb, androidProvider } from '../packages/driver-android/src/index.js';
import { appleProvider } from '../packages/driver-apple/src/index.js';
import { DEFAULT_POLICY, ServerContext, runHub } from '../packages/ops/src/index.js';
import { liveMirror } from '../packages/ops/src/mirror/state.js';

/**
 * The hub as one window, on devices we hold (APPDYNO_HUB_DEVICES=A,B; never a default, and only those are listed): its
 * real window kept off every screen, with the device chosen live in it. APPDYNO_SHOTS names a folder for pictures. An
 * iPhone cannot stand here: its stream's thread starts only from built files, and this runs from sources.
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
      // a phone starts only when it is chosen
      await quiet(3_000);
      // a running simulator may show at once
      expect(serials.filter((s) => !/^[0-9A-F]{8}-[0-9A-F]{4}-/.test(s)).some(live)).toBe(false);
      link.send({ op: 'poke', id: serials[0] });
      await until('a first device', () => serials.some(live), LIVE_MS);
      await quiet(2_000);
      await picture('first');
      const shown = serials.find(live)!;
      // it stands open, reading: a real click closes it, and what it read stops with it
      await until(
        'readings',
        () => told.some((m) => m.op === 'perfWatch' && m.on === true),
        10_000,
      );
      told.length = 0;
      link.send({ op: 'poke', stage: shown, clickOn: 'inspector' });
      await until('the Inspector closing', () => told.some((m) => m.op === 'perfWatch'), 10_000);
      expect(told.find((m) => m.op === 'clicked')).toMatchObject({ found: true, isIt: 1 });
      expect(told.find((m) => m.op === 'perfWatch')).toMatchObject({ on: false });
      await picture('closed');
      told.length = 0;
      link.send({ op: 'poke', stage: shown, clickOn: 'inspector' });
      await until('the Inspector opening', () => told.some((m) => m.op === 'perfWatch'), 10_000);
      await quiet(6_000);
      await picture('inspector');
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

  /** The real item of More, fired by its menu: no menu opens, as one would on a person's screen and hold their mouse. */
  const fired = async (stage: string, menu: string) => {
    const from = told.length;
    const heard = () => told.slice(from).find((m) => m.op === 'fired');
    link.send({ op: 'poke', stage, menu });
    await until(`${menu} fired`, () => !!heard(), 10_000);
    expect(heard()).toMatchObject({ found: true, enabled: true });
  };
  /** What stands in the room now: the last to give a picture, once a window of its own has given the room back. */
  const inRoom = async () => {
    await quiet(3_000);
    await until('a device in the room', () => told.some((m) => m.op === 'first'), LIVE_MS);
    return String(told.findLast((m) => m.op === 'first')!.stage);
  };

  it(
    'turns the device by the item of More, and back',
    async () => {
      const shown = await inRoom();
      const size = () => {
        const { w, h } = told.findLast((m) => m.op === 'stats' && m.stage === shown && m.w)!;
        return `${String(w)}x${String(h)}`;
      };
      await until(
        'a picture',
        () => told.some((m) => m.op === 'stats' && m.stage === shown && m.w),
        20_000,
      );
      const upright = size();
      await fired(shown, 'rotateLeft');
      // the app in front may not turn, and the window then says so: what counts is that the device was asked
      await quiet(4_000);
      measured(`rotate left on ${shown}: picture ${upright} became ${size()}`);
      await picture('turned');
      await fired(shown, 'rotateRight');
      await quiet(4_000);
    },
    LIVE_MS + 30_000,
  );

  it(
    'gives a device a window of its own by the item of More',
    async () => {
      const shown = await inRoom();
      try {
        await fired(shown, 'newWindow');
        await until(
          'a window of its own',
          () => {
            const own = liveMirror(shown);
            return own?.pid !== process.pid && own?.status.state === 'live';
          },
          LIVE_MS,
        );
        const window = liveMirror(shown)!;
        await quiet(5_000);
        link.send({ op: 'poke', id: shown, press: 'window' });
        await until('it to close', () => !isAlive(window), 60_000);
      } finally {
        // it outlives the hub by design, so a test that fails must not leave it on a person's phone
        const left = liveMirror(shown);
        if (left && left.pid !== process.pid) process.kill(left.pid);
      }
      await quiet(3_000);
    },
    LIVE_MS + 90_000,
  );

  it(
    'brings the device back when the viewer under it is killed',
    async () => {
      // what left for a window of its own stands in the room again once that has closed
      const shown = await inRoom();
      // a phone left alone this long sleeps, and a window rightly waits for it
      if (!/^[0-9A-F]{8}-/.test(shown))
        await new Adb().exec(shown, 'input keyevent KEYCODE_WAKEUP');
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
      await quiet(3_000);
      await picture('split');
      link.send({ op: 'poke', id: serials[1] });
      await quiet(2_000);
    },
    LIVE_MS + 30_000,
  );
});
