import type { InputEvent } from '@appdyno/core';
import { type Key, KEY_USAGES } from '@appdyno/protocol';
import { onSurface } from '../mirror-sim.js';
import { usageOf } from '../simtouch.js';
import type { RemoteXpc } from './remotexpc.js';

/**
 * A person's input, into a phone's HID services. It only works while a stream runs: the phone drops what comes
 * with none. A finger goes by UniversalHID, which follows a drag; buttons and keys go by Indigo, as a simulator's do.
 */
const REPORT_BYTES = 58;
const REPORT_TOUCH = 0x09;
const TOUCHING = 0xc2;
const RELEASED = 0x02;
const SURFACE = 257n;
const UNIT = 65_535;
const UNIVERSAL_FEATURE = 'com.apple.coredevice.feature.remote.universalhidservice';
const BUTTON_FEATURE = 'com.apple.coredevice.feature.remote.hid.button';
const KEYBOARD_PAGE = 7;
const SHIFT = 0xe1;
const DOWN = 1;
const UP = 2;
const PRESS_MS = 100;

const unit = (fraction: number) => Math.max(0, Math.min(UNIT, Math.round(fraction * UNIT)));

/** One contact, as a fraction of the screen the phone has it in. */
export function touchReport(state: number, x: number, y: number, now: bigint): Buffer {
  const r = Buffer.alloc(REPORT_BYTES);
  r[0] = REPORT_TOUCH;
  r[1] = 1;
  r[2] = 5;
  r[3] = state;
  r.writeUInt16LE(unit(x), 4);
  r.writeUInt16LE(unit(y), 6);
  r.set([2, 0, 0, 0], 40);
  r.writeUIntLE(Number(now & 0xffffffffffffn), 44, 6);
  return r;
}

export class PhoneHid {
  /** Quarter turns of the picture from the screen: a touch is turned back on its way down. */
  turns = 0;

  constructor(
    private readonly indigo: RemoteXpc,
    private readonly universal: RemoteXpc,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  private touch(state: number, fx: number, fy: number) {
    const { x, y } = onSurface(fx, fy, this.turns);
    this.universal.send(
      {
        featureIdentifier: UNIVERSAL_FEATURE,
        messageType: 'Request',
        payload: { send: { _0: touchReport(state, x, y, process.hrtime.bigint()), _1: SURFACE } },
      },
      false,
    );
  }

  private button(page: number, usage: number, state: number) {
    this.indigo.send(
      {
        messageType: 'IndigoButtonEvent',
        payload: { state: BigInt(state), usagePage: BigInt(page), usageCode: BigInt(usage) },
        featureIdentifier: BUTTON_FEATURE,
      },
      false,
    );
  }

  private async press(page: number, usage: number) {
    this.button(page, usage, DOWN);
    await this.wait(PRESS_MS);
    this.button(page, usage, UP);
  }

  private async type(text: string) {
    for (const c of text) {
      const key = usageOf(c);
      if (!key) throw new Error('a character with no key on a US keyboard');
      if (key.shift) this.button(KEYBOARD_PAGE, SHIFT, DOWN);
      this.button(KEYBOARD_PAGE, key.usage, DOWN);
      this.button(KEYBOARD_PAGE, key.usage, UP);
      if (key.shift) this.button(KEYBOARD_PAGE, SHIFT, UP);
    }
  }

  /** In the order they come. What takes time is finished before the next. */
  async send(e: InputEvent): Promise<void> {
    switch (e.kind) {
      case 'touch':
        this.touch(e.p === 2 ? RELEASED : TOUCHING, e.x, e.y);
        return;
      case 'key':
        this.button(e.page, e.usage, e.state);
        return;
      case 'text':
        await this.type(e.s);
        return;
      case 'button': {
        const key = KEY_USAGES[e.name as Key];
        if (key) await this.press(key.page, key.usage);
      }
    }
  }
}
