import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseEnv } from 'node:util';
import { deviceStateFile } from '@appdyno/core';
import {
  Recording,
  type RecordingState,
  type Flow,
  composeFlow,
  parseFlow,
  FlowError,
} from '@appdyno/flows';
import type { ServerContext } from '../context.js';
import { ToolError } from '../tool.js';

export const FLOW_FILE = /\.flow$/;

const recordingFile = (serial: string) => deviceStateFile('recordings', serial);

export function loadRecording(ctx: ServerContext, serial: string): Recording | undefined {
  try {
    const state = JSON.parse(readFileSync(recordingFile(serial), 'utf8')) as RecordingState;
    return new Recording(state, ctx.policy.secrets);
  } catch {
    return undefined;
  }
}

/** A file per device, so that the commands of a recording may be separate processes; no secret is in it. */
export function keepRecording(r: Recording) {
  const file = recordingFile(r.state.serial);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(r.state), { mode: 0o600 });
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
