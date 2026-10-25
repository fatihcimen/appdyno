import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url));

// Tests on a real emulator or device: APPDYNO_ANDROID_SERIAL names it (never a default: other devices may be attached).
export default defineConfig({
  resolve: {
    alias: {
      '@appdyno/protocol': src('protocol'),
      'appdyno': src('host'),
    },
  },
  test: {
    include: ['test-device/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
