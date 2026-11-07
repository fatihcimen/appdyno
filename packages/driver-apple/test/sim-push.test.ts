import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apnsPayload } from '../src/apns-payload.js';
import { simulatorPush, simulatorRoutes } from '../src/sim-push.js';
import type { Simctl } from '../src/simctl.js';

describe('a push to a simulator', () => {
  it('is made as APNs takes it, from the fields', () => {
    expect(apnsPayload({ type: 'alert', title: 'T', body: 'B', data: { order: '42' } })).toEqual({
      aps: { alert: { title: 'T', body: 'B' }, sound: 'default' },
      order: '42',
    });
    expect(apnsPayload({ type: 'rich', title: 'T', image: 'https://x/i.png' })).toEqual({
      aps: { alert: { title: 'T' }, sound: 'default', 'mutable-content': 1 },
      image: 'https://x/i.png',
    });
    const own = { aps: { badge: 2 }, k: 'v' };
    expect(apnsPayload({ type: 'alert', payload: own })).toBe(own);
    expect(() => apnsPayload({ type: 'alert', payload: { k: 'v' } })).toThrow(
      'an APNs payload has aps: an object',
    );
  });

  it('goes by simctl to the app, and says what reached its code from where the app was', async () => {
    let sent: unknown;
    let running = true;
    const simctl = {
      exec: async (args: string[]) => {
        sent = [args.slice(0, 3), JSON.parse(readFileSync(args[3]!, 'utf8'))];
        return '';
      },
      pid: async () => {
        if (!running) throw new Error('not running');
        return 7;
      },
    } as unknown as Simctl;
    const push = (front?: string) =>
      simulatorPush(simctl, 'U', 'dev.app', { type: 'alert', title: 'T' }, async () => front);
    expect(await push('dev.app')).toBe(
      'pushed to dev.app by simctl: it is in front, and its code gets it as a remote notification',
    );
    expect(sent).toEqual([
      ['push', 'U', 'dev.app'],
      { aps: { alert: { title: 'T' }, sound: 'default' } },
    ]);
    expect(await push('com.apple.springboard')).toContain(
      'it is in the background, so the push is only shown: its code gets it when the banner is tapped',
    );
    expect(await push()).toContain('(what is in front could not be read)');
    running = false;
    expect(await push()).toContain('it is not running, so the push is only shown');
    sent = undefined;
    await expect(
      simulatorPush(simctl, 'U', 'dev.app', { type: 'rich', title: 'T' }, async () => undefined),
    ).rejects.toThrow('runs no Notification Service Extension');
    expect(sent).toBeUndefined();
  });

  it('says what an app no one allowed notifications got: its code, only in front', async () => {
    const simctl = {
      exec: async () => {
        throw new Error(
          'simctl push: Underlying error (domain=UNErrorDomain, code=2003): Repository could not save notification. Source is not authorized.',
        );
      },
      pid: async () => 7,
    } as unknown as Simctl;
    const push = (front?: string) =>
      simulatorPush(simctl, 'U', 'dev.app', { type: 'alert', title: 'T' }, async () => front);
    expect(await push('dev.app')).toBe(
      'pushed to dev.app by simctl, which shows none, as it is not allowed notifications: it is in front, and its code gets it as a remote notification',
    );
    expect(await push()).toContain('its code gets it only if it is in front');
    await expect(push('com.apple.springboard')).rejects.toThrow(
      'dev.app is not allowed notifications, and is not in front: the push reached nothing',
    );
  });

  it('names a route for each type, or why it has none, and says what takes it instead', () => {
    const routes = Object.fromEntries(
      simulatorRoutes([]).map((r) => [r.type, 'route' in r ? 'route' : r.why]),
    );
    const byApns =
      "APNs' sandbox takes it to a simulator, by a key of the app's team a person sets up with `appdyno push setup apns`";
    expect(routes).toEqual({
      alert: 'route',
      rich: `simctl push runs no Notification Service Extension, as Xcode's notes say: ${byApns}, and an alert here reaches the app's code with the same keys`,
      background: `simctl takes no push with nothing to see, "no user visible content": ${byApns}`,
      tapped: 'simctl taps nothing: push an alert, then tap its banner',
      live_activity: `simctl push makes a notification, which no Live Activity takes: ${byApns}`,
      voip: `simctl takes no VoIP push, as its help says: ${byApns}`,
      widgets: `simctl push makes a notification, which no widget takes: ${byApns}`,
      inbox: 'an Android style: an iOS push shows as an alert',
      messaging: 'an Android style: an iOS push shows as an alert',
      media: 'an Android style: an iOS push shows as an alert',
    });
  });

  it('takes the routes of APNs once a person set it up, and keeps the alert to simctl', () => {
    const byApns = { type: 'rich' as const, route: 'APNs', fields: [], template: '{}' };
    const routes = simulatorRoutes([byApns, { ...byApns, type: 'alert' }]);
    expect(routes.find((r) => r.type === 'rich')).toBe(byApns);
    expect(routes.find((r) => r.type === 'alert')).toMatchObject({
      route: expect.stringMatching(/^simctl push/),
    });
  });
});
