import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { dropOf, maskOf, stepLine, type FlowStep } from '@appdyno/flows';
import { LONG_PRESS_MS } from '../step-schemas.js';
import { ToolError } from '../tool.js';
import { HIDE_KEYBOARD } from '../touch.js';
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
  /** The rules the run's `mock` steps have added so far, each as its line. */
  mocked: string[];
  /** The request a `request` step looks past: the capture's newest as the run began, while that capture runs. */
  after?: () => number | undefined;
};

/** A `visual` step's comparison, refused before the run when there is nothing to compare with. */
function visualCall(st: FlowStep, at: StepPlace): Record<string, unknown> {
  const dir = join(dirname(st.file ?? at.file), 'baselines');
  const file = join(dir, `${String(st.args.name)}.png`);
  if (!at.update && !existsSync(file))
    throw new ToolError(
      `${st.file ?? at.file}:${st.line}: no baseline ${file}: appdyno test or run-flow run with --update-baselines saves it`,
      'NOT_FOUND',
      `or check_screen with check visual_baseline and dir ${dir}`,
    );
  return {
    check: at.update ? 'visual_baseline' : 'visual',
    name: st.args.name,
    dir,
    ...defined({
      tolerance: st.args.tolerance,
      masks: (st.args.mask as string[] | undefined)?.map((m) => maskOf(m)),
    }),
  };
}

/** A `mock` step's rule as `capture_network` takes it: its line, a file it answers with found from the flow's folder. */
export function mockLine(st: FlowStep, at: Pick<StepPlace, 'file'>) {
  const body = st.args.body;
  const placed =
    typeof body === 'string' && body.startsWith('@')
      ? `@${resolve(dirname(st.file ?? at.file), body.slice(1))}`
      : body;
  const args = { ...st.args, ...(placed !== undefined && { body: placed }) };
  return stepLine({ ...st, args }).replace(/^mock /, '');
}

/** `NAME=value` words as a record, the name up to the first `=`. */
const pairs = (words: unknown) =>
  words &&
  Object.fromEntries(
    (words as string[]).map((w): [string, string] => [
      w.slice(0, w.indexOf('=')),
      w.slice(w.indexOf('=') + 1),
    ]),
  );

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
      return [
        'launch_app',
        defined({
          app: a.app,
          args: a.arg,
          env: pairs(a.env),
          language: a.language,
          probe: a.probe,
        }),
      ];
    }
    case 'stop':
      return [
        'manage_app',
        { action: 'stop', ...defined({ app: a.app, background: a.background }) },
      ];
    case 'tap':
      return ['tap_screen', target];
    case 'long_press':
      // a hold no step times is the press's own
      return ['tap_screen', { ...target, holdMs: a.durationMs ?? LONG_PRESS_MS }];
    case 'double_tap':
      return ['tap_screen', { ...target, count: 2 }];
    case 'drag':
      return [
        'swipe_screen',
        {
          ...target,
          to: dropOf(String(a.to)),
          ...defined({ holdMs: a.holdMs, durationMs: a.durationMs }),
        },
      ];
    case 'push':
      return [
        'send_push',
        defined({
          type: a.type,
          app: a.app,
          title: a.title,
          body: a.body,
          image: a.image,
          data: pairs(a.data),
          payload: a.payload,
        }),
      ];
    case 'web_click':
      return [
        'inspect_app',
        { action: 'web_click', selector: a.css, ...defined({ page: a.page }) },
      ];
    case 'type':
      return [
        'type_text',
        { text: a.text, ...target, ...defined({ replace: a.replace, submit: a.submit }) },
      ];
    case 'press_key':
      return ['press_key', { key: a.key, ...defined({ count: a.count }) }];
    case 'swipe':
      return [
        'swipe_screen',
        {
          direction: a.direction,
          ...target,
          ...defined({ distance: a.distance, durationMs: a.durationMs, exact: a.exact }),
        },
      ];
    case 'scroll_to':
      return [
        'swipe_screen',
        { until: st.selector, ...defined({ direction: a.direction, maxSwipes: a.maxSwipes }) },
      ];
    case 'wait_for':
      return [
        'check_element',
        {
          ...target,
          ...(a.gone === true && { check: 'absent' }),
          timeoutMs: a.timeoutMs ?? REPLAY_WAIT_MS,
        },
      ];
    case 'assert':
      return [
        'check_element',
        {
          ...target,
          ...defined({ check: a.check, equals: a.equals, expect: a.expect }),
          timeoutMs: a.timeoutMs ?? REPLAY_WAIT_MS,
        },
      ];
    case 'open_link':
      return ['open_link', defined({ url: a.url, settings: a.settings })];
    case 'set_location':
      return ['set_device', { name: 'location', value: `${String(a.lat)},${String(a.lon)}` }];
    case 'alert':
      return ['answer_alert', { answer: a.answer }];
    case 'hide_keyboard':
      return ['press_key', { key: HIDE_KEYBOARD }];
    case 'screenshot':
      // a run again, a retry or a journey's next iteration takes the picture anew
      return [
        'take_screenshot',
        { file: join(at.shots, `${String(a.name)}.png`), overwrite: true, inline: false },
      ];
    case 'visual':
      return ['check_screen', visualCall(st, at)];
    case 'setting':
      // photos into the gallery are a setting of a flow, and a transfer of the tools
      return a.name === 'media'
        ? ['transfer_files', { action: 'media', path: a.value, ...defined({ app: a.app }) }]
        : ['set_device', defined({ name: a.name, value: a.value, app: a.app, title: a.title })];
    case 'mock': {
      // added to the rules there, and taken out when the run of its file ends
      if (a.request !== undefined)
        return ['capture_network', { action: 'mock', rules: [mockLine(st, at)], add: true }];
      // a file of answers is found from the flow's folder, as a rule's own file is
      const from =
        typeof a.from === 'string' && !/^\d+$/.test(a.from)
          ? resolve(dirname(st.file ?? at.file), a.from)
          : a.from;
      return ['capture_network', { action: 'mock', ...defined({ from, unmatched: a.unmatched }) }];
    }
    case 'network':
      return ['capture_network', { action: 'mock', strict: a.value !== 'off' }];
    case 'request':
      return [
        'capture_network',
        {
          action: 'check',
          ...defined({
            contains: a.part,
            method: a.method,
            status: a.status,
            has: a.has,
            after: at.after?.(),
          }),
          timeoutMs: a.timeoutMs ?? REPLAY_WAIT_MS,
        },
      ];
    case 'clipboard':
      // a check of what it holds is the run's own: see `checkHere`
      return ['set_device', { name: 'clipboard', value: a.text }];
    case 'audit':
      return [
        'check_screen',
        {
          check: 'accessibility',
          ...defined({ types: (a.types as string | undefined)?.split(',') }),
        },
      ];
    case 'prepare':
      throw new ToolError(
        `prepare ${String(a.name)} is the run's own to carry out, by no tool`,
        'INVALID_ARGUMENT',
      );
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
