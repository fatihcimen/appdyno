import type { NetworkEntry } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { captures } from '../../src/network-capture.js';
import { probeSetup } from './fake-probe.js';
import { callerOf, flowsFor } from './harness.js';

/** A request that ends a minute from now: after whatever action comes next began. */
const later = (over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  at: new Date(Date.now() + 60_000).toISOString(),
  method: 'POST',
  url: 'https://api.test/v1/pay?card=4111',
  status: 500,
  ms: 85,
  ...over,
});
const TAP = { selector: { text: 'Ana sayfa' } };

describe('a request that failed under an action', () => {
  const at = probeSetup();
  const { context, refusal, recorded } = at.helpers;

  it('is in the answer of the action, once, in a line, with what a rule made of it marked', async () => {
    const call = callerOf(context());
    await call('capture_network', { action: 'start', via: 'probe' });
    // what ended before the first action is not its own
    at.probe.entries = [later({ at: new Date(Date.now() - 5_000).toISOString() })];
    expect((await call('tap_screen', TAP)).text).not.toContain('network:');
    at.probe.entries.push(
      later(),
      later({ method: 'GET', url: 'https://api.test/me', status: 404 }),
      later({ status: 200 }),
      // one the app gave up, and one that ended with the app, are no failure of the network's
      later({ status: 0, error: 'cancelled', code: -999 }),
      later({ status: 0, error: 'the app ended before it did' }),
      later({ status: 0, error: 'The request timed out.', code: -1001, how: 'failed' }),
    );
    const tap = await call('tap_screen', TAP);
    const lines = tap.text.split('\n').filter((l) => l.startsWith('network:'));
    expect(lines).toEqual([
      'network: POST api.test/v1/pay 500 (id 1)',
      'network: GET api.test/me 404 (id 2)',
      'network: POST api.test/v1/pay failed: The request timed out. [failed by a rule] (id 6)',
    ]);
    expect(tap.data.warnings).toEqual(expect.arrayContaining(lines));
    // told once: the next action says nothing of them
    expect((await call('tap_screen', TAP)).text).not.toContain('network:');
    // one that began before this action and ended after the last answer says so; past three they are counted
    at.probe.entries.push(
      later({ at: new Date(Date.now() - 1).toISOString() }),
      later(),
      later(),
      later(),
      later(),
    );
    const many = (await call('tap_screen', TAP)).text
      .split('\n')
      .filter((l) => l.startsWith('network:'));
    expect(many).toEqual([
      'network: POST api.test/v1/pay 500 (id 7, before this action)',
      'network: POST api.test/v1/pay 500 (id 8)',
      'network: POST api.test/v1/pay 500 (id 9)',
      'network: 2 more failed: capture_network read lists them first',
    ]);
  });

  it('says nothing with no capture by the probe, and costs an answer nothing when none failed', async () => {
    const call = callerOf(context());
    const plain = (await call('tap_screen', TAP)).text;
    await call('capture_network', { action: 'start', via: 'probe' });
    at.probe.entries = [later({ status: 200 })];
    expect((await call('tap_screen', TAP)).text.length).toBeLessThanOrEqual(plain.length);
  });

  it('fails the action under strict, for a 5xx or a failure no rule made, and says what the action did', async () => {
    const call = callerOf(context());
    const on = await call('capture_network', { action: 'mock', strict: true });
    expect(on.text).toMatch(
      /^started a capture by the probe: dev\.app was restarted with it\nstrict on: /,
    );
    expect(on.text).toContain('\nstrict: on');
    expect(captures.read(at.device.serial)?.strict).toBe(true);
    // refused by the server, or failed by a rule of one's own: said, and no failure of the action
    at.probe.entries = [
      later({ status: 404 }),
      later({ how: 'mocked' }),
      later({ status: 0, error: 'offline', code: -1009, how: 'failed' }),
    ];
    expect((await call('tap_screen', TAP)).text).toContain(
      'network: POST api.test/v1/pay 404 (id 0)',
    );
    at.probe.entries.push(later());
    const e = await refusal(call('tap_screen', TAP));
    expect(e.code).toBe('CHECK_FAILED');
    expect(e.message).toMatch(
      /^tapped .*"Ana sayfa"\nnetwork strict: POST api\.test\/v1\/pay 500 \(id 3\)$/,
    );
    expect(e.hint).toContain('capture_network mock strict: false ends this');
    at.probe.entries.push(later({ status: 0, error: 'The request timed out.', code: -1001 }));
    expect((await refusal(call('tap_screen', TAP))).message).toContain(
      'failed: The request timed out.',
    );
    const off = await call('capture_network', { action: 'mock', strict: false });
    expect(off.text).toBe('strict off\nno rule is set');
    at.probe.entries.push(later());
    expect((await call('tap_screen', TAP)).text).toContain(
      'network: POST api.test/v1/pay 500 (id 5)',
    );
    // with a capture it starts, and nowhere it has no meaning
    await call('capture_network', { action: 'stop' });
    await call('capture_network', { action: 'start', via: 'probe', strict: true });
    expect(captures.read(at.device.serial)?.strict).toBe(true);
    expect((await refusal(call('capture_network', { action: 'read', strict: true }))).message).toBe(
      'strict goes with start, mock or throttle',
    );
  });

  it('fails a flow’s step under network strict, a step that only looks too, and puts strict back after', async () => {
    const ctx = context();
    const flows = flowsFor(ctx);
    // what fails comes once strict is set: the step's own answer and the look after it read the list first
    const afterStrict = () => {
      let reads = 0;
      at.probe.read = () =>
        Promise.resolve({
          entries: (++reads > 2 ? at.probe.entries : []).map((e, id) => ({ ...e, id })),
        });
    };
    afterStrict();
    const acts = at.flowFile('network strict\ntap text="Ana sayfa"');
    at.probe.entries = [later()];
    const r = await flows.replay(acts);
    expect(r.passed).toBe(false);
    expect(r.failure?.n).toBe(2);
    expect(r.failure?.message).toContain('network strict: POST api.test/v1/pay 500 (id 0)');
    expect(captures.read(at.device.serial)?.strict).toBeUndefined();
    at.probe.entries.push(later());
    afterStrict();
    const looks = await flows.replay(at.flowFile('network strict\nassert text="Ana sayfa"'));
    expect(looks.failure?.message).toBe('network strict: POST api.test/v1/pay 500 (id 1)');
    // with strict off the same request is a warning of its step, and the flow passes
    at.probe.entries.push(later());
    afterStrict();
    const lax = await flows.replay(at.flowFile('network strict off\nassert text="Ana sayfa"'));
    expect(lax.passed).toBe(true);
    expect(lax.steps[1]?.warnings).toEqual(['network: POST api.test/v1/pay 500 (id 2)']);
  });

  it('records strict as a step, and reads only strict, on or off, after network', async () => {
    const call = callerOf(context());
    const { text } = await recorded(call, async () => {
      await call('capture_network', { action: 'mock', strict: true });
      await call('capture_network', { action: 'mock', strict: false });
    });
    expect(text).toContain('network strict\nnetwork strict off\n');
    const bad = await refusal(flowsFor(context()).replay(at.flowFile('network loud')));
    expect(bad.message).toContain('network: strict, strict on or strict off');
  });
});
