import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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

/** The recording that takes what happens on `serial` now. */
export const activeRecording = (ctx: ServerContext, serial: string | undefined) => {
  const r = serial === undefined ? undefined : loadRecording(ctx, serial);
  return r?.state.running ? r : undefined;
};

export const startRecording = (
  ctx: ServerContext,
  serial: string,
  app: string | undefined,
  owner: Owner | undefined,
) =>
  keepRecording(
    new Recording(
      { serial, running: true, steps: [], known: [], ...(app && { app }), owner },
      ctx.policy.secrets,
    ),
  );

export const addSteps = (r: Recording, step: FlowStep | FlowStep[] | undefined) => {
  const steps = [step ?? []].flat();
  for (const st of steps) r.add(st);
  if (steps.length) keepRecording(r);
};

/** What a person should look at in a flow, by step. */
export const flagged = (flow: Flow) =>
  flow.steps.flatMap((st, i) => {
    const why = [
      ...st.flags,
      ...(st.action === 'unrecorded' ? [`not recorded: ${String(st.args.what)}`] : []),
    ];
    return why.length > 0 ? [`step ${i + 1}: ${why.join(', ')}`] : [];
  });

/** A recording as its file: what is there stays unless `overwrite`. */
export function saveRecording(r: Recording, path: string, overwrite: boolean | undefined) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, r.text(), { flag: overwrite ? 'w' : 'wx' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST')
      throw new ToolError(`${path} exists: overwrite true replaces it`, 'INVALID_ARGUMENT');
    throw new ToolError(`cannot write ${path}: ${(e as Error).message}`, 'INVALID_ARGUMENT');
  }
  return flagged(r.flow());
}

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
  if (!file.endsWith('.flow'))
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
