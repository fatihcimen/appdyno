import {
  deviceState,
  inCall,
  must,
  PUSH_TOKEN_KINDS,
  type Device,
  type ViewerMessage,
} from '@appdyno/core';
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
import { PERSON_HINTS, WINDOW, windowContext } from './measures.js';
import { conditionSends } from './window-conditions.js';

/** A device's links a person opened, newest first. */
const RECENT = 8;
const recentLinks = deviceState('links', z.array(z.string()));

/** What an op answered, as a pane shows it: what it did, or why not and what a person can do about it. */
type Answer = { ok: boolean; text: string; hint?: string };

/**
 * What a window sends to its device by the ops an agent calls, with the same arguments: a link, a push and the device's
 * conditions. Each line of progress goes back as it comes, then what the op did, or its refusal with what a person can
 * do. A push token goes by no op.
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
  /** A field the pane sent, as text: the window sends each as a string, and what is none is empty. */
  const field = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  // the first call opens a session, which starts the device agent, as an agent's first call does
  const context = () => (own ??= windowContext(ctx, device));

  /**
   * One op's call, by the pane it answers: its answer, and what it said whole where it said it. `app`, where given, is
   * the session's, as an agent's `use_device` sets it, through the same policy: an iPhone opens a link only in one.
   */
  const call = async (name: string, op: string, args: Record<string, unknown>, app?: string) => {
    const tool = must((ops ??= opsFor(context()))[op], `the op ${op}`);
    try {
      if (app !== undefined)
        (await context().session()).appId = app ? checkApp(ctx.policy, app) : undefined;
      const progress = (line: string) => tell(name, { line: spokenDone(line) });
      const { data } = await inCall({ client: WINDOW, progress }, () =>
        tool.handler(argumentsFor(tool, args)),
      );
      const answer: Answer = { ok: true, text: spokenDone(String(data.done)) ?? op };
      return { answer, data };
    } catch (e) {
      const { message } = e as Error;
      // what to do is the person's here: said in their words, or not at all
      const hint = e instanceof ToolError && e.hint ? PERSON_HINTS.get(e.hint) : undefined;
      const answer: Answer = { ok: false, text: message, ...(hint && { hint }) };
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

  /**
   * What this device takes, by the op with no type, for the app the pane names, else the one in front where it is a
   * person's own, as an app's build may take another route; and that app in front, which the pane starts from.
   */
  const pushes = async (named: string) => {
    const front = await ownFront();
    const app = named || front.app;
    const { answer, data } = await call('push', 'push', app ? { app } : {});
    tell('push', data ? { types: data.types, ...front } : answer);
  };

  /** What the pane filled in, as the op takes it: the op refuses what does not fit. */
  const push = async (args: unknown) => {
    const given = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    tell('push', (await call('push', 'push', given)).answer);
  };

  /**
   * A token a person typed for the app in the pane, which the device keeps for this session for its pushes by APNs or
   * FCM. No op takes it, so no call, Activity or log of one sees it, and nothing here says it back.
   */
  const pushToken = (m: ViewerMessage) =>
    new Promise<void>((resolve) => {
      const app = field(m.app);
      const kind = PUSH_TOKEN_KINDS.find((k) => k === m.kind);
      if (!app) throw new ToolError('give the app the token is for', 'INVALID_ARGUMENT');
      checkApp(ctx.policy, app);
      if (!kind) throw new ToolError(`kind: ${PUSH_TOKEN_KINDS.join(', ')}`, 'INVALID_ARGUMENT');
      if (!device.events.pushToken)
        throw new ToolError('this device takes no token a person types', 'UNSUPPORTED');
      device.events.pushToken(app, field(m.token), kind);
      tell('push', { ok: true, text: `Kept ${app}'s ${kind} token for this session only` });
      resolve();
    });

  const sends: Record<string, (m: ViewerMessage) => Promise<void>> = {
    links: async (m) => {
      const front = await ownFront();
      // the app the pane names, else the one in front: what it opens, as `open_link` lists it
      const app = field(m.app) || front.app;
      const listed = app ? await call('openLink', 'open_link', { links: app }) : undefined;
      tell('openLink', {
        recent: recent(),
        ...front,
        ...(listed && { suggested: listed.data?.links ?? [] }),
        // a device that cannot tell an app's links says why, where they would stand
        ...(listed && !listed.answer.ok && { linksWhy: listed.answer.text }),
      });
    },
    openLink: (m) => openLink(field(m.url), field(m.app)),
    pushes: (m) => pushes(field(m.app)),
    push: (m) => push(m.args),
    pushToken,
    ...conditionSends(device, () => context().session(), call, tell),
  };
  const answering = (name: string) =>
    name.startsWith('push') ? 'push' : name.startsWith('device') ? 'device' : 'openLink';

  return {
    /** One op's call by a pane, on the session these sends open: a second would be a second session on the device. */
    call,

    /** What is a send of what the window says; false: it is another's. */
    onWindow(m: ViewerMessage): boolean {
      if (m.op !== 'control') return false;
      const name = String(m.name);
      if (!sends[name]) return false;
      void sends[name](m).catch((e: unknown) =>
        tell(answering(name), { ok: false, text: e instanceof Error ? e.message : String(e) }),
      );
      return true;
    },

    /** The window closed: what it changed on the device goes back first, as a session's end puts it back. */
    end: async () =>
      (await own?.end().catch((e: unknown) => [e instanceof Error ? e.message : String(e)])) ?? [],
  };
}
