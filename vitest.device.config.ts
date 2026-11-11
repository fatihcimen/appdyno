import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));

// Tests on a real emulator or device: APPDYNO_ANDROID_SERIAL names it (never a default: other devices may be attached).
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
      appdyno: src('appdyno'),
    },
  },
  test: {
    include: ['device-tests/**/*.test.ts'],
    setupFiles: ['device-tests/one-agent.ts'],
    // a server a suite starts plays no sound and posts no notification for a hand_off: a run is no one's to answer
    env: { APPDYNO_SILENT: '1' },
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
