import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { simulatorProvider } from './workspace.js';
import { opsOn } from './helpers.js';

/**
 * Text typed on our own simulator (APPDYNO_IOS_UDID, with the fixture installed; never a default) stays as typed once
 * its field loses the focus, where the keyboard's autocorrection had made "Grace Hopper" "Good" on the Form's name field
 * as Send was pressed, in two goes of five. The fixture's field is as an app's is: corrections on. The flow three times,
 * as a journey measured, and typed then sent by hand; then the keyboard reads as it did before.
 */
const udid = process.env.APPDYNO_IOS_UDID ?? '';
/** The form as a flow, written here: the Vitest example's own. */
const FORM = join(mkdtempSync(join(tmpdir(), 'appdyno-typing-')), 'form.flow');
writeFileSync(
  FORM,
  [
    'app dev.appdyno.fixture',
    'stop',
    'launch',
    'tap text="Form"',
    'type "Grace Hopper" id=name_input replace',
    'tap id=submit',
    'assert id=result check=text equals="Sent: Grace Hopper"',
    '',
  ].join('\n'),
);
const KEYS = [
  'com.apple.keyboard.preferences KeyboardAutocorrection',
  'com.apple.keyboard.predictive KeyboardPrediction',
  'com.apple.keyboard.preferences SmartTyping',
];

/** The keyboard's own settings as they are: unset ones read as such. */
const keyboard = () =>
  KEYS.map((k) => {
    try {
      return execFileSync('xcrun', ['simctl', 'spawn', udid, 'defaults', 'read', ...k.split(' ')], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return 'unset';
    }
  });

describe.runIf(udid)('text typed on a simulator', () => {
  const before = udid ? keyboard() : [];
  const { ctx, call } = opsOn(simulatorProvider(), udid, 'dev.appdyno.fixture');
  afterAll(() => ctx.close());

  it('stays as typed through the form, three times, as a journey measured, and typed then sent', async () => {
    for (let round = 1; round <= 3; round++) {
      const r = await call('run_flow', { action: 'run', file: FORM });
      expect(r.error ? r.text : '', `round ${round}`).toBe('');
    }
    // as Measure Journey and `appdyno test --measure` run it: a first go, then five measured
    const measured = await call('run_flow', {
      action: 'run',
      file: FORM,
      iterations: 5,
    });
    expect(measured.error ? measured.text : '').toBe('');
    for (let round = 1; round <= 5; round++) {
      await call('launch_app', { app: 'dev.appdyno.fixture', restart: true });
      await call('tap_screen', { selector: { text: 'Form' } });
      const typed = await call('type_text', {
        selector: { id: 'name_input' },
        text: 'Grace Hopper',
        replace: true,
      });
      expect(typed.error ? typed.text : '').toBe('');
      await call('tap_screen', { selector: { id: 'submit' } });
      const sent = await call('read_screen');
      expect(sent.text, `round ${round}`).toContain('Sent: Grace Hopper');
    }
  }, 1_500_000);

  it('leaves the keyboard as it found it once the session ends', async () => {
    await ctx.end();
    expect(keyboard()).toEqual(before);
  }, 120_000);
});
