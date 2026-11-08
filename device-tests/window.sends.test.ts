import { join } from 'node:path';
import { assert, beforeAll, describe, expect, it } from 'vitest';
import {
  MirrorSession,
  viewerBinary,
  ViewerProcess,
  type Device,
} from '../packages/core/src/index.js';
import { Adb, AndroidDevice } from '../packages/driver-android/src/index.js';
import { IosSimulatorDevice } from '../packages/driver-apple/src/index.js';
import { DEFAULT_POLICY, ServerContext } from '../packages/ops/src/index.js';
import { windowSends } from '../packages/hub/src/window-sends.js';
import { untilWithin } from './until.js';

/**
 * What a person sends from a window, through its Links and Push panes, on our own simulator (APPDYNO_IOS_UDID), iPhone
 * (APPDYNO_IPHONE_UDID) and emulator or phone (APPDYNO_ANDROID_SERIAL), each with the fixture installed: never a default.
 * The window is real and kept off every screen; what it sends goes by the op an agent calls, and the device itself says
 * what came of it.
 */
const APP = 'dev.appdyno.fixture';
const HOME = 'com.apple.springboard';
/** A first call opens a session, which on a simulator may first build its runner. */
const FIRST_MS = 420_000;
/** How long the system may take to ask for a permission; an app that has it is not asked at all. */
const ASK_MS = 8_000;

/** An iPhone's picture comes by the phone stream, which only a build holds. */
// by a path the type checker does not follow, so a clean clone checks types before anything is built
const built = process.env.APPDYNO_IPHONE_UDID
  ? ((await import(
      join(import.meta.dirname, '../packages/driver-apple/dist/index.js')
    )) as typeof import('../packages/driver-apple/src/index.js'))
  : undefined;

type Kind = 'simulator' | 'iphone' | 'android';
const devices = (
  [
    [
      'a simulator',
      process.env.APPDYNO_IOS_UDID ?? '',
      'simulator',
      (id) => new IosSimulatorDevice(id),
    ],
    [
      'an iPhone',
      process.env.APPDYNO_IPHONE_UDID ?? '',
      'iphone',
      (id) => {
        assert(built, 'the built driver');
        return new built.IosPhoneDevice(id);
      },
    ],
    [
      'Android',
      process.env.APPDYNO_ANDROID_SERIAL ?? '',
      'android',
      (id) => new AndroidDevice(id, new Adb()),
    ],
  ] as [string, string, Kind, (id: string) => Device][]
).filter(([, id]) => id);

const until = untilWithin(30_000);

