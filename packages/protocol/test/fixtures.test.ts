import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ERROR_CODES, codeOfRpc, rpcCode, type ErrorCode } from '../src/errors.js';
import { METHODS, NOTIFICATIONS, type Method, type Notification } from '../src/messages.js';

/** The wire as canonical JSON: the agent's unit tests and the runner's read the same files. */
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures', name), 'utf8'));

const requests = fixture('requests.json') as Record<
  string,
  { method: Method; input?: unknown; params: object }
>;
const results = fixture('results.json') as Record<string, { method: Method; result: object }>;
const notifications = fixture('notifications.json') as Record<
  string,
  { method: Notification; params: object }
>;
const errors = fixture('errors.json') as Record<
  string,
  { code: number; message: string; data: { code: ErrorCode } }
>;

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
      new Set([
        'tree.get',
        'act',
        'text.set',
        'text.keys',
        'screenshot',
        'audit',
        'wait',
        'a11y.read',
        'stream.start',
      ]),
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

describe('the canonical notifications', () => {
  it.each(Object.entries(notifications))('%s is what a viewer takes', (_, n) => {
    expect(NOTIFICATIONS[n.method].parse(n.params)).toEqual(n.params);
  });

  it('name every notification', () => {
    const named = new Set(Object.values(notifications).map((n) => n.method));
    expect(Object.keys(NOTIFICATIONS).filter((m) => !named.has(m as Notification))).toEqual([]);
  });
});

describe('the canonical errors', () => {
  it.each(Object.entries(errors))('%s has its code and number', (_, e) => {
    expect(ERROR_CODES).toContain(e.data.code);
    expect(rpcCode(e.data.code)).toBe(e.code);
    expect(codeOfRpc(e.code)).toBe(e.data.code);
  });
});
