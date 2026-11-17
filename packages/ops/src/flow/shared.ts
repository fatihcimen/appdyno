import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { deviceState, Owner } from '@appdyno/core';
import {
  Recording,
  type RecordingState,
  type Flow,
  type FlowStep,
  type SharedFiles,
  composeFlow,
  parseFlow,
  FlowError,
  SETUP_FILE,
  TEARDOWN_FILE,
} from '@appdyno/flows';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { ToolError } from '../tool.js';
import { writeNew } from '../writes.js';
import { preparedFlow, projectRoot } from './prepare.js';

export const FLOW_FILE = /\.flow$/;

const Kept: z.ZodType<RecordingState> = z.object({
  serial: z.string(),
  app: z.string().optional(),
  running: z.boolean(),
  steps: z.array(z.custom<FlowStep>()),
  known: z.array(
    z.object({
      name: z.string(),
      length: z.number(),
      salt: z.string(),
      digest: z.string(),
      param: z.boolean().optional(),
    }),
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

/** A new recording, kept once `named` has named what the agent asked: a refusal there starts none. */
export const startRecording = (
  ctx: ServerContext,
  serial: string,
  app: string | undefined,
  owner: Owner | undefined,
  named: (r: Recording) => void = () => undefined,
) => {
  const r = new Recording(
    { serial, running: true, steps: [], known: [], ...(app && { app }), owner },
    ctx.policy.secrets,
  );
  named(r);
  keepRecording(r);
};

export const addSteps = (r: Recording, step: FlowStep | FlowStep[] | undefined) => {
  const steps = [step ?? []].flat();
  const app = (st: FlowStep | undefined) => st?.args.app ?? r.state.app;
  for (const st of steps) {
    const last = r.state.steps.at(-1);
    // a stop of an app just stopped changes nothing, as a launch that starts it writes one after manage_app stop's
    if (st.action === 'stop' && last?.action === 'stop' && app(last) === app(st)) continue;
    r.add(st);
  }
  if (steps.length) keepRecording(r);
};

/** What a person should look at in a flow, by step. */
export const flagged = (flow: Flow) =>
  flow.steps.flatMap((st, i) => {
    const why = [
      ...st.flags.map((f) =>
        f === 'running'
          ? 'running: the app was already running, so a replay goes on from whatever screen it is on then; for a fresh start, record launch_app restart: true in its place'
          : f === 'review'
            ? 'review: the number is what the recording found on that screen, not what it should hold: set it'
            : f,
      ),
      ...(st.action === 'unrecorded' ? [`not recorded: ${String(st.args.what)}`] : []),
    ];
    return why.length > 0 ? [`step ${i + 1}: ${why.join(', ')}`] : [];
  });

/** A recording as its file: what is there stays unless `overwrite`. */
export function saveRecording(r: Recording, path: string, overwrite: boolean | undefined) {
  writeNew(path, r.text(), overwrite);
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
    const flow = parseFlow(text);
    // a preparation the project names as a flow is that flow run in its place, as `run` with its path would
    const steps = flow.steps.map((st): FlowStep => {
      const named = st.action === 'prepare' ? preparedFlow(st, file) : undefined;
      if (named && st.args.gives)
        throw new FlowError(
          `prepare ${String(st.args.name)} is a flow: it gives no value`,
          st.line,
        );
      return named ? { ...st, action: 'run', args: { file: named } } : st;
    });
    return { ...flow, steps };
  } catch (e) {
    if (e instanceof FlowError) throw new ToolError(`${file}: ${e.message}`, 'INVALID_ARGUMENT');
    throw e;
  }
};

/** A file no run starts from: a folder's shared setup or teardown, or any other a project keeps aside by that mark. */
export const isShared = (file: string) => basename(file).startsWith('_');

/**
 * The shared files that hold for a flow: `_setup.flow` and `_teardown.flow` of its own folder and of each above it,
 * up to its project's root. A shared file has none of its own.
 */
function sharedFiles(file: string): SharedFiles {
  if (isShared(file)) return { setup: [], teardown: [] };
  const own = dirname(resolve(file));
  const root = projectRoot(own);
  const folders = [own];
  while (folders[0] !== root && folders[0] !== undefined) folders.unshift(dirname(folders[0]));
  const there = (name: string) => folders.map((d) => join(d, name)).filter((f) => existsSync(f));
  return { setup: there(SETUP_FILE), teardown: there(TEARDOWN_FILE).reverse() };
}

/** A flow file with the flows it runs in place, and its setup and teardown: all a run, a test or an export is given. */
export const readFlow = (file: string): Flow => {
  try {
    return composeFlow(file, parsedFile, sharedFiles(file));
  } catch (e) {
    if (e instanceof FlowError) throw new ToolError(e.message, 'INVALID_ARGUMENT');
    throw e;
  }
};
