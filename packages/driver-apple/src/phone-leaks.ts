import type { HeapReading, Measured } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { bundleSize } from './bundle-size.js';
import { parseLeakRows } from './trace-parse.js';
import { recordTrace, traceDetail } from './trace.js';

/** The instrument's first look at the heap comes 10 s in: a recording of 5 s reads none of 3 retain cycles made. */
const LEAKS_SECONDS = 15;

/**
 * The Leaks template attached to the running app: what it holds now that nothing reaches. It needs the app's task
 * port: an app signed for development, never a system or App Store app.
 */
export async function phoneLeaks(
  device: string,
  bundle: string,
  pid: () => Promise<number>,
  dir: string,
): Promise<Measured<HeapReading>> {
  const trace = await recordTrace({
    template: 'Leaks',
    device,
    attach: pid,
    attachedOnly: true,
    seconds: LEAKS_SECONDS,
    dir,
  }).catch((e: unknown) => {
    throw e instanceof DeviceError && e.code === 'UNSUPPORTED'
      ? new DeviceError(
          'UNSUPPORTED',
          `no leaks of ${bundle}: ${e.message}`,
          'it works on an app signed for development (get-task-allow), not on a system or App Store app',
        )
      : e;
  });
  const raw = await traceDetail(trace, 'Leaks', 'Leaks');
  return {
    value: {
      file: trace,
      bytes: (await bundleSize(trace)).bytes,
      kind: 'trace',
      ...parseLeakRows(raw),
      note: 'Leaked objects as Instruments lists them: a retain cycle of two objects counts as two.',
    },
    raw,
    at: new Date().toISOString(),
  };
}