describe.runIf(devices.length > 0).each(devices)(
  "a window's panes that send, on %s",
  (_, id, kind, make) => {
    const device = make(id);
    const ios = kind !== 'android';
    const simulator = kind === 'simulator';
    const told: Record<string, unknown>[] = [];
    let session: MirrorSession;
    const poke = (m: Record<string, unknown>) => session.tell({ op: 'poke', ...m });
    /** What an app shows, read where it is: a simulator's runner reads the app it is told, and a link names none. */
    const nodesOf = async (app: string) => {
      if (ios) await (device as IosSimulatorDevice).target(app);
      return (await device.tree()).nodes;
    };
    const showsForm = async () => (await nodesOf(APP)).some((n) => n.id?.endsWith('name_input'));
    /** A person's click on what a node shows, through the window. */
    const click = async ({
      b: [left, top, right, bottom],
    }: {
      b: readonly [number, number, number, number];
    }) => {
      const { screen } = await device.open();
      poke({ x: (left + right) / 2 / screen.w, y: (top + bottom) / 2 / screen.h });
    };
    /** A button of the system's, over whatever is up. */
    const systemButton = async (label: RegExp) =>
      (await nodesOf(HOME)).find((n) => n.c.endsWith('Button') && label.test(n.t ?? n.d ?? ''));
    const answered = () => told.find((m) => m.op === 'answer' && 'ok' in m);

    /** A link typed in the pane and sent by its button, as a person does, and the answer the pane is given. */
    const openFromPane = async (url: string, ms?: number) => {
      told.length = 0;
      poke({ control: 'openLink' });
      // an iPhone opens a link only in a named app
      poke({ link: url, ...(kind === 'iphone' && { app: APP }) });
      poke({ clickOn: 'openLinkGo' });
      await until('an answer', () => !!answered(), ms);
      const answer = answered();
      assert(answer, 'an answer');
      return answer;
    };

    /** A link from the pane, until `there` holds: a simulator asks before an app's scheme first opens it, and a person presses Open in the window. */
    const openAt = async (url: string, there: () => Promise<boolean>, ms?: number) => {
      const answer = await openFromPane(url, ms);
      await until(url, async () => {
        const open = ios ? await systemButton(/^Open$/) : undefined;
        if (open) await click(open);
        return there();
      });
      return answer;
    };

    beforeAll(async () => {
      const binary = await viewerBinary();
      const sends = windowSends(new ServerContext(DEFAULT_POLICY, []), device, () => session);
      session = new MirrorSession({
        mirror: device.mirror,
        viewer: () =>
          new Promise((resolve) => {
            resolve(new ViewerProcess(binary, ['--behind']));
          }),
        options: { quality: 'auto' },
        title: 'a window under test',
        onWindow: (m) => void sends.onWindow(m),
      });
      const tell = session.tell.bind(session);
      session.tell = (m) => {
        told.push(m);
        tell(m);
      };
      // a window a start that failed opened is closed too
      return async () => {
        await session.stop('the test ended');
        await device.terminate(APP).catch(() => undefined);
        device.close();
      };
    });
    beforeAll(async () => {
      await session.start();
      await until('a picture', () => session.status.state === 'live', 60_000);
      await device.terminate(APP).catch(() => undefined);
    });

    it(
      'opens the fixture at a screen by its own scheme, and says what it did',
      async () => {
        expect(await openAt('appdyno-fixture://open/form', showsForm, FIRST_MS)).toMatchObject({
          ok: true,
          // a simulator asks before an app's scheme first opens it, and until then nothing has opened
          text: expect.stringMatching(
            /^Opened appdyno-fixture:\/\/open\/form$|^Sent appdyno-fixture:\/\/open\/form, and the system asks: .+ \(Cancel, Open\): answer it with alert$/,
          ) as unknown,
          recent: expect.arrayContaining(['appdyno-fixture://open/form']) as unknown,
        });
      },
      FIRST_MS + 60_000,
    );

    it('shows a refusal whole, and opens nothing', async () => {
      expect(await openFromPane('javascript:alert(1)')).toMatchObject({
        ok: false,
        text: 'this scheme is not opened: javascript',
      });
      expect(await showsForm()).toBe(true);
    });

    /** A push filled in the pane and sent by its button, as a person does, and the answer the pane is given. */
    const pushFromPane = async (fields: Record<string, string>) => {
      told.length = 0;
      poke({ control: 'push' });
      await until('the types', () => told.some((m) => m.op === 'answer' && 'types' in m));
      poke({ push: { app: APP, ...fields } });
      poke({ clickOn: 'pushGo' });
      await until('an answer', () => !!answered());
      const answer = answered();
      assert(answer, 'an answer');
      return answer;
    };

    it.runIf(simulator)(
      "sends an alert the fixture's code receives, from the Push pane",
      async () => {
        const ask = async () => (await nodesOf(APP)).find((n) => n.id === 'ask_notifications');
        await openAt('appdyno-fixture://open/push', async () => !!(await ask()));
        const button = await ask();
        assert(button, 'ask_notifications');
        await click(button);
        // the first time, the system asks the person whether the app may show notifications, a moment after the tap; a
        // click while it still comes in is not taken, so a person clicks again
        const askedBy = Date.now() + ASK_MS;
        let asked = false;
        await until('the question answered', async () => {
          const allow = await systemButton(/^Allow$/);
          asked ||= !!allow;
          if (!allow) return asked || Date.now() > askedBy;
          await click(allow);
          await new Promise((r) => setTimeout(r, 1_000));
          return false;
        });
        expect(
          await pushFromPane({ type: 'alert', title: 'Order 42', data: 'order=42' }),
        ).toMatchObject({
          ok: true,
          text: expect.stringMatching(/^Pushed to dev\.appdyno\.fixture by simctl/) as unknown,
        });
        await until('the push in the app', async () =>
          (await nodesOf(APP)).some((n) => (n.t ?? n.d) === 'alert Order 42: order=42'),
        );
      },
    );

    it.runIf(ios && !simulator)(
      'says for each type why an iPhone takes no push, in the Push pane',
      async () => {
        told.length = 0;
        poke({ control: 'push' });
        await until('the types', () => told.some((m) => m.op === 'answer' && 'types' in m));
        const { types } = told.find((m) => 'types' in m) as { types: { why?: string }[] };
        expect(types.length).toBeGreaterThan(0);
        expect(types.filter((t) => !t.why)).toEqual([]);
      },
    );

    it.runIf(!ios)(
      'opens the fixture as a tapped push, its data in the extras, from the Push pane',
      async () => {
        expect(
          await pushFromPane({ type: 'tapped', data: 'order=42\nkind=shipped' }),
        ).toMatchObject({
          ok: true,
          text: expect.stringMatching(
            /^Opened dev\.appdyno\.fixture as a tapped push, with 2 data keys/,
          ) as unknown,
        });
        await until('the extras', async () =>
          (await nodesOf(APP)).some((n) => n.t?.includes('extras: kind=shipped, order=42')),
        );
      },
    );
  },
);
