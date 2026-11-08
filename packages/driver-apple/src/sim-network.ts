import { run, sleep, type Measured, type NetworkReading } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { parseNettop } from './perf-parse.js';

/** The bytes of a Mac process's sockets over the window, as nettop counts them; `during` starts after its first sample. */
export async function nettopBytes(
  pid: number,
  windowMs: number,
  during?: () => Promise<unknown>,
): Promise<Measured<NetworkReading>> {
  const seconds = Math.max(Math.ceil(windowMs / 1000), 1);
  // into a pipe it says nothing until it ends by itself, and a signal loses what it holds
  const nettop = run(
    'nettop',
    [
      '-P',
      '-x',
      '-n',
      '-L',
      String(seconds + 2),
      '-s',
      '1',
      '-J',
      'bytes_in,bytes_out',
      '-p',
      String(pid),
    ],
    { timeout: (seconds + 30) * 1000 },
  ).catch((e: unknown) => {
    throw new DeviceError(
      'UNSUPPORTED',
      `nettop: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
    );
  });
  const [{ stdout: raw }] = await Promise.all([nettop, sleep(1_000).then(() => during?.())]);
  return {
    value: {
      // from its first sample to its last
      windowMs: (seconds + 1) * 1000,
      ...parseNettop(raw),
      note: "The app's own sockets, as the Mac's nettop counts them, loopback included.",
    },
    raw,
    at: new Date().toISOString(),
  };
}
