import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@appdyno/protocol': src('protocol'),
      'appdyno': src('host'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
});
