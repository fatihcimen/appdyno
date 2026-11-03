import type { Capability } from '@appdyno/core';
import type { ErrorCode } from '@appdyno/protocol';
import type { z } from 'zod';

/** A refusal the agent can act on (shown as the tool's error text, never a stack). */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode = 'INVALID_ARGUMENT',
    readonly hint?: string,
  ) {
    super(message);
  }
}

export type Block =
  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

/** What differs from MCP's defaults, which are: not read-only, destructive, not idempotent, open world. */
export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
};

/** What a tool answers: the text (and images) for the model, a summary matching its output schema. */
export type ToolResult = { blocks: Block[]; data: Record<string, unknown> };

export interface Tool {
  title: string;
  description: string;
  input: z.ZodObject;
  output: z.ZodObject;
  annotations: ToolAnnotations;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/** One operation: a tool on the MCP surface and a command on the CLI. */
export type Op = Tool & {
  name: string;
  /** The measure it cannot do without. */
  needs?: Capability;
};

export function defineOp<S extends z.ZodObject>(def: {
  name: string;
  title: string;
  description: string;
  input: S;
  output: z.ZodObject;
  annotations: ToolAnnotations;
  needs?: Capability;
  run: (args: z.infer<S>) => Promise<ToolResult>;
}): Op {
  const { run, ...rest } = def;
  return { ...rest, handler: run as Tool['handler'] };
}

export const text = (t: string): Block[] => [{ type: 'text', text: t }];

export const reply = (
  t: string,
  data: Record<string, unknown>,
  extra: Block[] = [],
): ToolResult => ({
  blocks: [{ type: 'text', text: t }, ...extra],
  data,
});

/** Reads the device, changes nothing. */
export const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
/** Acts on the device's screen (a tap may do anything the app does, but it never leaves the device). */
export const ACT: ToolAnnotations = { destructiveHint: false, openWorldHint: false };
/** Changes device state beyond the screen (app data, apps, settings). */
export const DESTRUCTIVE: ToolAnnotations = { openWorldHint: false };
