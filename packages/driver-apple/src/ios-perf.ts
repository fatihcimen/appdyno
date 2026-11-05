import { Cannot, cannot, sleep, type CompileMode } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';

const SHOWN_WITHIN_MS = 20_000;
const BEFORE_A_LAUNCH_MS = 500;

/** A launch that really took place: of two in the middle, the lower. */
export const lowerMedian = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : 0;
};

/** The times of `repeats` launches, after a first one that warms up. */
export async function sampleLaunches(
  repeats: number,
  each: {
    /** The app stopped, or another one in front: what kind of launch comes next. */
    prepare(): Promise<void>;
    launch(): Promise<number>;
  },
) {
  const samples: number[] = [];
  for (let i = 0; i < repeats + 1; i++) {
    await each.prepare();
    await sleep(BEFORE_A_LAUNCH_MS);
    const ms = await each.launch();
    if (i > 0) samples.push(ms);
  }
  return samples;
}

/**
 * Until `shown` comes true, counted from `from` on the clock of `performance.now`. A launch that showed no screen is
 * no measurement: the time it took is only how long this waited.
 */
export async function untilShown(bundle: string, shown: () => Promise<boolean>, from: number) {
  const end = from + SHOWN_WITHIN_MS;
  for (;;) {
    if (await shown()) return;
    if (performance.now() > end)
      throw new DeviceError(
        'TIMEOUT',
        `${bundle} showed no screen within 20 s`,
        'read the screen: a prompt, a lock or a crash can hold an app back',
      );
  }
}

/** What neither kind of iOS device has, and what both do alike. */
export abstract class IosPerf {
  /** A compile state is Android's: taken without a word, a launch would read as measured in it. */
  protected noCompileState(opts: { compile?: CompileMode }) {
    if (opts.compile) throw new Cannot('a launch in a compile state');
  }

  readonly symbolFiles = true;
  anonMemory = cannot('anonymous memory by process state');
  surfaceFrames = cannot("a surface's frames");
  baselineProfile = cannot('a Baseline Profile');
  threads = cannot('per-thread CPU');
  battery = cannot('wake locks, wakeups and jobs');
  startInfo = cannot('start info');
  heapProfile = cannot('a heap profile');
}
