import { DeviceError } from '@appdyno/protocol';
import { loadPhoneStream } from './mirror-phone.js';
import type { PhoneCondition, PhoneStreamModule } from './phone-stream-port.js';

/** Each condition a setting holds, by the phone's identifier for it, and what it reads as with none on. */
const KINDS = {
  network: { id: /network/i, off: 'full' },
  thermal: { id: /thermal/i, off: 'nominal' },
} as const;
export type ConditionKind = keyof typeof KINDS;
/** `slow` as an emulator has it: an EDGE network. */
const SLOW = /edge/i;

/** A profile by what a person calls it: its identifier, or how it ends (`3G`, `Serious`). */
const profileNamed = (c: PhoneCondition, value: string) =>
  c.profiles.find((p) => p.toLowerCase() === value.toLowerCase()) ??
  c.profiles.find((p) => p.toLowerCase().endsWith(value.toLowerCase()));

/**
 * An iPhone's own conditions, as Xcode's Devices window sets them, through the phone's instruments: a network profile
 * caps what the phone's network does, and a thermal one is a floor under the state apps read. One at a time.
 */
export class PhoneConditions {
  constructor(
    private readonly udid: string,
    private readonly load: () => Promise<PhoneStreamModule | undefined> = loadPhoneStream,
  ) {}

  private async stream() {
    const s = await this.load();
    if (!s)
      throw new DeviceError(
        'UNSUPPORTED',
        "this build has no phone stream, which an iPhone's network and thermal conditions go through",
      );
    return s;
  }

  private async read(kind: ConditionKind) {
    const all = await (await this.stream()).conditions(this.udid);
    const c = all.find((x) => KINDS[kind].id.test(x.id));
    if (!c)
      throw new DeviceError(
        'UNSUPPORTED',
        `this iPhone offers no ${kind} condition, only ${all.map((x) => x.id).join(', ') || 'none'}`,
      );
    return { c, other: all.find((x) => x !== c && x.on) };
  }

  async get(kind: ConditionKind) {
    return (await this.read(kind)).c.on ?? KINDS[kind].off;
  }

  async set(kind: ConditionKind, value: string) {
    const stream = await this.stream();
    const { c, other } = await this.read(kind);
    if (value === KINDS[kind].off) {
      if (c.on) await stream.induce(this.udid);
      return;
    }
    if (other)
      throw new DeviceError(
        'UNSUPPORTED',
        `an iPhone holds one condition at a time, and ${other.id} is on: restore it first`,
      );
    const profile =
      value === 'slow' && kind === 'network'
        ? c.profiles.find((p) => SLOW.test(p))
        : profileNamed(c, value);
    if (!profile)
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `${kind}: ${[KINDS[kind].off, ...(kind === 'network' ? ['slow'] : []), ...c.profiles].join(', ')}, not ${value}`,
      );
    await stream.induce(this.udid, { id: c.id, profile });
    return `the phone's own ${profile}, as Xcode sets it`;
  }
}
