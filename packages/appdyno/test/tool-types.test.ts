import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toolsInterface, typeOf } from '../scripts/tool-types.mjs';

describe('the published types of the tools', () => {
  it('writes a schema as a type, and unknown for what it does not say', () => {
    expect(typeOf({ type: 'string' })).toBe('string');
    expect(typeOf({ type: 'integer' })).toBe('number');
    expect(typeOf({ enum: ['a', 'b'] })).toBe('"a" | "b"');
    expect(typeOf({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe('string | null');
    expect(typeOf({ type: 'array', items: { type: 'number' } })).toBe('(number)[]');
    expect(typeOf({ $ref: '#/x' })).toBe('unknown');
    expect(
      typeOf({
        type: 'object',
        properties: { a: { type: 'string' }, 'b-c': { type: 'number' } },
        required: ['a'],
      }),
    ).toBe('{ a: string; "b-c"?: number }');
    expect(typeOf({ type: 'object', additionalProperties: { type: 'number' } })).toBe(
      'Record<string, number>',
    );
  });

  it('takes arguments as a caller writes them: what has a default may be left out', () => {
    const text = toolsInterface([
      {
        name: 'tap',
        input: z.object({ x: z.number(), read: z.string().default('diff') }).strict(),
        output: z.object({ ok: z.boolean() }).strict(),
      },
    ]);
    expect(text).toContain('tap: { args: { x: number; read?: string }; data: { ok: boolean } };');
  });
});
