import { must, sleep } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';

/** How long a state asked for has to become the device's. */
const COMMITTED_MS = 3_000;
const READ_AGAIN_MS = 200;
/** How long the display a fold swaps has to stand still: two reads alike. */
const SETTLED_MS = 2_000;
const SETTLE_AGAIN_MS = 300;
const STATE = /DeviceState\{identifier=(\d+), name='([^']+)'/g;
/** The system's own word of an activity it made anew for a new configuration, in its events log. */
const RELAUNCH = 'wm_relaunch_resume_activity:I wm_relaunch_activity:I';

export type FoldState = { id: number; pose: string };

/**
 * A state's name as a pose: open and closed by the names makers give them, the rear display and both displays at once
 * (dual) by theirs, any other as itself.
 */
export const poseOf = (name: string) =>
  /^(CLOSED|FOLDED)$/i.test(name)
    ? 'closed'
    : /^(OPEN|OPENED|UNFOLDED)$/i.test(name)
      ? 'open'
      : /^REAR_DISPLAY(_MODE|_STATE)?$/i.test(name)
        ? 'rear_display'
        : /^(CONCURRENT_INNER_DEFAULT|DUAL_DISPLAY(_MODE|_STATE)?)$/i.test(name)
          ? 'dual'
          : name.toLowerCase();

/** A pose as a person may ask for it: `half` and `half-opened` are `half_opened`. */
const asked = (value: string) => {
  const v = value.toLowerCase().replace(/[- ]/g, '_');
  return v === 'half' || v === 'half_open' ? 'half_opened' : v;
};

/** The states of `cmd device_state print-states`, by their ids, which differ by device. */
export const foldStates = (printed: string): FoldState[] =>
  [...printed.matchAll(STATE)].map((m) => ({
    id: Number(m[1]),
    pose: poseOf(must(m[2], 'a name')),
  }));

/** The state `dumpsys device_state` names on its line `key`, as a pose. */
const poseIn = (dump: string, key: string) => {
  const m = new RegExp(`${key}=Optional\\[DeviceState\\{identifier=\\d+, name='([^']+)'`).exec(
    dump,
  );
  return m && poseOf(must(m[1], 'a name'));
};

/** What `wm size; wm density` say apps see: an override where one is set, else the panel's own. */
export const displayOf = (wm: string) => {
  const last = (re: RegExp) => [...wm.matchAll(re)].at(-1)?.[1];
  const size = last(/(?:Physical|Override) size: (\d+x\d+)/g);
  const density = last(/(?:Physical|Override) density: (\d+)/g);
  return size && density ? `display ${size} at ${density} dpi` : undefined;
};

/**
 * A foldable's pose by `cmd device_state` (API 31+), on a phone or an emulator alike. What is asked holds until it is
 * reset, whatever the hinge does and whatever becomes of this tool, so it is a condition: `default` is no request.
 */
export class AndroidFold {
  constructor(private readonly sh: (command: string) => Promise<string>) {}

  private async states() {
    const printed = await this.sh('cmd device_state print-states');
    const states = foldStates(printed);
    const poses = states.map((s) => s.pose);
    if (!poses.includes('open') || !poses.includes('closed'))
      throw new DeviceError(
        'UNSUPPORTED',
        states.length > 0
          ? `this device does not fold: its states are ${poses.join(', ')}`
          : `this device has no fold states (cmd device_state, API 31+): ${must(printed.trim().split('\n')[0], 'a line')}`,
      );
    return states;
  }

  /** Every pose this device lists, as `set` takes them. */
  async poses() {
    return (await this.states()).map((s) => s.pose);
  }

  async get() {
    await this.states();
    const dump = await this.sh('dumpsys device_state');
    return (
      poseIn(dump, 'mOverrideState') ?? `default (now ${poseIn(dump, 'mCommittedState') ?? '?'})`
    );
  }

  /** No request: the device goes to where its hinge is, which is waited for as a state asked for is. */
  private async reset() {
    await this.sh('cmd device_state state reset');
    const end = Date.now() + COMMITTED_MS;
    for (;;) {
      const dump = await this.sh('dumpsys device_state');
      const base = poseIn(dump, 'mBaseState');
      if (!base || poseIn(dump, 'mCommittedState') === base || Date.now() >= end) return;
      await sleep(READ_AGAIN_MS);
    }
  }

  /** The display apps see, once two reads of it are alike: a fold swaps it a moment after the state is the device's. */
  private async display() {
    const end = Date.now() + SETTLED_MS;
    let now = await this.sh('wm size; wm density');
    for (;;) {
      await sleep(SETTLE_AGAIN_MS);
      const next = await this.sh('wm size; wm density');
      if (next === now || Date.now() >= end) return displayOf(next);
      now = next;
    }
  }

  /** The system's last line of having made `activity` anew for a new configuration; empty where it has none. */
  private async relaunched(activity: string) {
    const lines = (await this.sh(`logcat -b events -d ${RELAUNCH} '*:S'`)).split('\n');
    return lines.findLast((l) => l.split(/[,\]]/).includes(activity)) ?? '';
  }

  /** What the answer adds: the display apps now see, and whether the activity in front was made anew for it. */
  async set(value: string): Promise<string | undefined> {
    if (value.startsWith('default')) {
      await this.reset();
      return undefined;
    }
    const states = await this.states();
    const state = states.find((s) => s.pose === asked(value));
    if (!state)
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `fold: ${states.map((s) => s.pose).join(', ')}, not ${value}`,
      );
    // who is in front, and the last time the system made it anew, before the change
    const front = /topResumedActivity=ActivityRecord\{\S+ \S+ (\S+)/.exec(
      await this.sh('dumpsys activity activities | grep -m1 topResumedActivity'),
    )?.[1];
    const before = front && (await this.relaunched(front));
    await this.sh(`cmd device_state state ${state.id}`);
    const end = Date.now() + COMMITTED_MS;
    let now = (await this.sh('cmd device_state print-state')).trim();
    while (now !== String(state.id) && Date.now() < end) {
      await sleep(READ_AGAIN_MS);
      now = (await this.sh('cmd device_state print-state')).trim();
    }
    if (now !== String(state.id))
      throw new DeviceError(
        'UNSUPPORTED',
        `asked for fold ${value} and the device stays in state ${now}: the request holds until restore resets it`,
      );
    const display = await this.display();
    // the log's line of a relaunch has its time to the millisecond: another than before is this change's
    const became =
      front && `${front} was ${(await this.relaunched(front)) !== before ? 'recreated' : 'kept'}`;
    return [display, became].filter(Boolean).join('; ');
  }
}
