import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { deviceState, Owner } from '@appdyno/core';
import {
  Recording,
  type RecordingState,
  type Flow,
  type FlowStep,
  composeFlow,
  parseFlow,
  FlowError,
} from '@appdyno/flows';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { ToolError } from '../tool.js';

export const FLOW_FILE = /\.flow$/;

const Kept: z.ZodType<RecordingState> = z.object({
  serial: z.string(),
  app: z.string().optional(),
  running: z.boolean(),
  steps: z.array(z.custom<FlowStep>()),
  known: z.array(
    z.object({ name: z.string(), length: z.number(), salt: z.string(), digest: z.string() }),
  ),
  owner: Owner.optional(),
});

/** A file per device, so that the commands of a recording may be separate processes; no secret is in it. */
export const flowRecordings = deviceState('recordings', Kept);

export function loadRecording(ctx: ServerContext, serial: string): Recording | undefined {
  const state = flowRecordings.read(serial);
  return state && new Recording(state, ctx.policy.secrets);
}

export const keepRecording = (r: Recording) => flowRecordings.write(r.state.serial, r.state);

export const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

const textOf = (file: string) => {
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    const why =
      (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'no such file' : (e as Error).message;
    throw new ToolError(`cannot read ${file}: ${why}`, 'NOT_FOUND');
  }
};

/** A file of `NAME=value` lines, as a flow's values. What it holds is never said back. */
export const envValues = (file: string) => parseEnv(textOf(file)) as Record<string, string>;

const parsedFile = (file: string): Flow => {
  if (!FLOW_FILE.test(file))
    throw new ToolError(`a flow's file ends in .flow: ${file}`, 'INVALID_ARGUMENT');
  const text = textOf(file);
  try {
    return parseFlow(text);
  } catch (e) {
    if (e instanceof FlowError) throw new ToolError(`${file}: ${e.message}`, 'INVALID_ARGUMENT');
    throw e;
  }
};

/** A flow file with the flows it runs in place: all a run, a test or an export is given. */
export const readFlow = (file: string): Flow => {
  try {
    return composeFlow(file, parsedFile);
  } catch (e) {
    if (e instanceof FlowError) throw new ToolError(e.message, 'INVALID_ARGUMENT');
    throw e;
  }
};
