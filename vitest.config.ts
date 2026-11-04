import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));

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
    include: ['packages/*/test/**/*.test.ts'],
  },
});
