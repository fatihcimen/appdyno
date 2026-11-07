import { DeviceError } from '@appdyno/protocol';

/** Android's own cap on what the device takes in, from Android 13: a download speed and nothing else. */
const INGRESS = 'ingress_rate_limit_bytes_per_second';
const INGRESS_SDK = 33;
/** An EDGE network's download, as the emulator's own `edge` speed has it: 236.8 kbit/s. */
const SLOW_BYTES = 29_600;
export const CAP_SAYS = 'a download cap alone: no delay, and uploads go at full speed';

/**
 * A slow network: an emulator's console shapes both ways with a delay; from Android 13 a phone has only a cap on its
 * downloads, which a number of bytes a second also sets on an emulator. The cap stays through a reboot.
 */
export class AndroidShaping {
  private sdk: number | undefined;

  constructor(
    private readonly serial: string,
    private readonly sh: (command: string) => Promise<string>,
    private readonly emu: (what: string, ...words: string[]) => Promise<string>,
  ) {}

  private get emulator() {
    return this.serial.startsWith('emulator-');
  }

  private async capped() {
    this.sdk ??= Number((await this.sh('getprop ro.build.version.sdk')).trim());
    return this.sdk >= INGRESS_SDK;
  }

  private noShaping() {
    return new DeviceError(
      'UNSUPPORTED',
      `this phone has Android below 13: it has no network shaping, which only an emulator's console and a cap of Android 13's give`,
    );
  }

  async get() {
    if (await this.capped()) {
      const cap = (await this.sh(`settings get global ${INGRESS}`)).trim();
      if (/^\d+$/.test(cap) && cap !== '0') return cap;
    } else if (!this.emulator) throw this.noShaping();
    if (this.emulator) await this.emu('network shaping', 'network', 'status');
    return 'full';
  }

  /** What the answer says of it, where it is only a cap. */
  async set(value: string): Promise<string | void> {
    const bytes = value === 'slow' && !this.emulator ? String(SLOW_BYTES) : value;
    if (/^\d+$/.test(bytes)) {
      if (!(await this.capped())) throw this.noShaping();
      await this.sh(`settings put global ${INGRESS} ${bytes}`);
      return `${CAP_SAYS}, at ${Math.round(Number(bytes) / 1000)} kB/s`;
    }
    if (bytes === 'full' && (await this.capped()))
      await this.sh(`settings delete global ${INGRESS}`);
    if (!this.emulator) {
      if (bytes === 'full') return;
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `network on a phone: slow, full or bytes a second, not ${value}`,
      );
    }
    if (!/^\w+$/.test(bytes))
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `network: slow, full or a speed name, not ${value}`,
      );
    await this.emu('network shaping', 'network', 'speed', bytes === 'slow' ? 'edge' : bytes);
    await this.emu(
      'network shaping',
      'network',
      'delay',
      ...(bytes === 'slow' ? ['40', '100'] : ['none']),
    );
  }
}
