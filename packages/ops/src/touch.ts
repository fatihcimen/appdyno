import { must } from '@appdyno/core';
import { Step } from './step-schemas.js';
import { argumentsFor, CHANGE_HINT, ToolError } from './tool.js';

type Given = Record<string, unknown>;

const refusal = (why: string) => new ToolError(why, 'INVALID_ARGUMENT', CHANGE_HINT, false);

/** A step as its own schema takes it, from what a call gave of it; `names`: what the call names an argument of it. */
function asStep(action: Step['action'], given: Given, names?: Record<string, string>): Step {
  const input = must(
    Step.options.find((o) => o.shape.action.value === action),
    action,
  );
  const said = Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined));
  return argumentsFor({ input }, { ...said, action }, '', names) as Step;
}

/** The touch a call of tap_screen is: one tap, two, or one held. */
export function tapStep({ count, holdMs, ...at }: Given): Step {
  if (count === 2 && holdMs !== undefined)
    throw refusal('count: 2 and holdMs are two touches: give one');
  if (count === 2) return asStep('double_tap', at);
  return holdMs === undefined
    ? asStep('tap', at)
    : asStep('long_press', { ...at, durationMs: holdMs }, { durationMs: 'holdMs' });
}

/** The step a call of type_text is. */
export const typeStep = (a: Given): Step => asStep('type_text', a);

/** What each way of moving a finger takes beside the word that names it; a swipe is the way with no such word. */
const WAYS = {
  until: ['direction', 'maxSwipes', 'x', 'y'],
  to: ['ref', 'x', 'y', 'selector', 'durationMs', 'holdMs'],
  scale: ['x', 'y', 'durationMs'],
  pointers: [],
  swipe: ['direction', 'ref', 'x', 'y', 'selector', 'distance', 'durationMs', 'exact'],
} as const;

type Way = keyof typeof WAYS;

/**
 * The step a call of swipe_screen is, by what it was given: a scroll to an element, a drag, or a swipe. A pinch and
 * free paths are no step: their word comes back, for the tool to run. Two ways at once are refused, as is an argument
 * of another way.
 */
export function swipeStep(a: Given): Step | 'scale' | 'pointers' {
  const named = (Object.keys(WAYS) as Way[]).filter((w) => a[w] !== undefined);
  if (named.length > 1)
    throw refusal(`${named.join(' and ')} are ${named.length} ways to move a finger: give one`);
  const way = named[0] ?? 'swipe';
  const takes: readonly string[] = WAYS[way];
  const stray = Object.keys(a).find((k) => a[k] !== undefined && k !== way && !takes.includes(k));
  if (stray)
    throw refusal(
      way === 'swipe'
        ? `${stray} goes with until, to, scale or pointers`
        : `${stray} does not go with ${way}: it takes ${takes.join(', ') || 'nothing else'}`,
    );
  const { until, to, direction, maxSwipes, distance, exact, durationMs, holdMs, ...at } = a;
  switch (way) {
    case 'until':
      return asStep(
        'scroll_to',
        { ...at, selector: until, direction, maxSwipes },
        { selector: 'until' },
      );
    case 'to':
      return asStep('drag', { ...at, to, durationMs, holdMs });
    case 'scale':
    case 'pointers':
      return way;
    case 'swipe':
      if (direction === undefined)
        throw refusal(
          'a swipe needs direction; until scrolls to an element, to drags, scale pinches',
        );
      return asStep('swipe', { ...at, direction, distance, durationMs, exact });
  }
}

/** What press_key takes to close the on-screen keyboard: no key, and no step. */
export const HIDE_KEYBOARD = 'hide_keyboard';

/** The step a call of press_key is, but for the word that closes the keyboard. */
export const keyStep = ({ key, count }: Given): Step | undefined =>
  String(key).toLowerCase() === HIDE_KEYBOARD ? undefined : asStep('press_key', { key, count });

/** A wait takes no less: a check with less time is made as an assertion, which takes any. */
const MIN_WAIT_MS = 300;

/**
 * The step a call of check_element is: a wait where it gives the time for an element to show or go, else an assertion.
 * Both fail alike, with CHECK_FAILED.
 */
export function checkStep({
  check = 'exists',
  equals,
  expect = true,
  timeoutMs = 0,
  ...at
}: Given) {
  const waits =
    Number(timeoutMs) >= MIN_WAIT_MS &&
    expect === true &&
    equals === undefined &&
    (check === 'exists' || check === 'absent');
  return waits
    ? asStep('wait_for', { ...at, gone: check === 'absent', timeoutMs })
    : asStep('assert', { ...at, check, equals, expect, timeoutMs });
}
