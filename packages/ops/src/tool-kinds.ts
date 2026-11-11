import type { FlowStep } from '@appdyno/flows';
import type { OpName } from './registry.js';

// How a tool is treated by its name where calls are kept or replayed: each set is held to the tools there are, so a
// tool renamed or gone fails the build here, and a new one is placed by reading this one file.

/** What cannot be a step of `steps`: `steps` in itself, and a flow's own sequence. */
export const NOT_A_STEP: ReadonlySet<string> = new Set<OpName>(['steps', 'flow']);

/** Calls that are not an agent acting on the device: no line of the activity a person watches. */
export const NOT_ACTIVITY: ReadonlySet<string> = new Set<OpName>([
  'mirror',
  'hand_off',
  'list_devices',
]);

const NOT_STEP_NAMES: OpName[] = ['report', 'list_devices', 'simulator', 'mirror', 'hand_off'];

/** Calls that say nothing about the app: no step of a report. */
export const NOT_STEPS: ReadonlySet<string> = new Set(NOT_STEP_NAMES);

/** No action of a flow, as they pick the device, film it or run the recording; nor is what a report leaves out. */
export const NOT_ACTIONS: ReadonlySet<string> = new Set<OpName>([
  ...NOT_STEP_NAMES,
  'use_device',
  'record',
  'flow',
]);

/** Each step these run passes the recorder's `through`. */
export const BY_STEP: ReadonlySet<string> = new Set<OpName>([
  'tap',
  'swipe',
  'scroll_to',
  'type_text',
  'press_key',
  'steps',
]);

/**
 * Steps of a flow that end on a settled screen with no time from the device (no lookup before, or several actions):
 * all of the step is the time.
 */
export const WHOLE_STEP: ReadonlySet<FlowStep['action']> = new Set<FlowStep['action']>([
  'launch',
  'open_link',
  'scroll_to',
]);
