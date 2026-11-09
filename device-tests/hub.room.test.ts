import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest';
import {
  isAlive,
  viewerBinary,
  ViewerProcess,
  type ViewerMessage,
} from '../packages/core/src/index.js';
import { Adb, androidProvider } from '../packages/driver-android/src/index.js';
import { iphoneProvider, simulatorProvider } from '../packages/driver-apple/src/index.js';
import { DEFAULT_POLICY, ServerContext } from '../packages/ops/src/index.js';
import { runHub } from '../packages/hub/src/index.js';
import { liveMirror } from '../packages/ops/src/mirror-state.js';
import { untilWithin } from './until.js';

/**
 * The hub as one window, on devices we hold (APPDYNO_HUB_DEVICES=A,B; never a default, and only those are listed): its
 * real window kept off every screen, with the device chosen live in it. APPDYNO_SHOTS names a folder for pictures,
 * APPDYNO_HUB_LOOK and APPDYNO_HUB_LANGUAGE how they look. An iPhone cannot stand here: its stream's thread starts only
 * from built files, and this runs from sources. The panes' check drives the fixture, installed on the device.
 */
const serials = process.env.APPDYNO_HUB_DEVICES?.split(',') ?? [];
const LIVE_MS = 180_000;
const main = join(import.meta.dirname, '../packages/appdyno/dist/main.js');
const look = process.env.APPDYNO_HUB_LOOK ?? 'dark';
const language = process.env.APPDYNO_HUB_LANGUAGE ?? 'en';
/** Where the fixture's Fetch stands on a simulator's network screen, under its address field, as a share of the screen. */
const FETCH_AT = { x: 0.09, y: 0.184 };
/** Where the fixture's accessibility screen has its button labelled Small on a simulator, and its Continue on Android. */
const SMALL_AT = { x: 0.06, y: 0.24 };
const CONTINUE_AT = { x: 0.5, y: 0.57 };
/** Where the fixture's Crash stands on an Android screen of 1080 by 2400. */
const CRASH_AT = { x: 0.5, y: 295 / 2400 };
/** Where a simulator's Open stands on the "Open in …?" it asks each time a link from simctl opens the fixture. */
const OPEN_AT = { x: 0.685, y: 0.5425 };

const until = untilWithin(30_000);

