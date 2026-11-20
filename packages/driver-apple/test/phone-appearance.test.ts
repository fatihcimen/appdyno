import { describe, expect, it } from 'vitest';
import type { Devicectl } from '../src/devicectl.js';
import { PhoneSettings } from '../src/phone-manage.js';

/** `devicectl device info appearance` as a phone answers it: increaseContrast is a bare boolean, the others objects. */
const phone = (on: boolean) =>
  new PhoneSettings({
    udid: '00008110-000000000000001E',
    json: () =>
      Promise.resolve({
        result: {
          increaseContrast: on,
          reduceMotion: { enabled: on },
          reduceTransparency: { enabled: on },
          colorFilter: { enabled: false },
        },
      }),
  } as unknown as Devicectl);

describe("an iPhone's appearance switches", () => {
  it('read as the phone has them, increase_contrast too', async () => {
    for (const on of [true, false]) {
      const settings = phone(on);
      for (const name of ['increase_contrast', 'reduce_motion', 'reduce_transparency'] as const)
        expect([name, await settings.get(name)]).toEqual([name, on ? 'on' : 'off']);
    }
  });
});
