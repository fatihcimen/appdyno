import { encodePng } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect } from './driving/shared.js';

/** A call of each tool of several parts, with an argument that belongs to another of its parts. */
const ANOTHER_PARTS = [
  ['read_logs', { limit: 5, symbols: '/tmp/a.dSYM' }, 'symbols'],
  ['read_logs', { source: 'crashes', contains: 'x' }, 'contains'],
  ['check_screen', { check: 'accessibility', name: 'home' }, 'name'],
  ['check_screen', { check: 'visual', name: 'home', types: ['contrast'] }, 'types'],
  ['inspect_app', { action: 'web_pages', name: 'Pay' }, 'name'],
  ['inspect_app', { action: 'ax_list', js: '1' }, 'js'],
  ['inspect_app', { action: 'rn_targets', page: 'a' }, 'page'],
  ['record_session', { kind: 'video', action: 'start', dir: '/tmp/a' }, 'dir'],
  ['record_session', { kind: 'report', action: 'start', file: '/tmp/a.mp4' }, 'file'],
  ['manage_app', { action: 'stop', path: '/tmp/a.apk' }, 'path'],
  ['manage_app', { action: 'state', background: true }, 'background'],
  ['set_device', { name: 'orientation', value: 'portrait', title: 'a' }, 'title'],
  ['set_device', { name: 'clipboard', value: 'a', app: 'dev.app' }, 'app'],
  ['read_screen', { selector: { text: 'Form' }, views: true }, 'views'],
  ['measure_performance', { metric: 'snapshot', swipes: 3 }, 'swipes'],
  ['measure_performance', { metric: 'heap', also: ['threads'] }, 'also'],
  ['measure_performance', { metric: 'cpu', trace: true }, 'trace'],
  ['compare_performance', { action: 'query', trace: '/tmp/a.pftrace', kind: 'a' }, 'kind'],
  ['compare_performance', { action: 'budget', sql: 'SELECT 1' }, 'sql'],
] as const;

describe('a tool of several parts', () => {
  it.each(ANOTHER_PARTS)(
    "%s %j refuses %s, an argument of another of its parts, as that part's own schema does",
    async (tool, args, stray) => {
      const { call } = await connect(new FakeDevice());
      const r = await call(tool, args);
      expect(r.data.code, r.text).toBe('INVALID_ARGUMENT');
      expect(r.text).toContain(`Unrecognized key: "${stray}"`);
    },
  );

  it('names the tool, the action and the argument to give next as the list of tools has them', async () => {
    const d = new FakeDevice();
    const png = encodePng({ width: 2, height: 2, channels: 3, data: new Uint8Array(12) });
    d.screenshot = () =>
      Promise.resolve({ meta: { w: 2, h: 2, format: 'png', bytes: png.length }, data: png });
    const { call } = await connect(d);
    expect((await call('compare_performance', {})).text).toBe(
      'NOT_FOUND: no measured runs: measure_performance keeps them, by its scenario',
    );
    expect((await call('check_screen', { check: 'visual', name: 'home' })).text).toMatch(
      /^NOT_FOUND: no baseline .*home\.png: save one with check visual_baseline$/,
    );
    expect((await call('transfer_files', { action: 'pull', path: '' })).text).toBe(
      'INVALID_ARGUMENT: pull needs path',
    );
    expect((await call('transfer_files', { action: 'push', path: '' })).text).toMatch(
      /^INVALID_ARGUMENT: push needs path/,
    );
  });

  it('names an argument as its caller wrote it, where its part calls it otherwise', async () => {
    const { call } = await connect(new FakeDevice());
    const logs = await call('read_logs', { limit: 100_000 });
    expect(logs.text).toMatch(/^INVALID_ARGUMENT: limit: Too big/);
    const turn = await call('set_device', { name: 'orientation', value: 'sideways' });
    expect(turn.text).toMatch(/^INVALID_ARGUMENT: value: Invalid option/);
    const place = await call('set_device', { name: 'location', value: 'here' });
    expect(place.text).toMatch(/^INVALID_ARGUMENT: location takes value lat,lon/);
  });
});

describe('a touch by what it is given', () => {
  it('refuses two ways to move a finger at once, an argument of another way, and a swipe with no direction', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const before = d.calls.length;
    const two = await call('swipe_screen', { until: { text: 'Form' }, to: { x: 1, y: 1 } });
    expect(two.text).toMatch(
      /^INVALID_ARGUMENT: until and to are 2 ways to move a finger: give one/,
    );
    const stray = await call('swipe_screen', { scale: 2, direction: 'up' });
    expect(stray.text).toMatch(
      /^INVALID_ARGUMENT: direction does not go with scale: it takes x, y, durationMs/,
    );
    const none = await call('swipe_screen', { x: 10, y: 10 });
    expect(none.text).toMatch(/^INVALID_ARGUMENT: a swipe needs direction/);
    const long = await call('swipe_screen', { scale: 2, durationMs: 60_000 });
    expect(long.text).toMatch(/^INVALID_ARGUMENT: durationMs: Too big/);
    const lone = await call('swipe_screen', { direction: 'up', maxSwipes: 3 });
    expect(lone.text).toMatch(
      /^INVALID_ARGUMENT: maxSwipes goes with until, to, scale or pointers/,
    );
    expect(d.calls.filter((c) => c.name === 'act').length).toBe(
      d.calls.slice(0, before).filter((c) => c.name === 'act').length,
    );
  });

  it('taps once or twice and no more, and holds or taps twice, not both', async () => {
    const { call } = await connect(new FakeDevice());
    const three = await call('tap_screen', { x: 100, y: 350, count: 3 });
    expect(three.text).toMatch(/^INVALID_ARGUMENT: count: 1, or 2 for a double tap/);
    const both = await call('tap_screen', { x: 100, y: 350, count: 2, holdMs: 500 });
    expect(both.text).toMatch(/^INVALID_ARGUMENT: count: 2 and holdMs are two touches: give one/);
    expect((await call('tap_screen', { x: 100, y: 350, count: 2 })).text).toMatch(/^double-tapped/);
    expect((await call('tap_screen', { x: 100, y: 350, holdMs: 500 })).text).toMatch(
      /^long-pressed/,
    );
  });

  it('fails a check with CHECK_FAILED, given time or none, in a call of its own and as a step', async () => {
    const { call } = await connect(new FakeDevice());
    const never = { selector: { text: 'Never' } };
    for (const args of [never, { ...never, timeoutMs: 300 }]) {
      expect((await call('check_element', args)).data.code).toBe('CHECK_FAILED');
      const step = await call('run_steps', { steps: [{ tool: 'check_element', ...args }] });
      expect(step.data.code).toBe('CHECK_FAILED');
    }
  });
});

describe('a name tools had before 1.3.0', () => {
  it('is no step, and the refusal says the name to call', async () => {
    const { call } = await connect(new FakeDevice());
    const r = await call('run_steps', { steps: [{ tool: 'tap', x: 1, y: 1 }] });
    expect(r.text).toBe('INVALID_ARGUMENT: step 1: no step tap\nhint: tap is now tap_screen');
    const never = await call('run_steps', { steps: [{ tool: 'fly' }] });
    expect(never.text).toContain('hint: change that and call again');
  });
});
