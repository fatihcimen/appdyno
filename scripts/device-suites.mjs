// Which device suites a device can take, and whether a run of them ran anything: vitest exits 0 on a file that skipped
// all it holds, so a green run could mean nothing was tried. Run by `scripts/ci.sh`.
//
//   node scripts/device-suites.mjs of <serial>         its variable, then a suite a line: each file that reads it
//   node scripts/device-suites.mjs check <report>      exit 3 where a vitest JSON report ran nothing
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SUITES = join(import.meta.dirname, '../test-device');

/** What names a device to a suite. A suite gates on these, and never takes a device by default. */
const VARIABLES = {
  android: 'APPDYNO_ANDROID_SERIAL',
  simulator: 'APPDYNO_IOS_UDID',
  iphone: 'APPDYNO_IPHONE_UDID',
};

/** A simulator's id is a UUID, an iPhone's is its chip and a number; anything else is what adb names. */
export const kindOf = (serial) =>
  /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(serial)
    ? 'simulator'
    : /^[0-9A-F]{8}-[0-9A-F]{16}$|^[0-9a-f]{40}$/i.test(serial)
      ? 'iphone'
      : 'android';

const suites = (variable) =>
  readdirSync(SUITES)
    .filter((f) => f.endsWith('.test.ts'))
    .filter((f) => readFileSync(join(SUITES, f), 'utf8').includes(variable))
    .map((f) => `test-device/${f}`)
    .sort();

const [command, argument] = process.argv.slice(2);
if (command === 'of' && argument) {
  const variable = VARIABLES[kindOf(argument)];
  console.log([variable, ...suites(variable)].join('\n'));
} else if (command === 'check' && argument) {
  const { numPassedTests, numFailedTests, numTotalTests } = JSON.parse(
    readFileSync(argument, 'utf8'),
  );
  if (numPassedTests + numFailedTests === 0) {
    console.log(`ran nothing: all ${numTotalTests} tests skipped`);
    process.exit(3);
  }
} else {
  console.error('usage: device-suites.mjs of <serial> | check <report.json>');
  process.exit(2);
}
