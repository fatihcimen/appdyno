import { basename, extname } from 'node:path';
import { safeName } from '@appdyno/core';
import { type FlowStep, type Mask, maskText, VALUELESS_SETTINGS } from '@appdyno/flows';
import { SCROLLER_SWIPES } from '../perf/shared.js';
import { HIDE_KEYBOARD } from '../touch.js';
import { DEFAULT_TOLERANCE } from '../visual.js';
import { stepOf, unrecorded } from './aim.js';
import { networkSteps } from './network-steps.js';
import { auditStep, pushStep, webClickStep } from './recorder-gaps.js';

/** What an op that ran comes to in a flow: its arguments and answer, as steps. */
type ToStep = (
  a: Record<string, unknown>,
  data: Record<string, unknown>,
) => FlowStep | FlowStep[] | undefined;

/** A picture's file as a `screenshot` step names it. */
const pictureName = (file: string) => safeName(basename(file, extname(file))).slice(0, 100);

/** What an op that can change things does when it only looks. */
const LOOKS: Record<string, string[]> = {
  manage_app: ['list', 'state'],
  capture_network: ['paths', 'read'],
  inspect_app: ['web_pages', 'web_elements', 'rn_targets', 'rn_logs', 'ax_list'],
};

/**
 * A measure is the agent measuring, not the journey: its numbers come from `appdyno test --measure`. What it does to
 * the screen stays, as the plain steps that do the same, so that the next step finds what it found, and nothing stops
 * a replay: a cold start is a stop and a launch, a scroll its swipes.
 */
const swipes = (a: Record<string, unknown>, count: number) =>
  Array.from({ length: count }, () => stepOf('swipe', {}, { direction: a.direction as string }));
const restarts = (
  a: Record<string, unknown>,
  how: Record<string, string | string[] | boolean | undefined> = {},
) => [
  stepOf('stop', {}, { app: a.app as string | undefined }),
  stepOf('launch', {}, { app: a.app as string | undefined, ...how }),
];
/** What a metric does to the screen; a snapshot and a heap dump do nothing to it. */
const BY_METRIC: Record<string, ToStep> = {
  launch: (a) =>
    a.mode === 'cold' ? restarts(a) : stepOf('launch', {}, { app: a.app as string | undefined }),
  scroll: (a, data) => {
    const count = a.swipes as number;
    const on = { direction: a.direction ?? 'up' };
    const back = { direction: on.direction === 'up' ? 'down' : 'up' };
    const rounds = (data.rounds as { rewound?: boolean }[]).map((round) => [
      ...(round.rewound ? swipes(back, count) : []),
      ...swipes(on, count),
    ]);
    return rounds.flat();
  },
  frames: (a) => [
    ...(String(a.what).startsWith('xct_') ? restarts(a) : []),
    ...(a.direction ? swipes(a, SCROLLER_SWIPES) : []),
  ],
  cpu: (a) => (a.direction ? swipes(a, SCROLLER_SWIPES) : undefined),
};
const MEASURES: Record<string, ToStep> = {
  measure_performance: (a, data) => BY_METRIC[a.metric as string]?.(a, data),
  // a gate reads what is kept, and refuses to look at a device while a recording runs
  compare_performance: () => undefined,
};

