import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paramsOf } from '../../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { SCREENS } from '@appdyno/testing/fake-screens.js';
import { callerOf, SECRET, flowHelpers } from './harness.js';

describe('flows', () => {
  let dir: string;
  let device: FakeDevice;
  const { context, refusal, recorded } = flowHelpers(
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

  describe('secrets', () => {
    it('a password field, and any later echo, become a name; no value reaches the disk', async () => {
      device.screen = 'login';
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('type_text', { text: SECRET, selector: { id: 'pass' } });
        await call('assert', { id: 'greeting', check: 'text', equals: `Merhaba ${SECRET}` });
        await call('tap', { selector: { id: 'greeting' } });
      });
      expect(device.typed).toEqual([SECRET]);
      expect(text).toBe(`app dev.app
secret PASS

type "\${PASS}" id=pass
assert id=greeting check=text equals="Merhaba \${PASS}"
tap id=greeting
`);
      const kept = readdirSync(join(dir, 'state', 'recordings'));
      for (const f of kept)
        expect(readFileSync(join(dir, 'state', 'recordings', f), 'utf8')).not.toContain(SECRET);
    });

    it('tells a password field by the focus, when text goes to no target', async () => {
      device.screen = 'login';
      const node = must(SCREENS.login?.[1], 'the password field');
      const was = must(node.f, 'its flags');
      node.f = was | 8;
      try {
        const call = callerOf(context());
        const { text } = await recorded(call, () => call('type_text', { text: 'p4ss' }));
        expect(text).not.toContain('p4ss');
        expect(text).toContain('type "${PASS}"');
      } finally {
        node.f = was;
      }
    });

    it('text matching APPDYNO_SECRETS becomes a name in any field', async () => {
      const call = callerOf(context(['kod-9911']));
      const { text } = await recorded(call, async () => {
        await call('tap', { selector: { text: 'Form' } });
        await call('type_text', { text: 'kod-9911', selector: { id: 'name' } });
      });
      expect(text).not.toContain('kod-9911');
      expect(text).toContain('secret SECRET_1');
      expect(text).toContain('type "${SECRET_1}" id=name');
    });
  });

  describe('params', () => {
    it('names a recorded value at save, which a run takes; a value no step holds is refused', async () => {
      const call = callerOf(context());
      await call('flow', { action: 'start' });
      await call('tap', { selector: { text: 'Form' } });
      await call('type_text', { text: 'Grace', selector: { id: 'name' } });
      await call('flow', { action: 'stop' });
      const file = join(dir, 'state', 'named.flow');
      const none = await refusal(call('flow', { action: 'save', file, params: ['OTHER=Hopper'] }));
      expect(none.message).toContain('no recorded step holds the value of OTHER');
      expect(existsSync(file)).toBe(false);
      const saved = await call('flow', { action: 'save', file, params: ['NAME=Grace'] });
      const text = `app dev.app
param NAME

tap role=button text="Form"
type "\${NAME}" id=name
`;
      expect(readFileSync(file, 'utf8')).toBe(text);
      expect(saved.text).toContain(text);
      expect(saved.text).toContain('param NAME: step 2');
      device.screen = 'home';
      await call('flow', { action: 'run', file, params: ['NAME=Hopper'] });
      expect(device.typed).toEqual(['Grace', 'Hopper']);
    });

    it('names at start what is typed later, and refuses a name a placeholder cannot have', async () => {
      const call = callerOf(context());
      const bad = await refusal(call('flow', { action: 'start', params: ['name=Ada'] }));
      expect(bad.message).toContain("a param's name is like MY_NAME");
      expect((await refusal(call('flow', { action: 'stop' }))).message).toContain('no recording');
      await call('flow', { action: 'start', params: ['NAME=Ada'] });
      await call('tap', { selector: { text: 'Form' } });
      await call('type_text', { text: 'Ada', selector: { id: 'name' } });
      const stop = await call('flow', { action: 'stop' });
      expect(stop.text).toContain('param NAME\n');
      expect(stop.text).toContain('type "${NAME}" id=name');
      expect(stop.text).not.toContain('secret');
      writeFileSync(join(dir, 'e.flow'), 'app dev.app\nlaunch\n');
      const exported = refusal(
        call('flow', { action: 'export', file: join(dir, 'e.flow'), params: ['NAME=Ada'] }),
      );
      expect((await exported).message).toContain('export takes no params');
    });
  });

  it('reads NAME=value, a value with = in it included', () => {
    expect(paramsOf(['A=1', 'B=x=y', 'C='])).toEqual({ A: '1', B: 'x=y', C: '' });
    expect(() => paramsOf(['nope'])).toThrow(/NAME=value/);
  });
});
