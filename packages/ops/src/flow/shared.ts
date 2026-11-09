import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { deviceState, Owner, stateDir } from '@appdyno/core';
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
    // a stop of an app just stopped changes nothing, as a launch that starts it writes one after terminate_app's
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
          ? 'running: the app was running, and a replay goes on from the screen it is on then; stop before it starts it anew'
          : f,
      ),
      ...(st.action === 'unrecorded' ? [`not recorded: ${String(st.args.what)}`] : []),
    ];
    return why.length > 0 ? [`step ${i + 1}: ${why.join(', ')}`] : [];
  });

/** A file and its folders: what is there stays unless `overwrite`. */
function writeNew(path: string, text: string, overwrite: boolean | undefined) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, { flag: overwrite ? 'w' : 'wx' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST')
      throw new ToolError(`${path} exists: overwrite true replaces it`, 'INVALID_ARGUMENT');
    throw new ToolError(`cannot write ${path}: ${(e as Error).message}`, 'INVALID_ARGUMENT');
  }
  return path;
}

/** A recording as its file: what is there stays unless `overwrite`. */
export function saveRecording(r: Recording, path: string, overwrite: boolean | undefined) {
  writeNew(path, r.text(), overwrite);
  return flagged(r.flow());
}

/** What exists of a path, a link at its end included: what lies past it has no link in it. */
const nearest = (p: string): string => {
  try {
    lstatSync(p);
    return p;
  } catch {
    return dirname(p) === p ? p : nearest(dirname(p));
  }
};

const real = (p: string) => {
  const at = nearest(p);
  try {
    return join(realpathSync(at), relative(at, p));
  } catch {
    return undefined;
  }
};

/**
 * The path of a file a client asked to have written, inside this server's project folder (where it runs) or its state
 * folder, and no other: the client names the path, and the server's own command line sets those two. A link that leads
 * out is out.
 */
export function inside(path: string) {
  const to = resolve(path);
  const roots = [process.cwd(), stateDir()];
  const under = (p: string | undefined, root: string | undefined) => {
    const r = p !== undefined && root !== undefined ? relative(root, p) : '';
    return r !== '' && !r.startsWith('..') && !isAbsolute(r);
  };
  if (!roots.some((root) => under(to, root) && under(real(to), real(root))))
    throw new ToolError(
      `${to} is outside the folders this server writes to`,
      'POLICY_DENIED',
      `give a path inside ${roots.join(' or ')}`,
    );
  return to;
}

export const writeInside = (path: string, text: string, overwrite: boolean | undefined) =>
  writeNew(inside(path), text, overwrite);

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
