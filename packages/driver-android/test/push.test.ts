import { describe, expect, it } from 'vitest';
import { ANDROID_PUSHES, AndroidPush } from '../src/push.js';

/** A device whose shell answers `answer` to each command, and what it was asked. */
const device = (answer = (_: string) => '') => {
  const asked: string[] = [];
  const push = new AndroidPush(async (c) => (asked.push(c), answer(c)));
  return { push, asked };
};
const LAUNCHER = 'priority=0 preferredOrder=0\ndev.app/.Main';

describe('a push on Android', () => {
  it('opens the launcher activity as a tapped push does, its data as extras', async () => {
    const { push, asked } = device((c) => (c.startsWith('cmd package') ? LAUNCHER : 'Status: ok'));
    const said = await push.send('dev.app', {
      type: 'tapped',
      data: { order: '42', note: "it's" },
    });
    expect(said).toBe(
      "opened dev.app as a tapped push, with 2 data keys as extras: no onMessageReceived: that needs Google's servers",
    );
    expect(asked.at(-1)).toBe(
      "am start -W -f 0x04000000 -n dev.app/.Main --es order '42' --es note 'it'\\''s'",
    );
  });

  it("takes FCM's own message: its click_action and data", async () => {
    const { push, asked } = device(() => 'Status: ok');
    const payload = {
      notification: { title: 'T', click_action: 'dev.app.OPEN' },
      data: { order: 7 },
    };
    await push.send('dev.app', { type: 'tapped', payload });
    expect(asked).toEqual([
      "am start -W -f 0x04000000 -a 'dev.app.OPEN' -p dev.app --es order '7'",
    ]);
  });

  it('draws a style, and says the app got nothing', async () => {
    const { push, asked } = device();
    const said = await push.send('dev.app', { type: 'inbox', title: 'T', body: 'one\ntwo' });
    expect(said).toMatch(
      /^drawn by the shell in the inbox style, not by dev\.app: its code got nothing/,
    );
    expect(asked[0]).toBe(
      "cmd notification post -S inbox --line 'one' --line 'two' -t 'T' appdyno-dev.app 'one'",
    );
  });

  it('refuses a data key a shell would take apart, and what only Google sends', async () => {
    await expect(
      device().push.send('dev.app', { type: 'tapped', data: { 'a b': 'c' } }),
    ).rejects.toThrow('a data key is letters, digits, _ . -: not a b');
    const routes = Object.fromEntries(
      ANDROID_PUSHES.map((r) => [r.type, 'route' in r ? 'route' : r.why]),
    );
    expect(routes.background).toContain("no onMessageReceived: that needs Google's servers");
    expect(routes.alert).toBe('route');
    expect(routes.voip).toContain('an iOS push');
    expect(Object.keys(routes)).toHaveLength(10);
  });
});
