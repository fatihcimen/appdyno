import {
  viewerBinary,
  ViewerProcess,
  type NewDevice,
  type ViewerLink,
  type ViewerMessage,
} from '@appdyno/core';
import { HubList } from './hub-list.js';
import { HubRoom } from './hub-room.js';
import { Parent } from './parent.js';
import { checkCreate, FOCUS_SIGNAL, type ServerContext, ToolError } from '@appdyno/ops';

export type HubRun = {
  /** A person asked for the keyboard. */
  focus: boolean;
  /** Kept off every screen, and what it opens with it. */
  behind?: boolean;
  appearance?: string;
  log: (line: string) => void;
  /** Makes its window, where a caller does; again if one dies. */
  viewer?: () => ViewerLink;
  /** What its AI Clients and Help ask of this Mac, from a package this one may not import. */
  services?: HubServices;
};

export type HubServices = {
  act(m: Record<string, unknown>, say: (said: Record<string, unknown>) => void): unknown;
  /** The hub is closing: what it started goes with it. */
  end(): Promise<void>;
};

/** What a stage's session listens with. */
type Stage = { message: (m: ViewerMessage) => void; exit: (tail: string) => void };

const POLL_MS = 2_000;
/** A window that keeps dying is not brought back for ever. */
const MAX_DEATHS = 3;
const DEATHS_MS = 60_000;

/** The driver a virtual device belongs to. */
async function ownerOf(ctx: ServerContext, id: string) {
  for (const { virtual } of ctx.providers) {
    if (!virtual) continue;
    const found = await virtual.startable().catch(() => []);
    if (found.some((d) => d.id === id)) return virtual;
  }
  throw new ToolError(`no such device: ${id}`, 'NOT_FOUND');
}

/** The stage of one device in the hub's window, as a session sees a viewer. */
export function stageLink(
  link: () => ViewerLink,
  stage: string,
  heard: Map<string, Stage>,
  windowGone: () => boolean,
): ViewerLink {
  const own: Stage = { message: () => undefined, exit: () => undefined };
  heard.set(stage, own);
  return {
    send: (m) => link().send({ ...m, stage }),
    onMessage: (listener) => {
      own.message = listener;
    },
    onExit: (listener) => {
      own.exit = listener;
      // once, however it ended: what waits for a stage whose window has gone would wait out its limit for nothing
      if (windowGone()) listener('');
    },
    kill: () => link().send({ op: 'quit', stage }),
  };
}

/** How the hub's window is made: by the caller, or a viewer of its own. */
async function windowMaker(o: HubRun) {
  if (o.viewer) return o.viewer;
  const binary = await viewerBinary();
  return () =>
    new ViewerProcess(binary, [
      '--hub',
      ...(o.focus ? ['--focus'] : []),
      ...(o.behind ? ['--behind'] : []),
      ...(o.appearance ? ['--appearance', o.appearance] : []),
    ]);
}

/**
 * The hub's window and what it asks for. It holds nothing of a device: each window is an `appdyno mirror` of its
 * own, so a crash here costs no window, and a window's crash costs that window.
 */
export async function runHub(ctx: ServerContext, o: HubRun): Promise<number> {
  const start = await windowMaker(o);
  let link: ViewerLink;
  const stages = new Map<string, Stage>();
  const parent = new Parent(ctx, {
    serials: [],
    max: 2,
    options: { quality: 'auto' },
    headless: false,
    ...(o.behind && { behind: true }),
    viewer: (serial) => () =>
      Promise.resolve(
        stageLink(
          () => link,
          serial,
          stages,
          () => windowGone,
        ),
      ),
    noInput: false,
    focus: false,
    inputOnClick: false,
    log: o.log,
  });
  const note = (e: Error) => link.send({ op: 'note', text: e.message });
  const room = new HubRoom(ctx, parent, o.behind === true, note);
  const list = new HubList(ctx, {
    showing: () => room.first,
    windowUp: (serial) => room.windowUp(serial),
    tell: (m) => link.send(m),
  });
  const acts: Record<string, (m: ViewerMessage) => unknown> = {
    select: (m) => room.select(m),
    open: (m) => room.open(m),
    pair: (m) => room.pair(m),
    close: (m) => room.close(m),
    start: async (m) => (await ownerOf(ctx, String(m.id))).boot(String(m.id)),
    stop: async (m) => (await ownerOf(ctx, String(m.id))).shutdown(String(m.id)),
    new: (m) => {
      checkCreate(ctx.policy);
      return ctx.providers
        .find((p) => p.virtual?.kind === m.kind)
        ?.virtual?.create?.(m as unknown as NewDevice);
    },
    clients: (m) => o.services?.act(m, (said) => link.send({ op: 'clients', ...said })),
  };
  let leaving = false;
  let windowGone = false;
  let ended: () => void = () => undefined;
  let deaths: number[] = [];
  const heard = (m: ViewerMessage) => {
    if (typeof m.stage === 'string') {
      if (m.op === 'closed') stages.get(m.stage)?.exit('');
      stages.get(m.stage)?.message(m);
      return;
    }
    if (m.op === 'closed') leaving = true;
    if (m.op !== 'hub') return;
    Promise.resolve()
      .then(() => acts[String(m.action)]?.(m))
      .then(() => list.refresh())
      .catch(note);
  };
  /** A viewer that dies with no word took every device in it: a new one, and each session comes up in it by itself. */
  const listen = (fresh: ViewerLink) => {
    link = fresh;
    fresh.onMessage(heard);
    fresh.onExit((tail) => {
      deaths = [...deaths.filter((t) => Date.now() - t < DEATHS_MS), Date.now()];
      if (leaving || deaths.length > MAX_DEATHS) {
        windowGone = true;
        ended();
        return;
      }
      o.log(`the window ended, and comes back: ${tail.slice(-200)}`);
      list.forgetTold();
      listen(start());
      for (const stage of stages.values()) stage.exit(tail);
      void list.refresh().catch(() => undefined);
    });
  };
  listen(start());
  const onStop = () => {
    leaving = true;
    link.kill();
  };
  process.on('SIGINT', onStop);
  process.on('SIGTERM', onStop);
  // what stands here has its file in this pid's name, and with no handler this signal ends the process
  process.on(FOCUS_SIGNAL, parent.raise);
  const timer = setInterval(() => void list.refresh().catch(() => undefined), POLL_MS);
  await list.refresh().catch((e: unknown) => o.log(e instanceof Error ? e.message : String(e)));
  await new Promise<void>((done) => {
    ended = done;
  });
  clearInterval(timer);
  await Promise.all([o.services?.end(), parent.stopAll('the hub closed')]);
  await Promise.all(parent.done.values());
  process.off('SIGINT', onStop);
  process.off('SIGTERM', onStop);
  process.off(FOCUS_SIGNAL, parent.raise);
  return 0;
}
