import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { deviceStateFile } from '@appdyno/core';
import type { ServerContext } from './context.js';
import { redactLog } from './policy.js';
import { shownArgs } from './report.js';
import type { Op, ToolResult } from './tool.js';

/** One call, for a person watching: no socket, across processes. */
export type ActivityLine = { at: number; tool: string; ms: number; ok: boolean; args: unknown };

/** A session of hours stays small: past this the older half goes. */
const MAX_BYTES = 256 * 1024;
/** Calls that are not an agent acting on the device. */
const NOT_ACTIVITY = new Set(['mirror', 'hand_off', 'list_devices']);

const fileOf = (serial: string) => deviceStateFile('activity', serial).replace(/\.json$/, '.jsonl');

export function appendActivity(serial: string, line: ActivityLine) {
  const file = fileOf(serial);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
  const { size } = statSync(file);
  if (size <= MAX_BYTES) return;
  const text = readFileSync(file, 'utf8');
  writeFileSync(file, text.slice(text.indexOf('\n', text.length / 2) + 1), { mode: 0o600 });
}

/** Each op's calls go in the file of the device they acted on; typed text by its length, secrets hidden. */
export function activityFor(ctx: ServerContext) {
  const clean = (s: string) => redactLog(ctx.policy, s);
  return (op: Op): Op =>
    NOT_ACTIVITY.has(op.name)
      ? op
      : {
          ...op,
          handler: async (args): Promise<ToolResult> => {
            const at = Date.now();
            const note = (ok: boolean) => {
              const serial = ctx.currentSerial;
              if (serial)
                appendActivity(serial, {
                  at,
                  tool: op.name,
                  ms: Date.now() - at,
                  ok,
                  args: shownArgs(op, args, clean),
                });
            };
            try {
              const out = await op.handler(args);
              note(true);
              return out;
            } catch (e) {
              note(false);
              throw e;
            }
          },
        };
}

/** The lines added since it began, for as long as it is called: a file that shrank starts over. */
export function activityFollower(serial: string) {
  const file = fileOf(serial);
  const sizeOf = () => {
    try {
      return statSync(file).size;
    } catch {
      return 0;
    }
  };
  let at = sizeOf();
  let partial = '';
  return (): ActivityLine[] => {
    const size = sizeOf();
    if (size < at) at = 0;
    if (size === at) return [];
    const fd = openSync(file, 'r');
    const chunk = Buffer.alloc(size - at);
    readSync(fd, chunk, 0, chunk.length, at);
    closeSync(fd);
    at = size;
    const lines = (partial + chunk.toString('utf8')).split('\n');
    partial = lines.pop() ?? '';
    return lines.flatMap((l) => {
      try {
        return [JSON.parse(l) as ActivityLine];
      } catch {
        return [];
      }
    });
  };
}
