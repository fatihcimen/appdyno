import { deviceState, inCall, type Device, type ViewerMessage } from '@appdyno/core';
import {
  argumentsFor,
  checkApp,
  opsFor,
  ToolError,
  type Op,
  type ServerContext,
} from '@appdyno/ops';
import { z } from 'zod';
import { frontApp, type WindowSession } from './controls.js';
import { spokenDone } from './follow.js';
import { WINDOW, windowContext } from './measures.js';

/** A device's links a person opened, newest first. */
const RECENT = 8;
const recentLinks = deviceState('links', z.array(z.string()));

/** What an op answered, as a pane shows it: what it did, or why not and what to do, as a command line prints it. */
type Answer = { ok: boolean; text: string; hint?: string };

/**
 * What a window sends to its device by the ops an agent calls, with the same arguments: a link and a push. Each line of
 * progress goes back as it comes, then what the op did, or its refusal with its hint.
 */
export function windowSends(
  ctx: ServerContext,
  device: Device,
  session: () => Pick<WindowSession, 'tell'>,
) {
  const { serial } = device;
  let own: ServerContext | undefined;
  let ops: Record<string, Op> | undefined;
  const tell = (name: string, m: Record<string, unknown>) =>
    session().tell({ op: 'answer', name, ...m });
  const recent = () => recentLinks.read(serial) ?? [];

  /**
   * One op's call, by the pane it answers: its answer, and what it said whole where it said it. `app`, where given, is
   * the session's, as an agent's `use_device` sets it, through the same policy: an iPhone opens a link only in one.
   */
  const call = async (name: string, op: string, args: Record<string, unknown>, app?: string) => {
    // the first call opens a session, which starts the device agent, as an agent's first call does
    const tool = (ops ??= opsFor((own ??= windowContext(ctx, device))))[op]!;
    try {
      if (app !== undefined)
        (await own!.session()).appId = app ? checkApp(own!.policy, app) : undefined;
      const progress = (line: string) => tell(name, { line: spokenDone(line) });
      const { data } = await inCall({ client: WINDOW, progress }, () =>
        tool.handler(argumentsFor(tool, args)),
      );
      const answer: Answer = { ok: true, text: spokenDone(String(data.done)) ?? op };
      return { answer, data };
    } catch (e) {
      const { message } = e as Error;
      const hint = e instanceof ToolError ? e.hint : undefined;
      const answer: Answer = {
        ok: false,
        text: message,
        ...(hint && !message.includes(hint) && { hint }),
      };
      return { answer, data: undefined };
    }
  };

  /** The app in front, where it is a person's own: what a pane starts from. */
  const ownFront = async () => {
    const front = await frontApp(device).catch(() => undefined);
    return front?.mine ? { app: front.app } : {};
  };

  const openLink = async (url: string, app: string) => {
    const { answer } = await call('openLink', 'open_link', { url }, app);
    if (answer.ok)
      recentLinks.write(serial, [url, ...recent().filter((u) => u !== url)].slice(0, RECENT));
    tell('openLink', { ...answer, recent: recent() });
  };

  /** What this device takes, by the op with no type, and the app in front where it is a person's own. */
  const pushes = async () => {
    const [{ answer, data }, front] = await Promise.all([call('push', 'push', {}), ownFront()]);
    tell('push', data ? { types: data.types, ...front } : answer);
  };

  /** What the pane filled in, as the op takes it: the op refuses what does not fit. */
  const push = async (args: unknown) => {
    const given = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    tell('push', (await call('push', 'push', given)).answer);
  };

  const sends: Record<string, (m: ViewerMessage) => Promise<void>> = {
    links: async () => tell('openLink', { recent: recent(), ...(await ownFront()) }),
    openLink: (m) => openLink(String(m.url ?? '').trim(), String(m.app ?? '').trim()),
    pushes: () => pushes(),
    push: (m) => push(m.args),
  };
  const answering = (name: string) => (name.startsWith('push') ? 'push' : 'openLink');

  return {
    /** What is a send of what the window says; false: it is another's. */
    onWindow(m: ViewerMessage): boolean {
      if (m.op !== 'control') return false;
      const name = String(m.name);
      if (!sends[name]) return false;
      void sends[name](m).catch((e: Error) =>
        tell(answering(name), { ok: false, text: e.message }),
      );
      return true;
    },
  };
}
