import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { deviceStateFile, pause, readState, reportProgress, writeState } from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { HandOffOut } from '../schemas.js';
import { ACT, defineOp, reply } from '../tool.js';
import { liveMirror } from '../mirror-state.js';

const POLL_MS = 250;
const PROGRESS_MS = 5_000;
const DEFAULT_S = 300;
const MAX_S = 3_600;

const Request = z.object({ id: z.string(), reason: z.string() });
const Done = z.object({ id: z.string() });

const requestFile = (serial: string) => deviceStateFile('handoff', serial);
const doneFile = (serial: string) => `${requestFile(serial)}.done`;

/** What a mirror's parent shows: the request on this device, if one is open. */
export const handoffRequest = (serial: string) => readState(requestFile(serial), Request);

/** A person said they are done, by the window. */
export const handoffDone = (serial: string, id: string) => writeState(doneFile(serial), { id });

export function handoffOps(ctx: ServerContext) {
  return [
    defineOp({
      name: 'hand_off',
      title: 'Ask a person',
      description:
        'Asks your person to do what you cannot (Face ID, a passcode, a permission) and waits until they say done or, with no window, the screen changes. On this Mac: a banner and a sound in a window; with none, a sound and a macOS notification of reason, unless the server runs --silent.',
      input: z
        .object({
          reason: z.string().min(1).max(500),
          timeoutS: z.number().int().min(1).max(MAX_S).default(DEFAULT_S),
        })
        .strict(),
      output: HandOffOut,
      annotations: ACT,
      run: async ({ reason, timeoutS }) => {
        const serial = await ctx.defaultSerial();
        const id = randomBytes(4).toString('hex');
        rmSync(doneFile(serial), { force: true });
        writeState(requestFile(serial), { id, reason });
        const window = liveMirror(serial) !== undefined;
        // with a window, its parent shows the banner and sounds it; with none, a sound and a notification
        if (!window) ctx.alertPerson?.(reason);
        const before = window ? undefined : await screenSign(ctx);
        const started = Date.now();
        const end = started + timeoutS * 1000;
        let saidAt = started;
        try {
          while (Date.now() < end) {
            if (readState(doneFile(serial), Done)?.id === id) {
              const t = `a person said done after ${Math.round((Date.now() - started) / 1000)} s`;
              return reply(t, { done: t, by: 'person', waitedMs: Date.now() - started });
            }
            if (before !== undefined && (await screenSign(ctx)) !== before) {
              const t = `the screen changed after ${Math.round((Date.now() - started) / 1000)} s`;
              return reply(t, { done: t, by: 'screen', waitedMs: Date.now() - started });
            }
            if (Date.now() - saidAt >= PROGRESS_MS) {
              saidAt = Date.now();
              reportProgress(`waiting for a person: ${reason}`);
            }
            await pause(POLL_MS);
          }
          const t = `no answer in ${timeoutS} s: ${reason}`;
          return reply(t, { done: t, by: 'timeout', waitedMs: Date.now() - started });
        } finally {
          rmSync(requestFile(serial), { force: true });
          rmSync(doneFile(serial), { force: true });
        }
      },
    }),
  ];
}

/** What tells a change on the screen, from a device with a tree; none where there is no way to read one. */
async function screenSign(ctx: ServerContext): Promise<string | undefined> {
  try {
    return (await (await ctx.session()).device.tree()).hash;
  } catch {
    return undefined;
  }
}
