import type { FlowStep } from '@appdyno/flows';
import { ToolError } from '../tool.js';
import { defined } from './shared.js';

/**
 * How long a replayed step waits for its target, and an assert for its check: a CI machine under load
 * is slower than the session it was recorded in, and a step that reads a settled screen too early fails
 * for nothing. A miss costs this long and then stops.
 */
export const REPLAY_WAIT_MS = 10_000;

/** One step as the op it runs through. */
export function opCall(st: FlowStep): [string, Record<string, unknown>] {
  const a = st.args;
  const target = {
    ...(st.selector && { selector: st.selector }),
    ...(a.x !== undefined && { x: a.x, y: a.y }),
  };
  switch (st.action) {
    case 'launch': {
      // arguments and an environment start the app anew, as launch_app takes them
      const env = (a.env as string[] | undefined)?.map((e): [string, string] => [
        e.slice(0, e.indexOf('=')),
        e.slice(e.indexOf('=') + 1),
      ]);
      return [
        'launch_app',
        defined({
          app: a.app,
          args: a.arg,
          env: env && Object.fromEntries(env),
          language: a.language,
        }),
      ];
    }
    case 'stop':
      return ['terminate_app', defined({ app: a.app })];
    case 'tap':
      return ['tap', target];
    case 'long_press':
      return [
        'gesture',
        { kind: 'long_press', ...target, ...defined({ durationMs: a.durationMs }) },
      ];
    case 'double_tap':
      return ['gesture', { kind: 'double_tap', ...target }];
    case 'type':
      return [
        'type_text',
        { text: a.text, ...target, ...defined({ replace: a.replace, submit: a.submit }) },
      ];
    case 'press_key':
      return ['press_key', { key: a.key, ...defined({ count: a.count }) }];
    case 'swipe':
      return [
        'swipe',
        {
          direction: a.direction,
          ...target,
          ...defined({ distance: a.distance, durationMs: a.durationMs, exact: a.exact }),
        },
      ];
    case 'scroll_to':
      return [
        'scroll_to',
        { selector: st.selector, ...defined({ direction: a.direction, maxSwipes: a.maxSwipes }) },
      ];
    case 'wait_for':
      return [
        'wait_for',
        { ...target, ...defined({ gone: a.gone }), timeoutMs: a.timeoutMs ?? REPLAY_WAIT_MS },
      ];
    case 'assert':
      return [
        'assert',
        {
          ...target,
          ...defined({ check: a.check, equals: a.equals, expect: a.expect }),
          timeoutMs: a.timeoutMs ?? REPLAY_WAIT_MS,
        },
      ];
    case 'open_link':
      return ['open_link', defined({ url: a.url, settings: a.settings })];
    case 'set_location':
      return ['set_location', { lat: a.lat, lon: a.lon }];
    case 'alert':
      return ['alert', { answer: a.answer }];
    case 'hide_keyboard':
      return ['keyboard', { action: 'dismiss' }];
    case 'unrecorded':
      throw new ToolError(
        `this action has no step and was not recorded: ${String(a.what)}. Replace or delete this line`,
        'UNSUPPORTED',
      );
    case 'run':
      throw new ToolError(
        `${String(a.file)} was not read in: run a flow from its file`,
        'INVALID_ARGUMENT',
      );
  }
}
