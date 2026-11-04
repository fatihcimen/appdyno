import { existsSync, readFileSync, rmSync } from 'node:fs';

/** Fails a unit test run that reached this Mac's own state, whatever became of the error it was given. */
export function teardown() {
  const file = process.env.APPDYNO_TEST_BREACH_FILE!;
  const breaches = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  rmSync(file, { force: true });
  if (breaches) {
    process.exitCode = 1;
    throw new Error(`unit tests reached this Mac's own state:\n${breaches}`);
  }
}
