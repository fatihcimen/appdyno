import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { CompileMode } from '@appdyno/core';
import { parseCompileStatus } from '../src/perf/parse.js';
import type { PerfDevice } from '../src/perf/shared.js';
import { baselineProfile } from '../src/perf/baseline.js';
import { resetCompile } from '../src/perf/launch.js';

/** A measured launch as the device did it: compiled as asked, one start of what that compiled, and reset. */
vi.mock('../src/perf/launch.js', async (original) => {
  const real = await original<typeof import('../src/perf/launch.js')>();
  return {
    ...real,
    launch: async (d: PerfDevice, pkg: string, o: { compile: CompileMode }) => {
      await d.shell(`cmd package compile -m ${o.compile} -f ${pkg}`);
      const status = parseCompileStatus(await real.dexoptState(d, pkg));
      const totalMs = status?.includes('speed-profile') ? 150 : 300;
      await d.shell(`cmd package compile --reset ${pkg}`);
      return {
        value: { samples: [{ totalMs, state: 'COLD' }], compile: { asked: o.compile, status } },
        raw: '',
      };
    },
  };
});

/** A device by what its shell answers, in the order asked; every command kept. */
const device = (answer: (command: string) => string) => {
  const asked: string[] = [];
  const d = {
    readyToMeasure: () => Promise.resolve(),
    ensureAwake: () => Promise.resolve(),
    serial: 'emulator-5554',
    shell: (command: string) => {
      const c = command.replace(/^LC_ALL=C /, '');
      asked.push(c);
      return Promise.resolve(answer(c));
    },
  };
  return { d: d as unknown as PerfDevice, asked };
};

const LISTED = `Archive:  /data/app/x/base.apk
  Length      Date    Time    Name
     6943  1981-01-01 01:01   assets/dexopt/baseline.prof
`;

/** An app on an API 34 device: a compile has only what the last broadcast left, and a reset takes that. */
const app = (o: { listing?: string; installs?: boolean; debuggable?: boolean } = {}) => {
  let status = 'status=verify] [reason=install';
  let profile = false;
  const installs = o.installs ?? true;
  return device((c) => {
    if (c.includes('dumpsys package')) {
      if (c.includes('dexopt')) return `arm64: [${status}] [primary-abi]`;
      return o.debuggable ? 'flags=[ DEBUGGABLE ]' : 'flags=[ ]';
    }
    if (c.startsWith('pm path')) return 'package:/data/app/x/base.apk';
    if (c.startsWith('unzip')) return o.listing ?? LISTED;
    if (c.startsWith('am broadcast')) {
      profile = installs;
      return `Broadcast completed: result=${installs ? 1 : 0}`;
    }
    if (c.startsWith('wc -l')) return '34371 /data/misc/profman/x.txt';
    if (c.includes('compile --reset')) {
      profile = false;
      status = 'status=verify] [reason=install';
    } else if (c.includes('compile -m verify')) status = 'status=verify] [reason=cmdline';
    else if (c.includes('compile -m speed-profile'))
      status = `status=${profile ? 'speed-profile' : 'verify'}] [reason=cmdline`;
    return '';
  });
};

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DeviceError);
    return e as DeviceError;
  }
  throw new Error('it did not refuse');
};

describe('a Baseline Profile', () => {
  it('installs it again before each turn: a reset takes it away', async () => {
    const { d, asked } = app();
    const { value } = await baselineProfile(d, 'dev.app', { repeats: 1 });
    expect(asked.filter((c) => c.startsWith('am broadcast'))).toHaveLength(3);
    expect(value).toEqual({
      present: true,
      state: 'status=verify reason=install',
      applied: false,
      rules: 34371,
      without: [300, 300, 300],
      with: [150, 150, 150],
    });
  });

  it('refuses a comparison when the profile compiled nothing, rather than time it', async () => {
    const e = await refusal(baselineProfile(app({ installs: false }).d, 'dev.app', { repeats: 1 }));
    expect(e.code).toBe('UNSUPPORTED');
    expect(e.message).toContain('the profile compiled nothing here');
    expect(e.message).toContain('result=0');
    expect(e.message).toContain('install the APK with its .dm');
  });

  it('says none is in the APK, and starts nothing', async () => {
    const { d, asked } = app({ listing: 'Archive:  /x/base.apk\n  Length Name\n0 0 files\n' });
    const { value } = await baselineProfile(d, 'dev.app', { repeats: 1 });
    expect(value.present).toBe(false);
    expect(value.without).toEqual([]);
    expect(asked.filter((c) => c.startsWith('am start'))).toEqual([]);
  });

  it("compiles a .dm's profile again after the reset, where Android 17's reset compiles nothing with it", async () => {
    let status = 'status=speed-profile] [reason=install-dm';
    const { d, asked } = device((c) => {
      if (c.includes('dexopt')) return `arm64: [${status}] [primary-abi]`;
      if (c.includes('compile --reset')) status = 'status=verify] [reason=install-dm';
      else if (c.includes('compile -m speed-profile'))
        status = 'status=speed-profile] [reason=cmdline';
      return '';
    });
    await resetCompile(d, 'dev.app', 'status=speed-profile reason=install-dm');
    expect(asked.filter((c) => c.startsWith('cmd package compile'))).toEqual([
      'cmd package compile --reset dev.app',
      'cmd package compile -m speed-profile -f dev.app',
    ]);
    expect(status).toContain('speed-profile');
    // an app the install left at verify stays there
    asked.length = 0;
    await resetCompile(d, 'dev.app', 'status=verify reason=install');
    expect(asked.filter((c) => c.startsWith('cmd package compile'))).toEqual([
      'cmd package compile --reset dev.app',
    ]);
  });

  it('refuses a debuggable app, and a device that cannot list an APK', async () => {
    const debug = await refusal(
      baselineProfile(app({ debuggable: true }).d, 'dev.app', { repeats: 1 }),
    );
    expect(debug.message).toContain('measure a release build');
    const none = await refusal(
      baselineProfile(app({ listing: 'unzip: not found' }).d, 'dev.app', { repeats: 1 }),
    );
    expect(none.message).toContain('cannot list an APK');
  });
});
