import { sleep } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';

/** How long a state asked for has to become the device's. */
const COMMITTED_MS = 3_000;
const READ_AGAIN_MS = 200;
const STATE = /DeviceState\{identifier=(\d+), name='([^']+)'/g;

export type FoldState = { id: number; pose: string };

/** A state's name as a pose: open and closed by the names makers give them, any other as itself. */
export const poseOf = (name: string) =>
  /^(CLOSED|FOLDED)$/i.test(name)
    ? 'closed'
    : /^(OPEN|OPENED|UNFOLDED)$/i.test(name)
      ? 'open'
      : name.toLowerCase();

/** The states of `cmd device_state print-states`, by their ids, which differ by device. */
export const foldStates = (printed: string): FoldState[] =>
  [...printed.matchAll(STATE)].map((m) => ({ id: Number(m[1]), pose: poseOf(m[2]!) }));

/** The state `dumpsys device_state` names on its line `key`, as a pose. */
const poseIn = (dump: string, key: string) => {
  const m = new RegExp(`${key}=Optional\\[DeviceState\\{identifier=\\d+, name='([^']+)'`).exec(
    dump,
  );
  return m && poseOf(m[1]!);
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
          : `this device has no fold states (cmd device_state, API 31+): ${printed.trim().split('\n')[0]}`,
      );
    return states;
  }

  async get() {
    await this.states();
    const dump = await this.sh('dumpsys device_state');
    return (
      poseIn(dump, 'mOverrideState') ?? `default (now ${poseIn(dump, 'mCommittedState') ?? '?'})`
    );
  }

  async set(value: string) {
    if (value.startsWith('default')) {
      await this.sh('cmd device_state state reset');
      return;
    }
    const states = await this.states();
    const state = states.find((s) => s.pose === value.toLowerCase());
    if (!state)
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `fold: ${states.map((s) => s.pose).join(', ')}, not ${value}`,
      );
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
  }
}
