import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Device } from '@appdyno/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { callerOf, flowHelpers, SECRET } from './harness.js';

describe('the steps a replay judges', () => {
  let dir: string;
  let device: FakeDevice;
  const { context, refusal } = flowHelpers(
    () => device,
    () => dir,
  );
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'appdyno-flow-'));
    vi.stubEnv('APPDYNO_STATE_DIR', join(dir, 'state'));
    device = new FakeDevice();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const run = (ctx: ReturnType<typeof context>, ...lines: string[]) => {
    const file = join(dir, 'a.flow');
    writeFileSync(file, `app dev.app\n${lines.join('\n')}\n`);
    return callerOf(ctx)('run_flow', { action: 'run', file });
  };
  const did = (name: string) => device.calls.filter((c) => c.name === name).map((c) => c.args[0]);

  it("skips a step of the other platform, says so, and checks none of its line's needs", async () => {
    const out = await run(
      context(),
      'launch',
      'only ios visual no-such-baseline',
      'only ios open_link "app://ios"',
      'only android open_link "app://android"',
    );
    expect(did('openUrl')).toEqual(['app://android']);
    expect(out.text).toContain('2. only ios visual no-such-baseline: skipped, ios only');
    expect(out.text).toContain('passed: 4 steps');
  });

  it('fails a flow with no step for this platform: it did not pass', async () => {
    const e = await refusal(run(context(), 'only ios launch', 'only ios tap id=x'));
    expect(e.message).toContain('nothing to run on android');
    expect(device.calls.filter((c) => c.name === 'launch')).toEqual([]);
  });

  it('counts the elements a selector names, and fails saying how many there are', async () => {
    device.screen = 'login';
    const count = (words: string) => run(context(), `assert role=button text="Add" ${words}`);
    expect((await count('check=count equals=2')).text).toContain('passed: 1 steps');
    await count('check=count min=1 max=2');
    const e = await refusal(count('check=count equals=3 timeoutMs=300'));
    expect(e.code).toBe('CHECK_FAILED');
    expect(e.message).toContain('2 elements match role=button text="Add", not 3: ');
    const few = await refusal(count('check=count min=3 timeoutMs=300'));
    expect(few.message).toContain('not at least 3');
    const none = await refusal(run(context(), 'assert id=nope check=count min=1 timeoutMs=300'));
    expect(none.message).toContain('0 elements match id=nope, not at least 1');
  });

  it('waits for a count to come true, as an assert does', async () => {
    device.screen = 'home';
    setTimeout(() => (device.screen = 'login'), 1_000);
    await run(context(), 'assert role=button text="Add" check=count equals=2');
  });

  it("puts a text on the device's clipboard, and checks what it holds, a secret hidden", async () => {
    let held: string | undefined;
    device.setClipboard = (text) => Promise.resolve(void (held = text));
    device.getClipboard = () => Promise.resolve(held);
    await run(
      context(),
      'clipboard "TR33 0006"',
      'clipboard equals="TR33 0006"',
      'clipboard contains=0006',
    );
    const e = await refusal(run(context(), 'clipboard equals="other" timeoutMs=300'));
    expect(e.code).toBe('CHECK_FAILED');
    expect(e.message).toContain('the clipboard holds "TR33 0006": it is not "other"');
    held = `code ${SECRET}`;
    const hidden = await refusal(run(context([SECRET]), 'clipboard contains=nope timeoutMs=300'));
    expect(hidden.message).toContain('the clipboard holds "code •••"');
    held = undefined;
    const empty = await refusal(run(context(), 'clipboard contains=a timeoutMs=300'));
    expect(empty.message).toContain('the clipboard is empty: it has no "a"');
  });

  it('waits for the clipboard to hold what a tap is to put there', async () => {
    let held: string | undefined;
    device.getClipboard = () => Promise.resolve(held);
    setTimeout(() => (held = 'copied'), 1_000);
    await run(context(), 'clipboard equals=copied');
  });

  it('fails an audit over its threshold, 0 unless given, and one that was cut short', async () => {
    const issue = { type: 'contrast', rule: 'TextContrast', message: 'low contrast' };
    const audit = (issues: number, truncated = false) => {
      device.audit = ((o) => {
        device.calls.push({ name: 'audit', args: [o] });
        return Promise.resolve({
          engine: 'rules',
          issues: Array(issues).fill(issue),
          truncated,
          elapsedMs: 1,
        });
      }) as Device['audit'];
    };
    audit(0);
    await run(context(), 'audit', 'audit types=contrast,hitRegion');
    expect(did('audit')[1]).toMatchObject({ types: ['contrast', 'hitRegion'] });
    audit(2);
    await run(context(), 'audit max=2');
    const e = await refusal(run(context(), 'audit max=1'));
    expect(e.code).toBe('CHECK_FAILED');
    expect(e.message).toContain('2 accessibility issues\ncontrast TextContrast: low contrast');
    expect(e.message).toContain('this step allows 1');
    audit(1, true);
    expect((await refusal(run(context(), 'audit max=5'))).message).toContain('more not shown');
    const bad = await refusal(run(context(), 'launch', 'audit types=colour'));
    expect(bad.code).toBe('INVALID_ARGUMENT');
    expect(device.calls.filter((c) => c.name === 'launch')).toEqual([]);
  });
});
