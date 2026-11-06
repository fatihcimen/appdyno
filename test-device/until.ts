import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * What a suite waits by. A wedged device and a failed feature read alike as a wait that ran out, so one that runs out
 * says how the device stood, in what the device itself answers.
 */
const run = promisify(execFile);

const ASK_MS = 5_000;
const LOOK_MS = 100;
const SAID = 200;

const SIMULATOR = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const IPHONE = /^[0-9A-F]{8}-[0-9A-F]{16}$|^[0-9a-f]{40}$/i;

/** Where a suite is told of a device: some name several. */
const NAMED = [
  'APPDYNO_ANDROID_SERIAL',
  'APPDYNO_IOS_UDID',
  'APPDYNO_IPHONE_UDID',
  'APPDYNO_HUB_SIM',
  'APPDYNO_HUB_SIMULATOR',
  'APPDYNO_HUB_DEVICES',
  'APPDYNO_PAIR',
];

export const devicesOfRun = (env: Record<string, string | undefined> = process.env) => [
  ...new Set(NAMED.flatMap((name) => env[name]?.split(',') ?? [])),
];

/** The command that asks a device how it stands, and which of its lines are about it. */
export function askOf(id: string): {
  file: string;
  args: string[];
  about: (line: string) => boolean;
} {
  const named = (line: string) => line.includes(id);
  if (SIMULATOR.test(id))
    return { file: 'xcrun', args: ['simctl', 'list', 'devices', id], about: named };
  if (IPHONE.test(id))
    return { file: 'xcrun', args: ['devicectl', 'list', 'devices'], about: named };
  return {
    file: 'adb',
    args: [
      '-s',
      id,
      'shell',
      'dumpsys power | grep -m1 mWakefulness=; dumpsys window | grep -m1 mCurrentFocus',
    ],
    about: () => true,
  };
}

async function stateOf(id: string) {
  const { file, args, about } = askOf(id);
  const said = await run(file, args, { timeout: ASK_MS }).then(
    ({ stdout }) =>
      stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && about(line))
        .join(', '),
    (e: Error) => `no answer: ${e.message}`,
  );
  return `${id}: ${said.slice(0, SAID) || 'not listed'}`;
}

export const deviceState = async () =>
  (await Promise.all(devicesOfRun().map(stateOf))).join('; ') || 'no device named';

/** A wait of `within` ms unless told otherwise. */
export const untilWithin =
  (within: number, stateNow: () => Promise<string> = deviceState) =>
  async (what: string, test: () => boolean | Promise<boolean>, ms = within) => {
    const end = Date.now() + ms;
    while (!(await test())) {
      if (Date.now() > end) throw new Error(`no ${what} in ${ms} ms; ${await stateNow()}`);
      await new Promise((r) => setTimeout(r, LOOK_MS));
    }
  };
