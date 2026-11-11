import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { isAlive, must, pause, type ViewerHubAsk } from '@appdyno/core';
import type { Parent } from './parent.js';
import { liveMirror, mirrorLog, type ServerContext, ToolError } from '@appdyno/ops';

const CLOSE_MS = 30_000;
const OWN_WINDOW_MS = 20_000;

/** A window of its own for a device: a process of its own, which outlives the hub. */
function openWindow(ctx: ServerContext, serial: string, behind: boolean) {
  const command = ctx.mirrorCommand;
  if (!command) throw new ToolError('this host cannot start a window', 'UNSUPPORTED');
  const log = mirrorLog(serial);
  mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
  const out = openSync(log, 'w', 0o600);
  const child = spawn(
    must(command[0], "the window's command"),
    [...command.slice(1), '--device', serial, ...(behind ? ['--behind'] : [])],
    { detached: true, stdio: ['ignore', out, out] },
  );
  closeSync(out);
  child.unref();
}

async function closeWindow(serial: string) {
  const f = liveMirror(serial);
  // what stands in the hub's own room is closed by choosing
  if (!f || f.pid === process.pid) return;
  process.kill(f.pid, 'SIGTERM');
  const end = Date.now() + CLOSE_MS;
  while (isAlive(f) && Date.now() < end) await pause(100);
}

/** What stands in the hub's window, and the one thing that opens or closes a stream. */
export class HubRoom {
  private showing: string[] = [];
  /** A window of its own takes a moment to start: until then a choice of its device would take it first, and both hold it. */
  private readonly ownWindows = new Map<string, number>();
  private wanted: string | undefined;
  private choosing: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly ctx: ServerContext,
    private readonly parent: Parent,
    private readonly behind: boolean,
    private readonly note: (e: Error) => void,
  ) {}

  get first() {
    return this.showing[0];
  }

  /** A window that is up is on its way no more: closed soon after, its device must not be kept from the room. */
  windowUp(serial: string) {
    this.ownWindows.delete(serial);
  }

  /** Choosing ends the streams of what no longer stands here. */
  private choose(serials: string[], paired = false) {
    this.choosing = this.choosing
      .then(async () => {
        const stays = paired ? [] : serials;
        const leaving = this.showing
          .filter((serial) => !stays.includes(serial))
          .map((serial) => this.parent.close(serial, 'another device was chosen'));
        // a pair opens what was just closed; else a phone's slow goodbye holds nothing up
        if (paired) await Promise.all(leaving);
        const fresh = paired ? serials : serials.filter((s) => !this.showing.includes(s));
        this.showing = serials;
        this.parent.pairing = paired;
        for (const serial of fresh) await this.parent.open(serial);
        await Promise.all(leaving);
      })
      .catch(this.note);
    return this.choosing;
  }

  select(m: ViewerHubAsk<'select'>): Promise<unknown> | undefined {
    const { serial } = m;
    this.wanted = serial;
    const held = serial ? (this.ownWindows.get(serial) ?? 0) - Date.now() : 0;
    // the window says a thing once: a choice held off is not lost, as nothing will ask again
    if (held > 0) {
      setTimeout(() => this.wanted === serial && void this.select(m), held).unref();
      return undefined;
    }
    return this.choose(serial ? [serial] : []);
  }

  async open(m: ViewerHubAsk<'open'>) {
    this.ownWindows.set(m.serial, Date.now() + OWN_WINDOW_MS);
    await this.choose([]);
    openWindow(this.ctx, m.serial, this.behind);
  }

  /** Windows already open are each a process of their own: the pair is one. */
  async pair(m: ViewerHubAsk<'pair'>) {
    const serials = [m.serial, m.with];
    await Promise.all(serials.map(closeWindow));
    return this.choose(serials, true);
  }

  async close(m: ViewerHubAsk<'close'>) {
    await closeWindow(m.serial);
    this.ownWindows.delete(m.serial);
  }
}
