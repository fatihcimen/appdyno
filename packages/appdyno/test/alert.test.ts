import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { alertOf } from '../src/alert.js';

it('sounds and shows nothing for a hand_off on a server run --silent or with APPDYNO_SILENT=1', () => {
  expect(alertOf(true, {})).toBeUndefined();
  expect(alertOf(undefined, { APPDYNO_SILENT: '1' })).toBeUndefined();
  expect(alertOf(false, { APPDYNO_SILENT: '1' })).toBeUndefined();
  expect(alertOf(undefined, {})).toBeTypeOf('function');
  expect(alertOf(undefined, { APPDYNO_SILENT: '0' })).toBeTypeOf('function');
});

it('is silent in every server a device suite starts, which takes the environment of its run', () => {
  const config = readFileSync(
    join(import.meta.dirname, '../../../vitest.device.config.ts'),
    'utf8',
  );
  expect(config).toMatch(/\benv: \{ APPDYNO_SILENT: '1' \}/);
});
