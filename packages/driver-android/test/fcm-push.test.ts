import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AndroidEvents } from '../src/events.js';
import { keepFcmKey } from '../src/fcm-key.js';
import { FcmPush, fcmTokensIn, type FcmTarget } from '../src/fcm-push.js';
import type { FcmAnswer, FcmRequest } from '../src/fcm.js';

/** A key made here, none of anyone's, and a token no device has. */
const KEY = {
  projectId: 'appdyno-test',
  clientEmail: 'push@appdyno-test.iam.gserviceaccount.com',
  keyId: 'k1',
  key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }) as string,
};
const TOKEN = `${'a'.repeat(22)}:APA91b${'B'.repeat(140)}`;
/** A service account as Firebase's console gives one, of that key. */
const ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: KEY.projectId,
  private_key_id: KEY.keyId,
  private_key: KEY.key,
  client_email: KEY.clientEmail,
});
const NOW = Date.UTC(2026, 10, 7, 16, 0, 0);
const AT = new Date(NOW).toTimeString().slice(0, 8);

const target = (over: Partial<FcmTarget> = {}): FcmTarget => ({
  installed: async () => true,
  lines: async () => [`11-07 19:00:00.000  1  1 D Push: FCM registration token: ${TOKEN}`],
  ...over,
});

function fcm(t: FcmTarget = target()) {
  const sent: FcmRequest[] = [];
  let answer: FcmAnswer = { status: 200, name: 'projects/appdyno-test/messages/0:1' };
  let now = NOW;
  const p = new FcmPush(t, {
    key: () => KEY,
    send: async (r) => {
      sent.push(r);
      return answer;
    },
    now: () => now,
  });
  return {
    p,
    sent,
    answer: (a: FcmAnswer) => void (answer = a),
    tick: (ms: number) => void (now += ms),
  };
}

const message = (r: FcmRequest) =>
  (JSON.parse(r.body) as { message: Record<string, unknown> }).message;

