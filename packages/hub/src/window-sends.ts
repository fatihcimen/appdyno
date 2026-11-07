import { deviceState, inCall, type Device, type ViewerMessage } from '@appdyno/core';
import { argumentsFor, opsFor, ToolError, type Op, type ServerContext } from '@appdyno/ops';
import { z } from 'zod';
import type { WindowSession } from './controls.js';
import { spokenDone } from './follow.js';
import { WINDOW, windowContext } from './measures.js';

/** A device's links a person opened, newest first. */
const RECENT = 8;
const recentLinks = deviceState('links', z.array(z.string()));

/** What an op answered, as a pane shows it: what it did, or why not and what to do, as a command line prints it. */
type Answer = { ok: boolean; text: string; hint?: string };

/**
 * What a window sends to its device by the op an agent calls, with the same arguments: a link. Each line of progress goes
 * back as it comes, then what the op did, or its refusal with its hint.
 */
export function windowSends(
  ctx: ServerContext,
  device: Device,
  session: () => Pick<WindowSession, 'tell'>,
) {
  const { serial } = device;
  let ops: Record<string, Op> | undefined;
  const tell = (name: string, m: Record<string, unknown>) =>
    session().tell({ op: 'answer', name, ...m });
  const recent = () => recentLinks.read(serial) ?? [];

  const call = async (name: string, op: string, args: Record<string, unknown>): Promise<Answer> => {
    // the first call opens a session, which starts the device agent, as an agent's first call does
    const tool = (ops ??= opsFor(windowContext(ctx, device)))[op]!;
    try {
      const progress = (line: string) => tell(name, { line: spokenDone(line) });
      const { data } = await inCall({ client: WINDOW, progress }, () =>
        tool.handler(argumentsFor(tool, args)),
      );
      return { ok: true, text: spokenDone(String(data.done)) ?? op };
    } catch (e) {
      const { message } = e as Error;
      const hint = e instanceof ToolError ? e.hint : undefined;
      return { ok: false, text: message, ...(hint && !message.includes(hint) && { hint }) };
    }
  };

  const openLink = async (url: string) => {
    const answer = await call('openLink', 'open_link', { url });
    if (answer.ok)
      recentLinks.write(serial, [url, ...recent().filter((u) => u !== url)].slice(0, RECENT));
    tell('openLink', { ...answer, recent: recent() });
  };

  return {
    /** What is a send of what the window says; false: it is another's. */
    onWindow(m: ViewerMessage): boolean {
      if (m.op !== 'control') return false;
      if (m.name === 'links') tell('openLink', { recent: recent() });
      else if (m.name === 'openLink')
        void openLink(String(m.url ?? '').trim()).catch((e: Error) =>
          tell('openLink', { ok: false, text: e.message }),
        );
      else return false;
      return true;
    },
  };
}
