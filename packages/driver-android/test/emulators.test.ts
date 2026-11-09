import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidEmulators, portFor } from '../src/emulators.js';

describe('an emulator started', () => {
  it('takes the port it ran on again, so that its serial comes back, and else the first free one', () => {
    const taken = new Set(['emulator-5554']);
    expect(portFor(taken, 'emulator-5682')).toBe(5682);
    expect(portFor(taken)).toBe(5556);
    expect(portFor(new Set(['emulator-5554', 'emulator-5682']), 'emulator-5682')).toBe(5556);
    expect(portFor(new Set(), 'R5CT10ABCDE')).toBe(5554);
  });

  it('comes back on the port it was listed on, as a window that waits for it knows it by that serial', async () => {
    const sdk = mkdtempSync(join(tmpdir(), 'appdyno-sdk-'));
    mkdirSync(join(sdk, 'emulator'));
    // lists one AVD, and as the emulator itself stays up a moment
    writeFileSync(
      join(sdk, 'emulator/emulator'),
      '#!/bin/sh\nif [ "$1" = "-list-avds" ]; then echo Pixel_34; else sleep 3; fi\n',
      { mode: 0o755 },
    );
    vi.stubEnv('ANDROID_HOME', sdk);
    vi.stubEnv('APPDYNO_EMULATOR_ARGS', '-no-window');
    let up = ['emulator-5642'];
    const then: string[] = [];
    const adb = {
      devices: () => {
        const now = up;
        if (then.length > 0) up = then;
        return Promise.resolve(now.map((serial) => ({ serial, state: 'device' })));
      },
      run: () => Promise.resolve('Pixel_34\nOK'),
      exec: () => Promise.resolve('1'),
    };
    const emulators = new AndroidEmulators(adb as unknown as Adb);
    expect((await emulators.startable()).map((d) => d.id)).toEqual(['emulator-5642']);
    // it went, another took the first port, and whatever starts next answers at once
    up = ['emulator-5554'];
    then.push('emulator-5554', 'emulator-5556', 'emulator-5642');
    expect(await emulators.boot('Pixel_34')).toBe('emulator-5642');
  });
});
