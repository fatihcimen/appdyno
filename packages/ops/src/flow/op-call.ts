import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { maskOf, type FlowStep } from '@appdyno/flows';
import { ToolError } from '../tool.js';
import { defined } from './shared.js';

/**
 * How long a replayed step waits for its target, and an assert for its check: a CI machine under load
 * is slower than the session it was recorded in, and a step that reads a settled screen too early fails
 * for nothing. A miss costs this long and then stops.
 */
export const REPLAY_WAIT_MS = 10_000;

/** Where a `screenshot` step saves when the run keeps nothing of its own. */
export const SHOTS_DIR = 'appdyno-screenshots';

/** What a step needs of its run beyond its line. */
export type StepPlace = {
  /** The flow's file: its folder holds `baselines`, where a step of a flow it runs has its own file's. */
  file: string;
  /** Where a `screenshot` step saves. */
  shots: string;
  /** A person's `--update-baselines`: a `visual` step saves its baseline in place of comparing. */
  update: boolean;
};

/** A `visual` step's comparison, refused before the run when there is nothing to compare with. */
function visualCall(st: FlowStep, at: StepPlace): Record<string, unknown> {
  const dir = join(dirname(st.file ?? at.file), 'baselines');
  const file = join(dir, `${String(st.args.name)}.png`);
  if (!at.update && !existsSync(file))
    throw new ToolError(
      `${st.file ?? at.file}:${st.line}: no baseline ${file}: appdyno test or flow run with --update-baselines saves it`,
      'NOT_FOUND',
      `or visual action baseline with dir ${dir}`,
    );
  return {
    action: at.update ? 'baseline' : 'compare',
    name: st.args.name,
    dir,
    ...defined({
      tolerance: st.args.tolerance,
      masks: (st.args.mask as string[] | undefined)?.map((m) => maskOf(m)),
    }),
  };
}

/** One step as the op it runs through. */
export function opCall(st: FlowStep, at: StepPlace): [string, Record<string, unknown>] {
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
          probe: a.probe,
        }),
      ];
    }
    case 'stop':
      return ['terminate_app', defined({ app: a.app, background: a.background })];
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
    case 'screenshot':
      // a run again, a retry or a journey's next iteration takes the picture anew
      return [
        'screenshot',
        { file: join(at.shots, `${String(a.name)}.png`), overwrite: true, inline: false },
      ];
    case 'visual':
      return ['visual', visualCall(st, at)];
    case 'setting':
      return [
        'device_setting',
        defined({ name: a.name, value: a.value, app: a.app, title: a.title }),
      ];
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
