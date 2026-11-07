import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MirrorSession,
  viewerBinary,
  ViewerProcess,
  type ViewerMessage,
} from '../packages/core/src/index.js';
import { apnsKey, IosSimulatorDevice, Simctl } from '../packages/driver-apple/src/index.js';
import type { ApnsRequest } from '../packages/driver-apple/src/apns.js';
import { ApnsPush } from '../packages/driver-apple/src/apns-push.js';
import { simulatorApnsTarget } from '../packages/driver-apple/src/sim-apns.js';
import { SimulatorEvents } from '../packages/driver-apple/src/simulator-manage.js';
import { DEFAULT_POLICY, ServerContext } from '../packages/ops/src/index.js';
import { windowSends } from '../packages/hub/src/window-sends.js';
import { madeUp } from './helpers.js';
import { untilWithin } from './until.js';

/**
 * A push token a person types in a window's Push pane, on our own simulator (APPDYNO_IOS_UDID) with the fixture
 * installed: the field stands once APNs is set up, here by made-up credentials in a state folder of the suite's own, and
 * the token kept is the one a push goes by. The push goes to this test, which answers as Apple does a key it never
 * issued: nothing leaves this Mac.
 */
const UDID = process.env.APPDYNO_IOS_UDID;
const APP = 'dev.appdyno.fixture';
/** No device's: made up here, as long as a real one. */
const TOKEN = 'c0ffee'.repeat(11);
/** A first call opens a session, which on a simulator may first build its runner. */
const FIRST_MS = 420_000;

const until = untilWithin(30_000);

describe.runIf(UDID)('a push token typed in a window, on a simulator', () => {
  let state: string;
  let device: IosSimulatorDevice;
  /** What reached the push's sender, in Apple's place. */
  const sent: ApnsRequest[] = [];
  /** What the window was told, since the last look and all along, and what it said. */
  const told: Record<string, unknown>[] = [];
  const all: Record<string, unknown>[] = [];
  const heard: ViewerMessage[] = [];
  let session: MirrorSession;
  const poke = (m: Record<string, unknown>) => session.tell({ op: 'poke', ...m });
  const answered = () => told.find((m) => m.op === 'answer' && 'ok' in m);

  /** The Push pane asked what the device takes, as a person opens it. */
  const types = async (ms?: number) => {
    told.length = 0;
    poke({ control: 'push' });
    await until('the types', () => told.some((m) => 'types' in m), ms);
    return (told.find((m) => 'types' in m) as { types: { type: string; tokens?: string[] }[] })
      .types;
  };

  /** A real click on the pane's Keep, and whether it landed on it. */
  const keep = async () => {
    heard.length = 0;
    poke({ clickOn: 'pushTokenGo' });
    await until('the click', () => heard.some((m) => m.op === 'clicked'));
    return heard.find((m) => m.op === 'clicked')!;
  };

  beforeAll(async () => {
    state = madeUp('apns').APPDYNO_STATE_DIR;
    vi.stubEnv('APPDYNO_STATE_DIR', state);
    const simctl = new Simctl();
    device = new IosSimulatorDevice(UDID!, simctl);
    Object.assign(device, {
      events: new SimulatorEvents(
        simctl,
        UDID!,
        () => device.foreground().catch(() => undefined),
        new ApnsPush(simulatorApnsTarget(simctl, UDID!), {
          key: apnsKey,
          // what Apple answers a key it never issued
          send: async (_, request) => {
            sent.push(request);
            return { status: 403, reason: 'InvalidProviderToken' };
          },
          now: Date.now,
        }),
      ),
    });
    const binary = await viewerBinary();
    const sends = windowSends(new ServerContext(DEFAULT_POLICY, []), device, () => session);
    session = new MirrorSession({
      mirror: device.mirror,
      viewer: async () => {
        const viewer = new ViewerProcess(binary, ['--behind']);
        viewer.onMessage((m) => heard.push(m));
        return viewer;
      },
      options: { quality: 'auto' },
      title: 'a window under test',
      onWindow: (m) => void sends.onWindow(m),
    });
    const tell = session.tell.bind(session);
    session.tell = (m) => {
      told.push(m);
      all.push(m);
      tell(m);
    };
    await session.start();
    await until('a picture', () => session.status.state === 'live', 60_000);
  });

  afterAll(async () => {
    await session?.stop('the test ended');
    device.close();
    vi.unstubAllEnvs();
    rmSync(state, { recursive: true, force: true });
  });

  it(
    'keeps a token typed in the pane once APNs is set up, says it back nowhere, and a push goes by it',
    async () => {
      expect((await types(FIRST_MS)).find((t) => t.type === 'rich')).toMatchObject({
        tokens: ['device'],
      });
      told.length = 0;
      poke({ push: { app: APP, type: 'rich', title: 'Order 42', token: TOKEN, kind: 'device' } });
      expect(await keep()).toMatchObject({ found: true, isIt: 1 });
      await until('the token kept', () => !!answered());
      expect(answered()).toMatchObject({
        ok: true,
        text: `Kept ${APP}'s device token for this session only`,
      });
      expect(heard.find((m) => m.name === 'pushToken')).toMatchObject({
        app: APP,
        token: TOKEN,
        kind: 'device',
      });
      told.length = 0;
      poke({ clickOn: 'pushGo' });
      await until('the push', () => !!answered());
      expect(answered()).toMatchObject({
        ok: false,
        text: expect.stringMatching(
          /^APNs' sandbox refused the push by the device token a person typed at [\d:]{8}: InvalidProviderToken \(403\)/,
        ),
      });
      expect(sent.map((r) => r.headers[':path'])).toEqual([`/3/device/${TOKEN}`]);
      expect(sent[0]!.headers['apns-topic']).toBe(APP);
      // the window's own word of it is the one place the token goes, and this test's pokes
      expect(JSON.stringify(all.filter((m) => m.op !== 'poke'))).not.toContain(TOKEN);
      expect(JSON.stringify(heard.filter((m) => m.name !== 'pushToken'))).not.toContain(TOKEN);
    },
    FIRST_MS + 60_000,
  );

  it('has no token field once APNs is forgotten', async () => {
    rmSync(join(state, 'push', 'apns.json'));
    expect((await types()).filter((t) => t.tokens)).toEqual([]);
    poke({ push: { app: APP, type: 'alert', token: TOKEN, kind: 'device' } });
    // gone from the window, so no click can reach it
    expect(await keep()).toMatchObject({ found: false });
    expect(heard.filter((m) => m.name === 'pushToken')).toEqual([]);
    expect(sent).toHaveLength(1);
  });
});
