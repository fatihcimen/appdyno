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
      '@appdyno/mcp': src('mcp'),
      '@appdyno/cli': src('cli'),
      appdyno: src('appdyno'),
    },
  },
  test: {
    // a test's own work, on a machine others are also using: a hang still fails
    testTimeout: 30_000,
    env: { APPDYNO_STATE_DIR: own },
    setupFiles: ['packages/appdyno/test/no-real-state.setup.ts'],
    globalSetup: ['packages/appdyno/test/no-real-state.teardown.ts'],
    include: ['packages/*/test/**/*.test.ts'],
  },
});
