import { describe, expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect } from './shared.js';

describe('a batch that fails', () => {
  const failing = async (read: 'none' | 'diff' | 'full') => {
    const { call } = await connect(new FakeDevice());
    return call('run_steps', {
      read,
      steps: [
        { tool: 'tap_screen', selector: { text: 'Form' } },
        { tool: 'tap_screen', selector: { text: 'Kaydet' } },
      ],
    });
  };
  /** The screen as an answer lists it, apart from what a failing step says it found. */
  const SCREEN = /^\d+ elements: /m;

  it('keeps to its own lines with read none, the failing step its whole line', async () => {
    const quiet = await failing('none');
    expect(quiet.data.code).toBe('NOT_FOUND');
    expect(quiet.text).toContain('2. tap_screen failed, the rest were not run: no element matches');
    expect(quiet.text).not.toMatch(SCREEN);
    expect(quiet.data.hint).toMatch(/^read the screen/);
  });

  it('shows the screen with any other read, and says it is above', async () => {
    for (const read of ['diff', 'full'] as const) {
      const shown = await failing(read);
      expect(shown.text, read).toMatch(SCREEN);
      expect(shown.data.hint, read).toMatch(/^the screen now is above/);
    }
  });
});
