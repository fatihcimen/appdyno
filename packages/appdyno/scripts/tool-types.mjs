// The published types of every tool: read from their schemas at build time, so that none of it is kept by hand and
// a project that uses the library needs no zod.
import { z } from 'zod';

/** @param {string} name */
const property = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));

/**
 * A JSON schema as a TypeScript type. What it does not say is `unknown`, never a guess: so is a part in a form this
 * does not read, `true` or a tuple.
 * @param {import('zod').core.JSONSchema._JSONSchema | import('zod').core.JSONSchema._JSONSchema[]} [part]
 * @returns {string}
 */
export function typeOf(part = {}) {
  if (typeof part !== 'object' || Array.isArray(part)) return 'unknown';
  const s = part;
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ');
  const union = s.anyOf ?? s.oneOf;
  if (union) return union.map(typeOf).join(' | ');
  switch (s.type) {
    case 'string':
    case 'boolean':
    case 'null':
      return s.type;
    case 'number':
    case 'integer':
      return 'number';
    case 'array':
      return `(${typeOf(s.items)})[]`;
    case 'object': {
      const required = new Set(s.required ?? []);
      const fields = Object.entries(s.properties ?? {}).map(
        ([k, v]) => `${property(k)}${required.has(k) ? '' : '?'}: ${typeOf(v)}`,
      );
      if (fields.length > 0) return `{ ${fields.join('; ')} }`;
      return s.additionalProperties && s.additionalProperties !== true
        ? `Record<string, ${typeOf(s.additionalProperties)}>`
        : 'Record<string, unknown>';
    }
    default:
      return 'unknown';
  }
}

/**
 * What `Tools` holds in the source's place: each op's arguments as a caller writes them, and its data.
 * @param {{ name: string; input: import('zod').ZodType; output: import('zod').ZodType }[]} ops
 */
export function toolsInterface(ops) {
  const lines = ops.map((op) => {
    const args = z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'any' });
    const data = z.toJSONSchema(op.output, { unrepresentable: 'any' });
    return `  ${op.name}: { args: ${typeOf(args)}; data: ${typeOf(data)} };`;
  });
  return `export interface Tools {\n${lines.join('\n')}\n}`;
}