describe.runIf(serials.length > 0)('the hub as one window', () => {
  const told: ViewerMessage[] = [];
  /** What the hub said to its window. */
  const sent: Record<string, unknown>[] = [];
  const shots = process.env.APPDYNO_SHOTS;
  let link: ViewerProcess;
  let done: Promise<number>;
  /** A page for the fixture to fetch, on this Mac, by the port it listens on. */
  const server = createServer((_, res) => res.end('fetched by the fixture'));
  let port = 0;
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
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    ({ port } = server.address() as AddressInfo);
    // what simctl starts the fixture with, the probe's restart too, as its tools take this process's environment
    process.env.SIMCTL_CHILD_APPDYNO_FIXTURE_FETCH_URL = `http://127.0.0.1:${port}/order?token=s3cr3t`;
    const binary = await viewerBinary();
    const policy = { ...DEFAULT_POLICY, devices: new RegExp(`^(${serials.join('|')})$`) };
    const ctx = new ServerContext(
      policy,
      [androidProvider(), simulatorProvider(), iphoneProvider()],
      {
        mirrorCommand: [process.execPath, main, 'mirror'],
      },
    );
    done = runHub(ctx, {
      focus: false,
      behind: true,
      log: measured,
      viewer: () => {
        link = new ViewerProcess(binary, [
          '--hub',
          '--behind',
          '--appearance',
          look,
          ...(language === 'tr' ? ['-AppleLanguages', '(tr)'] : []),
        ]);
        link.onMessage((m) => told.push(m));
        const send = link.send.bind(link);
        link.send = (m) => {
          sent.push(m);
          send(m);
        };
        return link;
      },
    });
  }, 60_000);

  afterAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- unset where beforeAll failed
    link?.send({ op: 'quit' });
    await done;
    server.close();
  }, 60_000);

  it(
    'shows the first device live in its window, the Inspector a click away, and another chosen',
    async () => {
      // a phone starts only when it is chosen
      await quiet(3_000);
      // a running simulator or emulator may show at once
      expect(
        serials.filter((s) => !/^[0-9A-F]{8}-[0-9A-F]{4}-|^emulator-/.test(s)).some(live),
      ).toBe(false);
      link.send({ op: 'poke', id: serials[0] });
      await until('a first device', () => serials.some(live), LIVE_MS);
      await quiet(2_000);
      await picture('first');
      const shown = serials.find(live);
      assert(shown);
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
    "answers the Inspector's panes as a window of its own does: Push, Links and Apps name their device",
    async () => {
      // the device standing in the room, by what its stream reports each second
      const streaming = () => told.findLast((m) => m.op === 'stats' && m.stage)?.stage;
      await until('a device in the room', () => !!streaming(), LIVE_MS);
      const shown = String(streaming());
      const from = told.length;
      const said = (what: (m: ViewerMessage) => boolean) => told.slice(from).find(what);
      const answered = (what: (m: Record<string, unknown>) => boolean) => () => sent.some(what);
      sent.length = 0;
      link.send({ op: 'poke', stage: shown, control: 'push' });
      await until(
        'the push types',
        answered((m) => m.op === 'answer' && m.name === 'push' && Array.isArray(m.types)),
        60_000,
      );
      link.send({ op: 'poke', stage: shown, control: 'openLink' });
      await until(
        'the links',
        answered((m) => m.op === 'answer' && m.name === 'openLink'),
        60_000,
      );
      link.send({ op: 'poke', stage: shown, clickOn: 'tabApps' });
      await until(
        'the apps',
        answered((m) => m.op === 'apps'),
        60_000,
      );
      for (const name of ['pushes', 'links'])
        expect(
          said((m) => m.op === 'control' && m.name === name),
          name,
        ).toMatchObject({
          stage: shown,
        });
      expect(said((m) => m.op === 'app' && m.action === 'list')).toMatchObject({ stage: shown });
    },
    LIVE_MS,
  );

  it(
    'reads the app in front in Logs, Network and Accessibility only while each shows, and stops as it hides',
    async () => {
      // run by itself, the device is chosen once the hub has listed it
      for (let tries = 0; !told.some((m) => m.op === 'first') && tries < 18; tries++) {
        link.send({ op: 'poke', id: serials[0] });
        await quiet(10_000);
      }
      await until('a device in the room', () => told.some((m) => m.op === 'first'), LIVE_MS);
      const shown = String(told.findLast((m) => m.op === 'first')?.stage);
      const simulator = /^[0-9A-F]{8}-/.test(shown);
      // an emulator reaches this Mac at 10.0.2.2
      const page = `http://${simulator ? '127.0.0.1' : '10.0.2.2'}:${port}/order?token=s3cr3t`;
      const open = async (screen: string) => {
        if (!simulator) {
          openOnAndroid(screen);
          return;
        }
        execFileSync('xcrun', ['simctl', 'openurl', shown, `appdyno-fixture://open/${screen}`]);
        // a simulator asks before a link from outside opens the fixture, and a person answers it in the window
        await quiet(2_000);
        link.send({ op: 'poke', stage: shown, ...OPEN_AT });
        await quiet(1_000);
      };
      const openOnAndroid = (screen: string) =>
        execFileSync('adb', [
          '-s',
          shown,
          'shell',
          'am',
          'start',
          '-a',
          'android.intent.action.VIEW',
          '-d',
          `'appdyno-fixture://open/${screen}'`,
        ]);
      const ofIt = (op: string, more: (m: Record<string, unknown>) => boolean = () => true) =>
        sent.filter((m) => m.op === op && m.stage === shown && more(m));
      const watching = (pane: string, on: boolean) => () =>
        told.some(
          (m) => m.op === 'paneWatch' && m.pane === pane && m.on === on && m.stage === shown,
        );
      const tab = (name: string) => link.send({ op: 'poke', stage: shown, clickOn: name });
      /** The whole window, and every word it shows, for a person to read and a test to search. */
      const looked = async (name: string) => {
        if (!shots) return;
        await quiet(1_500);
        const file = join(
          shots,
          `room-${name}-${simulator ? 'simulator' : 'android'}-${look}-${language}.png`,
        );
        const from = told.length;
        link.send({ op: 'snapshot', file });
        await until('a picture', () => told.slice(from).some((m) => m.op === 'snapped'));
        const { parts } = told.slice(from).find((m) => m.op === 'snapped') as unknown as {
          parts: unknown;
        };
        writeFileSync(file.replace('.png', '.json'), JSON.stringify(parts));
      };
      try {
        // a crash of the fixture's own, for its reports to hold one of this device's
        if (simulator) {
          // a simulator's app is a process of this Mac, started here: its report is the system's, as for any crash
          const started = execFileSync(
            'xcrun',
            ['simctl', 'launch', shown, 'dev.appdyno.fixture'],
            {
              encoding: 'utf8',
            },
          );
          process.kill(Number(/: (\d+)/.exec(started)?.[1]), 'SIGABRT');
          await quiet(6_000);
        } else {
          await open('crash');
          await quiet(2_000);
          link.send({ op: 'poke', stage: shown, ...CRASH_AT });
          await quiet(3_000);
          // a crash a second time in a while stands as a dialog over what comes next, and Back closes it
          link.send({ op: 'poke', stage: shown, button: 'back' });
          await quiet(1_000);
        }
        await open('list');
        sent.length = 0;
        told.length = 0;
        tab('tabLogs');
        await until(
          'the log of the fixture',
          () => ofIt('logs', (m) => m.app !== undefined).length > 0,
          60_000,
        );
        await until(
          'a line of it',
          () => ofIt('logs', (m) => Array.isArray(m.lines) && m.lines.length > 0).length > 0,
          60_000,
        );
        await until(
          'its crash reports',
          () => ofIt('crashes', (m) => Array.isArray(m.reports) && m.reports.length > 0).length > 0,
          60_000,
        );
        await looked('logs');
        tab('logShowCrashes');
        await looked('crashes');
        tab('logShowLog');

        tab('tabNetwork');
        await until('the log to stop', watching('logs', false), 10_000);
        await until(
          'the ways it has',
          () => ofIt('network', (m) => Array.isArray(m.ways)).length > 0,
          60_000,
        );
        const { ways } = ofIt('network', (m) => Array.isArray(m.ways)).at(-1) as { ways: string[] };
        // a device that lists no requests has a way to count them, and says what a person needs
        expect(ways).toContain(simulator ? 'probe' : 'bytes');
        tab('networkGo');
        await until(
          'a capture',
          () => ofIt('network', (m) => typeof m.capturing === 'string').length > 0,
          120_000,
        );
        if (simulator) {
          await open('network');
          await quiet(2_000);
          link.send({ op: 'poke', stage: shown, ...FETCH_AT });
        } else await open(`network?url=${encodeURIComponent(page)}`);
        await quiet(3_000);
        if (!simulator) tab('networkRead');
        await until(
          'what it saw',
          () => ofIt('network', (m) => Array.isArray(m.entries) && m.entries.length > 0).length > 0,
          60_000,
        );
        const { entries } = ofIt('network', (m) => Array.isArray(m.entries)).at(-1) as {
          entries: { url?: string; bytes?: number }[];
        };
        // redacted as the op redacts it
        if (simulator) expect(entries.map((e) => e.url)).toContain(page.replace('s3cr3t', '•••'));
        await looked('network');

        await open('a11y');
        tab('tabAccessibility');
        await until(
          'an audit of the screen shown',
          () => ofIt('audit', (m) => m.state === 'done').length > 0,
          2 * LIVE_MS,
        );
        const { issues } = ofIt('audit', (m) => m.state === 'done').at(-1) as {
          issues: { rect?: unknown }[];
        };
        expect(issues.length).toBeGreaterThan(0);
        // one chosen is marked where it stands on the picture
        const placed = issues.findIndex((i) => i.rect);
        if (placed >= 0) link.send({ op: 'poke', stage: shown, issue: String(placed) });
        await looked('accessibility');
        const audits = ofIt('audit').length;
        link.send({ op: 'poke', stage: shown, clickOn: 'auditAgain' });
        await until('another audit', () => ofIt('audit').length > audits, 30_000);

        // the apps, and the element under the pointer, are named as the app names them, in any language
        tab('tabApps');
        await until('the apps', () => ofIt('apps').length > 0, 60_000);
        await looked('apps');
        tab('tabFlows');
        await quiet(2_000);
        for (let i = 0; i < 3; i++) {
          link.send({
            op: 'poke',
            stage: shown,
            ...(simulator ? SMALL_AT : CONTINUE_AT),
            hover: true,
          });
          await quiet(700);
        }
        await until(
          'the element under the pointer',
          () => ofIt('element', (m) => typeof m.role === 'string').length > 0,
          60_000,
        );
        await looked('flows');

        tab('tabPerformance');
        await until('the audit to stop', watching('accessibility', false), 10_000);
        const reads = () => ofIt('logs').length + ofIt('audit').length;
        const before = reads();
        await quiet(8_000);
        expect(reads()).toBe(before);
      } finally {
        tab('tabNetwork');
        await quiet(1_000);
        if (ofIt('network').at(-1)?.capturing) tab('networkGo');
        await quiet(2_000);
      }
    },
    5 * LIVE_MS,
  );

  it(
    'gives a device a window of its own on request, and closes it again',
    async () => {
      const [serial] = serials;
      assert(serial);
      link.send({ op: 'poke', id: serial, press: 'window' });
      await until(
        'a window of its own',
        () => {
          const own = liveMirror(serial);
          return own?.pid !== process.pid && own?.status.state === 'live';
        },
        LIVE_MS,
      );
      const window = liveMirror(serial);
      assert(window);
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
    const first = told.findLast((m) => m.op === 'first');
    assert(first);
    return String(first.stage);
  };

  it(
    'turns the device by the item of More, and back',
    async () => {
      const shown = await inRoom();
      const size = () => {
        const stats = told.findLast((m) => m.op === 'stats' && m.stage === shown && m.w);
        assert(stats);
        const { w, h } = stats;
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
        const window = liveMirror(shown);
        assert(window);
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
      assert(link.pid !== undefined);
      process.kill(link.pid, 'SIGKILL');
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
    async (ctx) => {
      if (serials.length < 2) return ctx.skip();
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
