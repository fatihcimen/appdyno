import { z } from 'zod';
import {
  argumentsFor,
  onlyReads,
  type Op,
  type Part,
  type ToolAnnotations,
  type ToolResult,
} from './tool.js';

/**
 * Which part runs a call, and the call's arguments as that part takes them; `names`: an argument of the part that the
 * tool calls otherwise, so that a refusal names what the caller wrote.
 */
export type Picked<P> = readonly [
  part: P,
  args: Record<string, unknown>,
  names?: Record<string, string>,
];

/** A field's default, where its schema states one. */
const defaultOf = (field: unknown): unknown =>
  field instanceof z.ZodDefault ? field.def.defaultValue : undefined;

/**
 * A call's arguments for the part that runs it: what was not given is left out, and so is a default of the tool that
 * the part has no such argument for. Anything else the part does not take stays, for its own schema to refuse.
 */
const forPart = (input: z.ZodObject, part: Pick<Part, 'input'>, args: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(args).filter(
      ([k, v]) => v !== undefined && (k in part.input.shape || v !== defaultOf(input.shape[k])),
    ),
  );

/**
 * One tool made of several parts: each call is run by the part `pick` names, held to that part's own schema, so that an
 * argument of another part is refused as the part itself would refuse it. A call reads only where its part does.
 */
export function mergeOp<
  const N extends string,
  S extends z.ZodObject,
  const P extends readonly [Part, Part, ...Part[]],
>(def: {
  name: N;
  title: string;
  description: string;
  input: S;
  annotations: ToolAnnotations;
  parts: P;
  step?: Op['step'];
  pick: (args: z.infer<S>) => Picked<P[number]>;
}): Omit<Op, 'name' | 'output'> & {
  name: N;
  output: z.ZodUnion<{ [K in keyof P]: P[K]['output'] }>;
} {
  const { parts, pick, ...rest } = def;
  const picked = (args: Record<string, unknown>) => {
    const [part, a, names] = pick(args as z.infer<S>);
    return [part, argumentsFor(part, forPart(def.input, part, a), '', names)] as const;
  };
  return {
    ...rest,
    output: z.union(parts.map((p) => p.output)) as never,
    readsOnly: (args) => {
      try {
        const [part, a] = picked(args);
        return onlyReads(part) || part.readsOnly?.(a) === true;
      } catch {
        // a call its part refuses does nothing: the refusal is the handler's to give
        return true;
      }
    },
    handler: async (args): Promise<ToolResult> => {
      const [part, a] = picked(args);
      return part.handler(a);
    },
  };
}
