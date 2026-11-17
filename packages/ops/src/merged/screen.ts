import { z } from 'zod';
import type { Pieces } from '../catalog.js';
import { mergeOp } from '../merge.js';
import { MAX_WAIT_MS } from '../step-schemas.js';
import { READ } from '../tool.js';
import { checkStep } from '../touch.js';

export const readScreen = ({ screen, find }: Pick<Pieces, 'screen' | 'find'>) =>
  mergeOp({
    name: 'read_screen',
    title: 'Read screen',
    description:
      'Read the screen as text. Returns each element of the accessibility tree as ref role "label" x,y flags; views: the native view hierarchy instead. selector: only its matches, with state, value and bounds. Assert: check_element; pixels: take_screenshot; audits, visual diffs: check_screen; web views: inspect_app. Like rows fold under a header; refs hold across scrolls. raw: every node as data.',
    input: z.object({ ...find.input.shape, ...screen.input.shape }).strict(),
    annotations: READ,
    parts: [screen, find],
    pick: ({ selector, ...a }) => (selector ? [find, { ...a, selector }] : [screen, a]),
  });

export const checkElement = ({ wait_for: wait, assert }: Pick<Pieces, 'wait_for' | 'assert'>) =>
  mergeOp({
    name: 'check_element',
    title: 'Check or wait for an element',
    description: `Assert or wait for an element, touching nothing: check exists, absent, text (equals), enabled, checked, focused, moves; expect: false for the opposite. timeoutMs (at most ${MAX_WAIT_MS}) waits until it holds. Returns one line, or fails with CHECK_FAILED saying what it found. Whole screen: check_screen; look only: read_screen.`,
    input: z.object({ ...assert.input.shape, read: wait.input.shape.read }).strict(),
    annotations: READ,
    parts: [wait, assert],
    step: checkStep,
    // a wait answers with the screen as it came to be, where the call asks to read it
    pick: ({ read, ...a }) => {
      const { action, ...st } = checkStep(a);
      return action === 'wait_for' ? [wait, { ...st, read }] : [assert, st];
    },
  });
