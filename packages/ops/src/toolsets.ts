import type { OpName } from './registry.js';
import type { Op } from './tool.js';

/**
 * The tools in groups, each tool in one: a client that needs few of them lists only the groups it names, and its
 * catalog is that much shorter in every session. It is no permission: what a server may do is its policy's to say,
 * and run_steps, a command line and the library reach every tool whatever is listed.
 */
export const TOOLSETS = {
  core: [
    'list_devices',
    'use_device',
    'read_screen',
    'take_screenshot',
    'check_element',
    'tap_screen',
    'swipe_screen',
    'type_text',
    'press_key',
    'run_steps',
    'answer_alert',
    'launch_app',
    'open_link',
  ],
  device: ['manage_simulator', 'set_device', 'ask_person', 'show_mirror'],
  apps: ['manage_app', 'transfer_files', 'send_push', 'inspect_app'],
  evidence: ['read_logs', 'check_screen', 'record_session', 'run_flow'],
  network: ['capture_network'],
  perf: ['measure_performance', 'compare_performance'],
} as const satisfies Record<string, readonly OpName[]>;

export type Toolset = keyof typeof TOOLSETS;

/** A tool in no group fails the build here, where the tools are known. */
const _every: Exclude<OpName, (typeof TOOLSETS)[Toolset][number]> extends never ? true : never =
  true;

export const TOOLSET_NAMES = Object.keys(TOOLSETS) as Toolset[];

/**
 * The groups these words name, as `core,network,perf`; none given is every group. A word that names no group is
 * refused, with the groups there are: a server that listed fewer tools than its person meant would only seem to work.
 */
export function toolsetsOf(words: string | undefined): Toolset[] {
  const said = (words ?? '')
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
  const unknown = said.filter((w) => !Object.hasOwn(TOOLSETS, w));
  if (unknown.length > 0)
    throw new Error(
      `--toolsets takes ${TOOLSET_NAMES.join(', ')}, with a comma between them, not ${unknown.join(', ')}`,
    );
  return said.length > 0 ? TOOLSET_NAMES.filter((t) => said.includes(t)) : TOOLSET_NAMES;
}

/** The tools of these groups, in the catalog's own order. */
export function inToolsets(ops: Record<string, Op>, sets: readonly Toolset[]): Record<string, Op> {
  const listed = new Set<string>(sets.flatMap((s) => TOOLSETS[s]));
  return Object.fromEntries(Object.entries(ops).filter(([name]) => listed.has(name)));
}
