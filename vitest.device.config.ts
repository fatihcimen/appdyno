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
      appdyno: src('appdyno'),
    },
  },
  test: {
    include: ['test-device/**/*.test.ts'],
    setupFiles: ['test-device/one-agent.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
