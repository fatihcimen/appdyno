import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ApnsPush, tokensIn, type ApnsTarget } from '../src/apns-push.js';
import type { ApnsAnswer, ApnsEnvironment, ApnsRequest } from '../src/apns.js';

/** A key made here, none of anyone's, and tokens no device has. */
const KEY = {
  key: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }) as string,
  keyId: 'ABC123DEFG',
  teamId: 'DEF123GHIJ',
  production: false,
};
const DEVICE = 'ab'.repeat(32);
/** The time a push answer gives a token, on this Mac's clock. */
const NOW = Date.UTC(2026, 10, 7, 15, 0, 0);
const AT = new Date(NOW).toTimeString().slice(0, 8);
const ACTIVITY = 'cd'.repeat(40);
const START = 'ef'.repeat(40);
const LINES = [
  `2026-11-07 18:00:00.000 Df App[1:2] device token: ${DEVICE}`,
  `2026-11-07 18:00:01.000 Df App[1:2] Live Activity push token ${ACTIVITY}`,
  `2026-11-07 18:00:02.000 Df App[1:2] push to start token ${START}`,
];

const target = (over: Partial<ApnsTarget> = {}): ApnsTarget => ({
  name: 'simulator',
  production: false,
  installed: async () => true,
  lines: async () => ({ lines: LINES }),
  build: async () => undefined,
  declaresVoip: async () => false,
  osMajor: async () => 27,
  ...over,
});

/** APNs as this Mac's code sees it: what was sent, and the answer given. */
function apns(t: ApnsTarget = target(), key = KEY) {
  const sent: { environment: ApnsEnvironment; request: ApnsRequest }[] = [];
  let answer: ApnsAnswer = { status: 200, apnsId: 'A1' };
  let now = NOW;
  const p = new ApnsPush(t, {
    key: () => key,
    send: async (environment, request) => {
      sent.push({ environment, request });
      return answer;
    },
    now: () => now,
  });
  return {
    p,
    sent,
    answer: (a: ApnsAnswer) => void (answer = a),
    tick: (ms: number) => void (now += ms),
  };
}

/** Nothing of a key, a provider token or an app's token in any answer or refusal. */
const secretsIn = (words: string, jwt?: string) =>
  [DEVICE, ACTIVITY, START, KEY.key.split('\n')[1]!, ...(jwt ? [jwt] : [])].filter((s) =>
    words.includes(s),
  );

describe("an app's tokens in its own lines", () => {
  it('are known by the words of their line, and any other is the device token', () => {
    expect(tokensIn(LINES)).toEqual([
      { token: DEVICE, kind: 'device' },
      { token: ACTIVITY, kind: 'activity' },
      { token: START, kind: 'start' },
    ]);
    expect(
      tokensIn([`PushKit voip token ${DEVICE}`, `widget token ${DEVICE}`, 'short ab12']),
    ).toEqual([
      { token: DEVICE, kind: 'voip' },
      { token: DEVICE, kind: 'widget' },
    ]);
  });
});

