import { defineConfig } from 'vitest/config';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));

/** Each run's own: a unit test never has this Mac's traces, runs or recordings to reach. */
const own = mkdtempSync(join(tmpdir(), 'appdyno-unit-'));
// here, and not in `test.env`: the end of the run reads it in this process, not in a worker
process.env.APPDYNO_TEST_BREACH_FILE = join(own, 'breaches');
/**
 * The run's own temporary folder, which the end of the run takes away with all a test left in it: its name is short,
 * as a test's Unix socket under it must keep to the 104 bytes a socket's path may have.
 */
const scratch = mkdtempSync(join(tmpdir(), 'ad-'));
process.env.APPDYNO_TEST_RUN_DIRS = [own, scratch].join('\n');

export default defineConfig({
  resolve: {
    alias: {
      '@appdyno/protocol': src('protocol'),
      '@appdyno/core': src('core'),
      '@appdyno/driver-android': src('driver-android'),
      '@appdyno/driver-apple': src('driver-apple'),
      '@appdyno/flows': src('flows'),
      '@appdyno/perf': src('perf'),
      '@appdyno/ops': src('ops'),
      '@appdyno/hub': src('hub'),
      '@appdyno/mcp': src('mcp'),
      '@appdyno/cli': src('cli'),
      // the fakes are files of their own, each taken by its path
      '@appdyno/testing': fileURLToPath(new URL('./packages/testing/src', import.meta.url)),
      // before the name it begins with, which would take it
      'appdyno/device': fileURLToPath(new URL('./packages/appdyno/src/device.ts', import.meta.url)),
      appdyno: src('appdyno'),
    },
  },
  test: {
    // a test's own work, on a machine others are also using: a hang still fails
    testTimeout: 30_000,
    // what is compiled outlives a run, and stays out of this Mac's own state as all else does
    env: {
      APPDYNO_STATE_DIR: own,
      APPDYNO_NATIVE_DIR: join(tmpdir(), 'appdyno-test-native'),
      APPDYNO_TOOLS_DIR: join(own, 'tools'),
      // the Mac a test fakes the load of, and not the runner it runs on, which is a virtual one on CI
      APPDYNO_HOST_VIRTUAL: '0',
      // every folder a test makes under tmpdir() is this run's, and goes with it
      TMPDIR: scratch,
    },
    setupFiles: ['packages/appdyno/test/no-real-state.setup.ts'],
    globalSetup: ['packages/appdyno/test/no-real-state.teardown.ts'],
    // the phone's stream keeps its tests in its folder, so that it can go whole
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/driver-apple/src/phone-stream/test/*.test.ts',
    ],
  },
});
