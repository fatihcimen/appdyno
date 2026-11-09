import { inOp, noting } from '@appdyno/core';
import { DeviceError, type ErrorCode } from '@appdyno/protocol';
import { z } from 'zod';

/** A refusal the agent can act on (shown as the tool's error text, never a stack). */
/** Whether a failed action's touch went out: `unknown` is a device that stopped answering, and the screen will say. */
export type Dispatched = boolean | 'unknown';

export class ToolError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly hint?: string,
    public dispatched?: Dispatched,
  ) {
    super(message);
  }
}

/** A device that stopped answering may have made the touch before it did. Any other refusal comes before it. */
const MAY_HAVE_GONE: ReadonlySet<ErrorCode> = new Set([
  'TIMEOUT',
  'CANCELLED',
  'DEVICE_GONE',
  'AGENT_UNAVAILABLE',
  'INTERNAL',
]);

const WORDS = {
  yes: 'the touch was sent',
  no: 'no touch was sent',
  unknown: 'the touch may have been sent: read the screen before trying again',
};

/** A failure of an action as a refusal that says whether its touch went out. */
export function refusedAction(err: unknown): never {
  try {
    refused(err);
  } catch (e) {
    if (e instanceof ToolError && e.dispatched === undefined)
      e.dispatched =
        MAY_HAVE_GONE.has(e.code) || (err instanceof DeviceError && err.sent) ? 'unknown' : false;
    // a call that was wrong is said to be: it touched nothing, as `dispatched` has it
    if (
      e instanceof ToolError &&
      e.code !== 'INVALID_ARGUMENT' &&
      !/touch (was|may)/.test(e.message)
    )
      e.message += ` (${WORDS[e.dispatched === 'unknown' ? 'unknown' : e.dispatched ? 'yes' : 'no']})`;
    throw e;
  }
}

const NO_FOCUS = 'no editable field has the focus';
const NO_FOCUS_HINT = 'tap the field first (or give type_text a ref)';
const CONNECTION = 'the device is not connected or its agent stopped; try once more';
/** What to do, where the driver has nothing better to say (a build's log tail, which process holds the port). */
const HINTS: Partial<Record<ErrorCode, string>> = {
  TIMEOUT: 'the device did not answer; read the screen and try again',
  DEVICE_GONE: CONNECTION,
  AGENT_UNAVAILABLE: CONNECTION,
};

/** A device failure as the agent's error: what failed and what to do, each said once, by `refusalText`. */
export function refused(err: unknown): never {
  if (!(err instanceof DeviceError)) throw err;
  if (err.code === 'NO_FOCUS') throw new ToolError(NO_FOCUS, err.code, NO_FOCUS_HINT);
  throw new ToolError(err.message, err.code, err.hint ?? HINTS[err.code]);
}

/** A refusal in words, whole for a client that reads only them: its code first, its hint last. */
export const refusalText = ({ code, message, hint }: ToolError) =>
  `${code}: ${message}${hint && !message.endsWith(hint) ? `\nhint: ${hint}` : ''}`;

export type Block =
  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

/** What differs from MCP's defaults, which are: not read-only, destructive, not idempotent, open world. */
export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
};

/** What a tool answers: the text (and images), and a summary matching its output schema. */
export type ToolResult<D = Record<string, unknown>> = { blocks: Block[]; data: D };

export type Tool = {
  title: string;
  description: string;
  input: z.ZodObject;
  output: z.ZodObject;
  annotations: ToolAnnotations;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
};

/** One operation: a tool on the MCP surface and a command on the CLI. */
export type Op = Tool & { name: string };

/**
 * An op, whose device failures reach the surfaces as refusals wherever in its `run` they came from, and whose answer
 * says what its call did on the way, as a fetch that made it take longer.
 */
export function defineOp<
  const N extends string,
  S extends z.ZodObject,
  O extends z.ZodObject,
>(def: {
  name: N;
  title: string;
  description: string;
  input: S;
  output: O;
  annotations: ToolAnnotations;
  run: (args: z.infer<S>) => Promise<ToolResult<z.infer<O>>>;
}): Omit<Op, 'name' | 'output'> & { name: N; output: O } {
  const { run, ...rest } = def;
  return {
    ...rest,
    handler: async (args) => {
      try {
        const { value, notes } = await noting(() => inOp(() => run(args as z.infer<S>)));
        return notes.length
          ? { ...value, blocks: [...value.blocks, ...text(notes.join('\n'))] }
          : value;
      } catch (e) {
        return refused(e);
      }
    },
  };
}

const SERVER_CHECKS = new Set([
  'maxLength',
  'minLength',
  'maxItems',
  'minItems',
  'pattern',
  'minimum',
  'maximum',
]);

const withoutChecks = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(withoutChecks);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(
    Object.entries(v)
      // an object under such a name is an argument called that
      .filter(([k, x]) => !SERVER_CHECKS.has(k) || typeof x === 'object')
      .map(([k, x]) => [k, withoutChecks(x)]),
  );
};

/**
 * An op's arguments as a client's catalog holds them: what has a default is optional. A limit or a pattern is
 * the server's to refuse and no client's to know: left out, as a catalog is read on every session.
 */
export function inputSchemaOf(op: Pick<Tool, 'input'>) {
  const { $schema: _, ...schema } = z.toJSONSchema(op.input, { io: 'input', target: 'draft-7' });
  return withoutChecks(schema) as { type: 'object'; [k: string]: unknown };
}

/** What a transport holds a call to: nothing, as `argumentsFor` does it, with a code and a hint. */
export const ANY_ARGUMENTS = z.looseObject({});

/** What to do about arguments refused: a number past its limit is told the limit, as a client's catalog has none. */
export const argumentsHint = (issues: z.core.$ZodIssue[], flag = '') =>
  [
    ...issues.flatMap((x) =>
      x.code === 'too_big' && x.origin === 'number'
        ? [`${flag}${x.path.join('.')} is at most ${String(x.maximum)}`]
        : [],
    ),
    'change that and call again: nothing was done',
  ].join(': ');

/** A call's arguments as its op takes them, or a refusal naming each one wrong; `flag`: how the caller writes a name. */
export function argumentsFor(op: Pick<Tool, 'input'>, args: unknown, flag = '') {
  const checked = op.input.safeParse(args);
  if (checked.success) return checked.data;
  throw new ToolError(
    checked.error.issues
      .map((x) => `${x.path.length ? `${flag}${x.path.join('.')}: ` : ''}${x.message}`)
      .join('; '),
    'INVALID_ARGUMENT',
    argumentsHint(checked.error.issues, flag),
    false,
  );
}

export const text = (t: string): Block[] => [{ type: 'text', text: t }];

/** The words of an answer: its text blocks, in order. */
export const textOf = (blocks: Block[]) =>
  blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');

export const reply = <D>(t: string, data: D, extra: Block[] = []): ToolResult<D> => ({
  blocks: [{ type: 'text', text: t }, ...extra],
  data,
});

/** Reads the device, changes nothing. */
export const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
/** Acts on the device's screen (a tap may do anything the app does, but it never leaves the device). */
export const ACT: ToolAnnotations = { destructiveHint: false, openWorldHint: false };
/** Changes device state beyond the screen (app data, apps, settings). */
export const DESTRUCTIVE: ToolAnnotations = { openWorldHint: false };
