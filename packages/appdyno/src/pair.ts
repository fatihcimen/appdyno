import { parseArgs } from 'node:util';
import { Adb, overNetwork } from '@appdyno/driver-android';
import { forgetPhone, pairPhone } from '@appdyno/driver-apple';
import { pause } from '@appdyno/core';
import { COMMANDS, usage } from './usage.js';

/** How long adb takes to connect by itself to a phone it has just paired with, as it finds it on the network. */
const CONNECT_MS = 10_000;
const LOOK_MS = 500;
const FORGOTTEN =
  'This Mac has forgotten the pairing. The phone keeps its half until it clears its trusted computers.';

/** `appdyno pair`: once per phone, with a person at it, and nothing is paired by anything else. */
export async function pairCommand(
  args: string[],
  use: {
    adb: Pick<Adb, 'pair' | 'devices'>;
    phone: typeof pairPhone;
    forget: typeof forgetPhone;
    say(line: string): void;
  } = {
    adb: new Adb(),
    phone: pairPhone,
    forget: forgetPhone,
    say: (line) => console.log(line),
  },
) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: COMMANDS.pair.flags,
  });
  const [address, code] = positionals;
  if (values.help) {
    use.say(usage('pair'));
    return 0;
  }
  if (values.device && values.forget) {
    use.forget(values.device);
    use.say(FORGOTTEN);
    return 0;
  }
  if (values.device && !address) {
    await use.phone(values.device, use.say);
    return 0;
  }
  if (!address || !code) {
    use.say(usage('pair'));
    return 2;
  }
  const before = new Set((await use.adb.devices()).map((d) => d.serial));
  await use.adb.pair(address, code);
  const end = Date.now() + CONNECT_MS;
  while (Date.now() < end) {
    const now = (await use.adb.devices()).find(
      (d) => overNetwork(d.serial) && !before.has(d.serial),
    );
    if (now) {
      use.say(`Paired: ${now.serial}`);
      return 0;
    }
    await pause(LOOK_MS);
  }
  use.say(
    'Paired. adb did not find the phone by itself: run adb connect with the address and port under Wireless debugging.',
  );
  return 0;
}