/** An op with no step of its own, as a flow step; a refused action is none, and any other op stops a replay. */
const OPS: Record<string, ToStep> = {
  ...MEASURES,
  // a launch that started the app is a start in a replay too, where a plain launch brings a running app forward as it is;
  // a restart, arguments and an environment stop a running app first on every platform: a start, whether it ran or not.
  // A probe the launch put in is one more such start, which says nothing of whether the app ran
  launch_app: (a, data) => {
    const env = a.env as Record<string, string> | undefined;
    const probe = (a.probe as boolean | undefined) || undefined;
    const how = {
      language: a.language as string | undefined,
      arg: a.args as string[] | undefined,
      env: env && Object.entries(env).map(([k, v]) => `${k}=${v}`),
      probe,
    };
    const probed = probe && data.wasRunning === undefined;
    return data.wasRunning === false || a.restart || a.args || a.env || probed
      ? restarts(a, how)
      : stepOf(
          'launch',
          { flags: data.wasRunning ? ['running'] : [] },
          { app: a.app as string | undefined, language: how.language, probe },
        );
  },
  manage_app: (a) =>
    a.action === 'stop'
      ? stepOf(
          'stop',
          {},
          { app: a.app as string | undefined, background: (a.background as boolean) || undefined },
        )
      : unknownOp('manage_app')(a, {}),
  // photos put in the gallery are a setting of a flow; an app's data moved is no step
  transfer_files: (a) =>
    a.action === 'media'
      ? stepOf(
          'setting',
          {},
          { name: 'media', value: a.path as string, app: a.app as string | undefined },
        )
      : unknownOp('transfer_files')(a, {}),
  // what an app opens is read, and nothing opened: no step
  open_link: (a) =>
    a.links
      ? undefined
      : stepOf(
          'open_link',
          {},
          { url: a.url as string | undefined, settings: a.settings as string | undefined },
        ),
  answer_alert: (a, data) =>
    data.answered !== undefined ? stepOf('alert', {}, { answer: a.answer as string }) : undefined,
  // the one key that is no step of its own: the keyboard closed is a flow's word
  press_key: (a, data) =>
    String(a.key).toLowerCase() === HIDE_KEYBOARD && data.closed
      ? stepOf('hide_keyboard', {})
      : undefined,
  // a swipe, a scroll and a drag are steps, written as they run; a pinch and free paths have none
  swipe_screen: (a) =>
    a.scale !== undefined
      ? unrecorded('swipe_screen scale')
      : a.pointers
        ? unrecorded('swipe_screen pointers')
        : undefined,
  // a read of a setting is a look, where a one-shot that takes no value acts all the same;
  // a restore takes nothing else, whatever came beside it
  set_device: (a) => {
    const value = a.value as string | undefined;
    if (a.name === 'restore') return stepOf('setting', {}, { name: 'restore' });
    // a read of the clipboard changed nothing; a text put there is a step of its own
    if (a.name === 'clipboard')
      return value === undefined ? undefined : stepOf('clipboard', {}, { text: value });
    if (a.name === 'location') {
      const [lat, lon] = (value ?? '').split(',').map(Number);
      return value === 'none'
        ? unrecorded('set_device location none')
        : stepOf('set_location', {}, { lat, lon });
    }
    return value !== undefined || VALUELESS_SETTINGS.includes(a.name as string)
      ? stepOf(
          'setting',
          {},
          {
            name: a.name as string,
            value,
            app: a.app as string | undefined,
            title: a.title as string | undefined,
          },
        )
      : undefined;
  },
  send_push: pushStep,
  inspect_app: (a, data) =>
    a.action === 'web_click' ? webClickStep(a, data) : unknownOp('inspect_app')(a, {}),
  capture_network: (a, data) => networkSteps(a, LOOKS.capture_network ?? [], data),
  // a picture only shown to the agent is a look
  take_screenshot: (a, data) =>
    a.file && !a.watchMs
      ? stepOf('screenshot', {}, { name: pictureName(data.file as string) || 'screen' })
      : undefined,
  // a baseline saved while recording is what a replay compares with, in the flow's own baselines folder
  check_screen: (a, data) =>
    a.check === 'accessibility'
      ? auditStep(a, data)
      : stepOf(
          'visual',
          {},
          {
            name: a.name as string,
            tolerance: a.tolerance === DEFAULT_TOLERANCE ? undefined : (a.tolerance as number),
            mask: (a.masks as Mask[] | undefined)?.map(maskText),
          },
        ),
};

const unknownOp =
  (name: string): ToStep =>
  (a: Record<string, unknown>) => {
    // an op's action is one of its words, by its schema
    const action = typeof a.action === 'string' ? a.action : '';
    return LOOKS[name]?.includes(action)
      ? undefined
      : unrecorded(action ? `${name} ${action}` : name);
  };

/** What a call of this tool comes to in a flow, by the tool's own entry or as one a flow has no step for. */
export const toolStep = (name: string): ToStep => OPS[name] ?? unknownOp(name);
