import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apnsPayload, SIMULATOR_PUSHES, simulatorPush } from '../src/sim-push.js';
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

  it('goes by simctl to the app, and says what reached its code', async () => {
    let sent: unknown;
    const simctl = {
      exec: async (args: string[]) => {
        sent = [args.slice(0, 3), JSON.parse(readFileSync(args[3]!, 'utf8'))];
        return '';
      },
    } as unknown as Simctl;
    const said = await simulatorPush(simctl, 'U', 'dev.app', { type: 'alert', title: 'T' });
    expect(said).toBe('pushed to dev.app by simctl: its code gets it as a remote notification');
    expect(sent).toEqual([
      ['push', 'U', 'dev.app'],
      { aps: { alert: { title: 'T' }, sound: 'default' } },
    ]);
    sent = undefined;
    await expect(
      simulatorPush(simctl, 'U', 'dev.app', { type: 'rich', title: 'T' }),
    ).rejects.toThrow('runs no Notification Service Extension');
    expect(sent).toBeUndefined();
  });

  it('names a route for each type, or why it has none', () => {
    const routes = Object.fromEntries(
      SIMULATOR_PUSHES.map((r) => [r.type, 'route' in r ? 'route' : r.why]),
    );
    expect(routes).toMatchObject({
      alert: 'route',
      rich: "simctl push runs no Notification Service Extension, as Xcode's notes say: an alert reaches the app's code with the same keys",
      background:
        'simctl takes no push with nothing to see: it says it has no user visible content',
      tapped: 'simctl taps nothing: push an alert, then tap its banner',
    });
  });
});
