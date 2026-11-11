import type { FlowStep } from '@appdyno/flows';

// How a tool is treated by its name where calls are kept or replayed: registry.ts holds each list to the tools there
// are, so a tool renamed or gone fails the build, and a new one is placed by reading this one file.

const NOT_A_STEP_NAMES = ['steps', 'flow'] as const;
const NOT_ACTIVITY_NAMES = ['mirror', 'hand_off', 'list_devices'] as const;
const NOT_STEP_NAMES = ['report', 'list_devices', 'simulator', 'mirror', 'hand_off'] as const;
const NOT_ACTION_NAMES = [...NOT_STEP_NAMES, 'use_device', 'record', 'flow'] as const;
const BY_STEP_NAMES = ['tap', 'swipe', 'scroll_to', 'type_text', 'press_key', 'steps'] as const;

/** Every name of the lists here, for registry.ts to hold to the tools there are. */
export const KIND_NAMES = [
  ...NOT_A_STEP_NAMES,
  ...NOT_ACTIVITY_NAMES,
  ...NOT_ACTION_NAMES,
  ...BY_STEP_NAMES,
] as const;

/** What cannot be a step of `steps`: `steps` in itself, and a flow's own sequence. */
export const NOT_A_STEP: ReadonlySet<string> = new Set(NOT_A_STEP_NAMES);

/** Calls that are not an agent acting on the device: no line of the activity a person watches. */
export const NOT_ACTIVITY: ReadonlySet<string> = new Set(NOT_ACTIVITY_NAMES);

/** Calls that say nothing about the app: no step of a report. */
export const NOT_STEPS: ReadonlySet<string> = new Set(NOT_STEP_NAMES);

/** No action of a flow, as they pick the device, film it or run the recording; nor is what a report leaves out. */
export const NOT_ACTIONS: ReadonlySet<string> = new Set(NOT_ACTION_NAMES);

/** Each step these run passes the recorder's `through`. */
export const BY_STEP: ReadonlySet<string> = new Set(BY_STEP_NAMES);

/**
 * Steps of a flow that end on a settled screen with no time from the device (no lookup before, or several actions):
 * all of the step is the time.
 */
export const WHOLE_STEP: ReadonlySet<FlowStep['action']> = new Set<FlowStep['action']>([
  'launch',
  'open_link',
  'scroll_to',
]);
