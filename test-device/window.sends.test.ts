import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * What a person sends from a window, through its Links pane, on our own simulator (APPDYNO_IOS_UDID) and our own
 * emulator or phone (APPDYNO_ANDROID_SERIAL), each with the fixture installed: never a default. The window is real and
 * kept off every screen; what it sends goes by the op an agent calls, and the device itself says what came of it.
 */
const APP = 'dev.appdyno.fixture';
const HOME = 'com.apple.springboard';
/** A first call opens a session, which on a simulator may first build its runner. */
const FIRST_MS = 420_000;

const devices = (
  [
    ['a simulator', process.env.APPDYNO_IOS_UDID, (id) => new IosSimulatorDevice(id)],
    ['Android', process.env.APPDYNO_ANDROID_SERIAL, (id) => new AndroidDevice(id, new Adb())],
  ] as [string, string | undefined, (id: string) => Device][]
).filter(([, id]) => id);

const until = untilWithin(30_000);

describe.runIf(devices.length > 0).each(devices)("a window's Links pane on %s", (_, id, make) => {
  const device = make(id!);
  const told: Record<string, unknown>[] = [];
  let session: MirrorSession;
  const poke = (m: Record<string, unknown>) => session.tell({ op: 'poke', ...m });
  /** The fixture's form, read where it is: a simulator's runner reads the app it is told, and a link names none. */
  const showsForm = async () => {
    if (device instanceof IosSimulatorDevice) await device.target(APP);
    return (await device.tree()).nodes.some((n) => n.id?.endsWith('name_input'));
  };
  const answered = () =>
    told.find((m) => m.op === 'answer' && 'ok' in m) as Record<string, unknown> | undefined;

  /** A link typed in the pane and sent by its button, as a person does, and the answer the pane is given. */
  const openFromPane = async (url: string, ms?: number) => {
    told.length = 0;
    poke({ control: 'openLink' });
    poke({ link: url });
    poke({ clickOn: 'openLinkGo' });
    await until('an answer', () => !!answered(), ms);
    return answered()!;
  };

  beforeAll(async () => {
    const binary = await viewerBinary();
    const sends = windowSends(new ServerContext(DEFAULT_POLICY, []), device, () => session);
    session = new MirrorSession({
      mirror: device.mirror,
      viewer: async () => new ViewerProcess(binary, ['--behind']),
      options: { quality: 'auto' },
      title: 'a window under test',
      onWindow: (m) => void sends.onWindow(m),
    });
    const tell = session.tell.bind(session);
    session.tell = (m) => {
      told.push(m);
      tell(m);
    };
    await session.start();
    await until('a picture', () => session.status.state === 'live', 60_000);
    await device.terminate(APP).catch(() => undefined);
  });

  afterAll(async () => {
    await session?.stop('the test ended');
    await device.terminate(APP).catch(() => undefined);
    device.close();
  });

  it(
    'opens the fixture at a screen by its own scheme, and says what it did',
    async () => {
      expect(await openFromPane('appdyno-fixture://open/form', FIRST_MS)).toMatchObject({
        ok: true,
        // a simulator asks before an app's scheme first opens it, and until then nothing has opened
        text: expect.stringMatching(
          /^Opened appdyno-fixture:\/\/open\/form$|^Sent appdyno-fixture:\/\/open\/form, and the system asks: .+ \(Cancel, Open\): answer it with alert$/,
        ),
        recent: expect.arrayContaining(['appdyno-fixture://open/form']),
      });
      await until('the form', async () => {
        // a person presses Open in the window
        if (device instanceof IosSimulatorDevice) await device.target(HOME);
        const open = (await device.tree()).nodes.find(
          (n) => n.c.endsWith('Button') && (n.t ?? n.d) === 'Open',
        );
        if (open) {
          const { screen } = await device.open();
          const [left, top, right, bottom] = open.b;
          poke({ x: (left + right) / 2 / screen.w, y: (top + bottom) / 2 / screen.h });
        }
        return showsForm();
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
});
