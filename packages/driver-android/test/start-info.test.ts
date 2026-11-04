import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { parseStartInfo, startInfo } from '../src/perf/start-info.js';

/** As a Xiaomi with Android 16 prints them: a warm start with one timestamp, and a cold one in full. */
const DUMP = `ACTIVITY MANAGER LRU PROCESSES (dumpsys activity start-info)
  package: dev.appdyno.fixture
    Historical Process Start for userId=10469
        ApplicationStartInfo #0:
 monotonicCreationTimeMs=1737152520
 pid=30953 realUid=10469 packageUid=10469 definingUid=10469 user=0
 package=dev.appdyno.fixture process=dev.appdyno.fixture startupState=1 reason=START ACTIVITY startType=WARM launchMode=0 wasForceStopped=true startComponent=ACTIVITY
 intent=Intent { act=android.intent.action.VIEW dat=appdyno-fixture://open/... flg=0x10000000 xflg=0x4 pkg=dev.appdyno.fixture }
 timestamps: 0=433894334439707
        ApplicationStartInfo #1:
 monotonicCreationTimeMs=1736871032
 pid=0 realUid=10469 packageUid=10469 definingUid=10469 user=0
 package=dev.appdyno.fixture process=dev.appdyno.fixture startupState=2 reason=BROADCAST startType=COLD launchMode=0 wasForceStopped=false startComponent=BROADCAST
 timestamps: 0=433612846493229 1=433612923413306 2=433613577961844 3=433613101175998 4=433614008817844 5=433614061014537 6=433613898249229 7=433614024643075
`;

const device = (sdk: number, dump: string) => ({
  shell: async (cmd: string) => (cmd.includes('getprop') ? `${sdk}\n` : dump),
});

describe('start info', () => {
  it('reads why it started and each phase, binding before onCreate', () => {
    const [warm, cold] = parseStartInfo(DUMP);
    expect(warm).toEqual({
      reason: 'START ACTIVITY',
      startType: 'WARM',
      wasForceStopped: true,
      phases: {},
    });
    expect(cold).toEqual({
      reason: 'BROADCAST',
      startType: 'COLD',
      wasForceStopped: false,
      phases: {
        fork: 76.9,
        bind_application: 177.8,
        before_oncreate: 476.8,
        oncreate_to_first_frame: 430.9,
        fully_drawn: 52.2,
      },
    });
  });

  it('names a first frame with no onCreate to count from for what it is', () => {
    const [start] = parseStartInfo(
      'ApplicationStartInfo #0:\n reason=START ACTIVITY startType=HOT\n timestamps: 0=1000000000 4=1100000000 \n',
    );
    expect(start!.phases).toEqual({ first_frame: 100 });
  });

  it('refuses before Android 15, by name', async () => {
    await expect(startInfo(device(34, '') as never, 'dev.app')).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: expect.stringContaining('this device has API 34'),
    });
  });

  it('refuses a device that keeps none, rather than an empty answer', async () => {
    const e = await startInfo(device(35, 'nothing') as never, 'dev.app').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DeviceError);
    expect((e as DeviceError).message).toContain('keeps no start info');
  });

  it('answers the newest first', async () => {
    const { value } = await startInfo(device(36, DUMP) as never, 'dev.app');
    expect(value.starts).toHaveLength(2);
    expect(value.newest.startType).toBe('WARM');
  });
});