describe('a push by FCM', () => {
  it('is none until a person sets FCM up', async () => {
    const p = new FcmPush(target(), { key: () => undefined, send: vi.fn(), now: Date.now });
    expect(p.routes()).toEqual([]);
    await expect(p.push('dev.app', { type: 'alert' })).rejects.toThrow(
      'FCM takes no alert push here',
    );
  });

  it("is a notification by the token the app's log gave, high priority, delivered now or never, and says so with no token", async () => {
    const f = fcm();
    const said = await f.p.push('dev.app', {
      type: 'alert',
      title: 'T',
      body: 'B',
      data: { order: '7' },
    });
    expect(said).toBe(
      `pushed to dev.app by FCM by the registration token its log gave at ${AT}: FCM took it, projects/appdyno-test/messages/0:1`,
    );
    expect(message(f.sent[0]!)).toEqual({
      notification: { title: 'T', body: 'B' },
      data: { order: '7' },
      android: { priority: 'HIGH', ttl: '0s' },
      token: TOKEN,
    });
    expect(said).not.toContain(TOKEN);
  });

  it("carries an image, and data alone for a background push or the app's own Live Update", async () => {
    const f = fcm();
    await f.p.push('dev.app', { type: 'rich', title: 'T', image: 'https://example.com/i.png' });
    await f.p.push('dev.app', { type: 'background', data: { sync: '1' } });
    await f.p.push('dev.app', { type: 'live_activity', data: { eta: '5' } });
    const [rich, background, live] = f.sent.map(message);
    expect(rich!.notification).toEqual({ title: 'T', image: 'https://example.com/i.png' });
    expect(background).not.toHaveProperty('notification');
    expect(live).toMatchObject({ data: { eta: '5' }, android: { priority: 'HIGH' } });
  });

  it("takes FCM's own message as the payload, with its priority and TTL, and no target of its own", async () => {
    const f = fcm();
    const own = { data: { a: 'b' }, android: { priority: 'NORMAL', ttl: '3600s' } };
    await f.p.push('dev.app', { type: 'background', payload: own });
    expect(message(f.sent[0]!)).toEqual({ ...own, token: TOKEN });
    await expect(
      f.p.push('dev.app', { type: 'alert', payload: { topic: 'news' } }),
    ).rejects.toThrow('names no topic');
    await expect(
      f.p.push('dev.app', { type: 'alert', payload: { data: { n: 1 } } }),
    ).rejects.toThrow('data is strings alone');
  });

  it('refuses an app not there, and one that printed no token, saying how one is found', async () => {
    await expect(
      fcm(target({ installed: async () => false })).p.push('dev.app', { type: 'alert' }),
    ).rejects.toThrow('dev.app is not installed on this device');
    const none = (await fcm(target({ lines: async () => ['nothing'] }))
      .p.push('dev.app', { type: 'alert' })
      .catch((x: unknown) => x)) as { message: string; hint: string };
    expect(none.message).toBe('no registration token from dev.app in this session');
    expect(none.hint).toContain('onNewToken');
  });

  it('sends 10 a minute to a device at most', async () => {
    const f = fcm();
    for (let i = 0; i < 10; i++) await f.p.push('dev.app', { type: 'alert' });
    await expect(f.p.push('dev.app', { type: 'alert' })).rejects.toThrow('10 pushes a minute');
    f.tick(60_000);
    await f.p.push('dev.app', { type: 'alert' });
    expect(f.sent).toHaveLength(11);
  });

  it("says FCM's code in words, and reads the token again after one no longer valid", async () => {
    const lines = vi.fn(target().lines);
    const f = fcm(target({ lines }));
    f.answer({ status: 404, code: 'UNREGISTERED' });
    const e = (await f.p.push('dev.app', { type: 'alert' }).catch((x: unknown) => x)) as {
      message: string;
      hint: string;
    };
    expect(e.message).toBe(
      `FCM refused the push by the registration token its log gave at ${AT}: UNREGISTERED (404)`,
    );
    expect(e.hint).toContain('no longer valid');
    f.answer({ status: 200 });
    await f.p.push('dev.app', { type: 'alert' });
    expect(lines).toHaveBeenCalledTimes(2);
  });

  it("takes a person's token, typed in a window, and nothing that is not one", async () => {
    const f = fcm(target({ lines: async () => [] }));
    f.p.typed('dev.app', TOKEN);
    expect(await f.p.push('dev.app', { type: 'alert' })).toContain('a person typed');
    expect(() => f.p.typed('dev.app', 'abc')).toThrow('not a registration token');
  });

  it('finds tokens in lines, and nothing shorter', () => {
    expect(fcmTokensIn([`token=${TOKEN}.`, 'short:abc'])).toEqual([TOKEN]);
  });
});

describe("an Android device's pushes, by FCM once it is set up", () => {
  it("go by FCM for what only Google delivers, read the app's own logcat for its token, and leave a tap as it was", async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-fcm-')));
    const asked: string[] = [];
    const adb = {
      exec: async (_serial: string, command: string) => {
        asked.push(command);
        if (command.startsWith('pm path')) return 'package:/data/app/base.apk';
        if (command.startsWith('pidof')) return '4242\n';
        if (command.startsWith('logcat')) return `D Push: token ${TOKEN}\n`;
        return '';
      },
    };
    const events = new AndroidEvents(adb as never, 'emulator-5554');
    const route = async (type: string) => (await events.pushRoutes()).find((r) => r.type === type)!;
    expect(await route('background')).toMatchObject({
      why: expect.stringContaining("the app's own Firebase SDK takes it, as FCM's own message"),
    });
    keepFcmKey(ACCOUNT);
    expect(await route('background')).toMatchObject({
      route: expect.stringMatching(/^FCM, data alone/),
      tokens: ['device'],
    });
    expect(await route('tapped')).toMatchObject({
      route: expect.stringContaining('the launcher activity'),
    });
    // a person types a token only for what goes by FCM
    expect('tokens' in (await route('tapped'))).toBe(false);
    // nothing leaves this Mac: fetch is this test's
    const post = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ name: 'n' }));
    expect(await events.push('dev.app', { type: 'background', data: { a: 'b' } })).toContain(
      'pushed to dev.app by FCM',
    );
    expect(post.mock.calls[0]![0]).toBe(
      'https://fcm.googleapis.com/v1/projects/appdyno-test/messages:send',
    );
    expect(asked.find((c) => c.startsWith('logcat'))).toMatch(/^logcat -d --pid=4242 /);
    post.mockRestore();
    vi.unstubAllEnvs();
  });
});
