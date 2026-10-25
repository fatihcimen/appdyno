import type { z } from 'zod';

/** A refusal the agent can act on (shown as the tool's error text, never a stack). */
export class ToolError extends Error {}

export type Block =
  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export interface Tool {
  title: string;
  description: string;
  input: z.ZodObject;
  annotations: ToolAnnotations;
  handler: (args: Record<string, unknown>) => Promise<Block[]>;
}

export const text = (t: string): Block[] => [{ type: 'text', text: t }];

/** Reads the device, changes nothing. */
export const READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
/** Acts on the device's screen (a tap may do anything the app does, but it never leaves the device). */
export const ACT: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
/** Changes device state beyond the screen (app data, apps, settings). */
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};
