import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ERROR_CODES, codeOfRpc, rpcCode, type ErrorCode } from '../src/errors.js';
import { METHODS, type Method } from '../src/messages.js';

/** The wire as canonical JSON: the agent's unit tests and the runner's read the same files. */
const fixture = <T>(name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures', name), 'utf8')) as T;

const requests =
  fixture<Record<string, { method: Method; input?: unknown; params: object }>>('requests.json');
const results = fixture<Record<string, { method: Method; result: object }>>('results.json');
const errors =
  fixture<Record<string, { code: number; message: string; data: { code: ErrorCode } }>>(
    'errors.json',
  );

const paramsOf = (m: Method) => METHODS[m].params as z.ZodType;
const resultOf = (m: Method) => METHODS[m].result as z.ZodType;

describe('the canonical requests', () => {
  it.each(Object.entries(requests))('%s is what the host sends', (_, r) => {
    expect(paramsOf(r.method).parse(r.input ?? r.params)).toEqual(r.params);
  });

  it('name every method', () => {
    const named = new Set(Object.values(requests).map((r) => r.method));
    expect(Object.keys(METHODS).filter((m) => !named.has(m as Method))).toEqual([]);
  });

  it('show every default the schemas give', () => {
    const shown = Object.values(requests).filter((r) => r.input !== undefined);
    expect(new Set(shown.map((r) => r.method))).toEqual(
      new Set(['tree.get', 'act', 'text.set', 'screenshot', 'audit', 'wait', 'a11y.read']),
    );
  });
});

describe('the canonical results', () => {
  it.each(Object.entries(results))('%s is what the host takes', (_, r) => {
    expect(resultOf(r.method).parse(r.result)).toEqual(r.result);
  });

  it('name every method', () => {
    const named = new Set(Object.values(results).map((r) => r.method));
    expect(Object.keys(METHODS).filter((m) => !named.has(m as Method))).toEqual([]);
  });
});

describe('the canonical errors', () => {
  it.each(Object.entries(errors))('%s has its code and number', (_, e) => {
    expect(ERROR_CODES).toContain(e.data.code);
    expect(rpcCode(e.data.code)).toBe(e.code);
    expect(codeOfRpc(e.code)).toBe(e.data.code);
  });
});