describe('a push by APNs', () => {
  it('is none until a person sets APNs up: the routes say nothing of it, and a push is refused', async () => {
    const p = new ApnsPush(target(), { key: () => undefined, send: vi.fn(), now: Date.now });
    expect(p.ready).toBe(false);
    expect(p.routes()).toEqual([]);
    await expect(p.push('dev.app', { type: 'alert', title: 'T' })).rejects.toThrow(
      'APNs takes no alert push here',
    );
  });

  it('goes to the sandbox by the device token the app printed, and says so, with no token in its words', async () => {
    const a = apns();
    const said = await a.p.push('dev.app', { type: 'alert', title: 'T', data: { order: '7' } });
    expect(said).toBe(
      `pushed to dev.app by APNs' sandbox by the device token its log gave at ${AT}: APNs took it, A1`,
    );
    expect(a.sent).toHaveLength(1);
    const { environment, request } = a.sent[0]!;
    expect(environment).toBe('sandbox');
    expect(request.headers).toMatchObject({
      ':path': `/3/device/${DEVICE}`,
      'apns-topic': 'dev.app',
      'apns-push-type': 'alert',
    });
    expect(JSON.parse(request.body)).toEqual({
      aps: { alert: { title: 'T' }, sound: 'default' },
      order: '7',
    });
    expect(secretsIn(said, request.headers.authorization)).toEqual([]);
  });

  it("updates a Live Activity by its own token, starts one by push to start's, and fills in the time", async () => {
    const a = apns();
    const state = { 'content-state': { eta: '5 min' } };
    await a.p.push('dev.app', {
      type: 'live_activity',
      payload: { aps: { event: 'update', ...state } },
    });
    const start = {
      aps: {
        event: 'start',
        ...state,
        'attributes-type': 'Order',
        attributes: {},
        alert: { title: 'On its way' },
      },
    };
    await a.p.push('dev.app', { type: 'live_activity', payload: start });
    const [update, started] = a.sent.map((s) => s.request);
    expect(update!.headers).toMatchObject({
      ':path': `/3/device/${ACTIVITY}`,
      'apns-topic': 'dev.app.push-type.liveactivity',
      'apns-push-type': 'liveactivity',
    });
    expect(JSON.parse(update!.body).aps.timestamp).toBe(NOW / 1000);
    expect(started!.headers[':path']).toBe(`/3/device/${START}`);
  });

  it("refuses a Live Activity's payload that is not ActivityKit's", async () => {
    const a = apns();
    for (const [aps, why] of [
      [{ event: 'go' }, 'aps.event is start, update or end'],
      [{ event: 'update' }, 'aps.content-state is an object'],
      [{ event: 'start', 'content-state': {} }, 'attributes-type, attributes and an alert'],
    ] as const)
      await expect(
        a.p.push('dev.app', { type: 'live_activity', payload: { aps } }),
      ).rejects.toThrow(why);
    await expect(a.p.push('dev.app', { type: 'live_activity' })).rejects.toThrow('is its payload');
    expect(a.sent).toEqual([]);
  });

  it('refuses an app that is not there, a token the app never printed, VoIP it does not declare, a widget before iOS 26', async () => {
    const cases: [Partial<ApnsTarget>, Parameters<ApnsPush['push']>[1], string][] = [
      [
        { installed: async () => false },
        { type: 'alert' },
        'dev.app is not installed on this simulator',
      ],
      [
        { lines: async () => ({ lines: ['nothing'] }) },
        { type: 'alert' },
        'no device token from dev.app in this session',
      ],
      [{}, { type: 'voip' }, 'not known to declare VoIP'],
      [{ osMajor: async () => 25 }, { type: 'widgets' }, 'a widget takes pushes from iOS 26'],
    ];
    for (const [over, push, why] of cases) {
      const a = apns(target(over));
      await expect(a.p.push('dev.app', push)).rejects.toThrow(why);
      expect(a.sent).toEqual([]);
    }
    const none = await apns(target({ lines: async () => ({ lines: [] }) }))
      .p.push('dev.app', { type: 'alert' })
      .catch((e: { hint?: string }) => e.hint);
    expect(none).toContain('by NSLog or os_log');
  });

  it('takes VoIP where the app declares it, and a widget from iOS 26, each by its own token and topic', async () => {
    const lines = [`voip token ${DEVICE}`, `widget token ${ACTIVITY}`];
    const a = apns(target({ declaresVoip: async () => true, lines: async () => ({ lines }) }));
    await a.p.push('dev.app', { type: 'voip', data: { call: '1' } });
    await a.p.push('dev.app', { type: 'widgets' });
    expect(
      a.sent.map((s) => [s.request.headers['apns-topic'], s.request.headers[':path']]),
    ).toEqual([
      ['dev.app.voip', `/3/device/${DEVICE}`],
      ['dev.app.push-type.widgets', `/3/device/${ACTIVITY}`],
    ]);
  });

  it('goes to production only for a distribution build on an iPhone with production on, never by a guess', async () => {
    const iphone = (build: 'development' | 'distribution' | undefined) =>
      target({ name: 'iPhone', production: true, build: async () => build });
    const environmentOf = async (t: ApnsTarget, production: boolean) => {
      const a = apns(t, { ...KEY, production });
      await a.p.push('dev.app', { type: 'alert' }).catch(() => undefined);
      return a.sent[0]?.environment;
    };
    expect(await environmentOf(iphone('distribution'), true)).toBe('production');
    expect(await environmentOf(iphone('development'), true)).toBe('sandbox');
    expect(await environmentOf(iphone(undefined), true)).toBe('sandbox');
    expect(await environmentOf(target({ build: async () => 'distribution' }), true)).toBe(
      'sandbox',
    );
    const off = apns(iphone('distribution'));
    await expect(off.p.push('dev.app', { type: 'alert' })).rejects.toThrow('production is off');
    expect(off.sent).toEqual([]);
  });

  it('sends 10 a minute to a device at most', async () => {
    const a = apns();
    for (let i = 0; i < 10; i++) await a.p.push('dev.app', { type: 'alert' });
    await expect(a.p.push('dev.app', { type: 'alert' })).rejects.toThrow('10 pushes a minute');
    a.tick(60_000);
    await a.p.push('dev.app', { type: 'alert' });
    expect(a.sent).toHaveLength(11);
  });

  it("says Apple's reason in words, on the host it went to alone, and reads a token again after a bad one", async () => {
    const lines = vi.fn(async () => ({ lines: LINES }));
    const a = apns(target({ lines }));
    a.answer({ status: 400, reason: 'BadDeviceToken' });
    const e = (await a.p.push('dev.app', { type: 'alert' }).catch((x: unknown) => x)) as {
      message: string;
      hint: string;
    };
    expect(e.message).toBe(
      `APNs' sandbox refused the push by the device token its log gave at ${AT}: BadDeviceToken (400)`,
    );
    expect(e.hint).toContain('the other environment');
    expect(a.sent.map((s) => s.environment)).toEqual(['sandbox']);
    expect(secretsIn(`${e.message} ${e.hint}`)).toEqual([]);
    a.answer({ status: 200 });
    await a.p.push('dev.app', { type: 'alert' });
    expect(lines).toHaveBeenCalledTimes(2);
  });

  it("takes a person's token, typed in a window, and no other", async () => {
    const a = apns(target({ lines: async () => ({ lines: [] }) }));
    a.p.typed('dev.app', DEVICE.toUpperCase());
    expect(await a.p.push('dev.app', { type: 'alert' })).toContain(
      'by the device token a person typed',
    );
    expect(() => a.p.typed('dev.app', 'xyz')).toThrow('a token is hex');
  });

  it('says the app was relaunched to read its token, and that it lost its state', async () => {
    const a = apns(target({ lines: async () => ({ lines: LINES, relaunched: true }) }));
    expect(await a.p.push('dev.app', { type: 'alert' })).toContain(
      'dev.app was relaunched to read it, and lost its state',
    );
  });

  it('lists each type APNs takes, by its token, once set up', () => {
    const routes = apns().p.routes();
    expect(routes.map((r) => r.type)).toEqual([
      'alert',
      'rich',
      'background',
      'live_activity',
      'voip',
      'widgets',
    ]);
    expect(routes.find((r) => r.type === 'live_activity')).toMatchObject({
      fields: [],
      template: '{"aps":{"event":"update","content-state":{"key":"value"}}}',
    });
  });
});
