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
      '@appdyno/ops': src('ops'),
      '@appdyno/mcp': src('mcp'),
      '@appdyno/cli': src('cli'),
      appdyno: src('appdyno'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
});
