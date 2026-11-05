import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  isAlive,
  pause,
  viewerBinary,
  ViewerProcess,
  type DeviceHardware,
  type NewDevice,
  type Startable,
  type ViewerLink,
  type ViewerMessage,
} from '@appdyno/core';
import type { Platform } from '@appdyno/protocol';
import type { ServerContext } from '../context.js';
import { ToolError } from '../tool.js';
import { liveMirror, liveMirrors, mirrorLog } from './state.js';

export type HubRun = {
  /** A person asked for the keyboard. */
  focus: boolean;
  /** Kept off every screen, and what it opens with it. */
  behind?: boolean;
  appearance?: string;
  log: (line: string) => void;
  /** Its window, where a caller makes it. */
  viewer?: ViewerLink;
};

/** One row of the sidebar. */
export type HubDevice = {
  id: string;
  serial?: string;
  name: string;
  kind: 'phone' | 'simulator' | 'emulator';
  state: 'running' | 'stopped';
  mirrored: boolean;
  platform?: Platform;
  model?: string;
  detail: string;
};

type Hardware = (serial: string) => Promise<DeviceHardware | undefined>;

const POLL_MS = 2_000;
const CLOSE_MS = 30_000;

/** Every device this Mac can reach and each virtual one that could start, as a person sees them. */
export async function hubDevices(ctx: ServerContext, hardware: Hardware): Promise<HubDevice[]> {
  const mirrored = new Set(liveMirrors().map((m) => m.serial));
  const virtual: HubDevice[] = [];
  for (const { virtual: driver } of ctx.providers) {
    const found = await driver?.startable().catch(() => [] as Startable[]);
    for (const d of found ?? [])
      virtual.push({
        id: d.id,
        ...(d.serial && { serial: d.serial }),
        name: d.name,
        kind: driver!.kind,
        state: d.state,
        mirrored: d.serial !== undefined && mirrored.has(d.serial),
        platform: driver!.platform,
        ...(d.model && { model: d.model }),
        detail: d.model ?? '',
      });
  }
  const seen = new Set(virtual.map((d) => d.serial ?? d.id));
  const phones: HubDevice[] = [];
  for (const d of await ctx.devices()) {
    // what this server may not drive is not even asked of, as asking refuses
    if (seen.has(d.serial) || !ctx.allowed(d.serial)) continue;
    const known = await hardware(d.serial);
    phones.push({
      id: d.serial,
      serial: d.serial,
      name: known?.name ?? known?.model ?? d.model ?? d.serial,
      kind: 'phone',
      state: 'running',
      mirrored: mirrored.has(d.serial),
      ...(known?.platform && { platform: known.platform }),
      ...(known?.model && { model: known.model }),
      detail: d.state,
    });
  }
  return [...phones, ...virtual].filter((d) => ctx.allowed(d.serial ?? d.id));
}

/** What each kind can be made from: asked once, as each list is a tool's slow answer. */
async function hubChoices(ctx: ServerContext) {
  const choices: Record<string, unknown> = {};
  for (const { virtual } of ctx.providers) {
    const made = await virtual?.catalog?.().catch(() => undefined);
    if (virtual && made) choices[virtual.kind] = made;
  }
  return choices;
}

/** The driver a virtual device belongs to. */
async function ownerOf(ctx: ServerContext, id: string) {
  for (const { virtual } of ctx.providers) {
    const found = await virtual?.startable().catch(() => [] as Startable[]);
    if (found?.some((d) => d.id === id)) return virtual!;
  }
  throw new ToolError(`no such device: ${id}`, 'NOT_FOUND');
}

/** A window of its own for a device: a process of its own, which outlives the hub. */
function openWindow(ctx: ServerContext, serial: string, behind: boolean) {
  const command = ctx.mirrorCommand;
  if (!command) throw new ToolError('this host cannot start a window', 'UNSUPPORTED');
  const log = mirrorLog(serial);
  mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
  const out = openSync(log, 'w', 0o600);
  const child = spawn(
    command[0]!,
    [...command.slice(1), '--device', serial, ...(behind ? ['--behind'] : [])],
    { detached: true, stdio: ['ignore', out, out] },
  );
  closeSync(out);
  child.unref();
}

async function closeWindow(serial: string) {
  const f = liveMirror(serial);
  if (!f) return;
  process.kill(f.pid, 'SIGTERM');
  const end = Date.now() + CLOSE_MS;
  while (isAlive(f) && Date.now() < end) await pause(100);
}

/**
 * The hub's window and what it asks for. It holds nothing of a device: each window is an `appdyno mirror` of its
 * own, so a crash here costs no window, and a window's crash costs that window.
 */
export async function runHub(ctx: ServerContext, o: HubRun): Promise<number> {
  const link =
    o.viewer ??
    new ViewerProcess(await viewerBinary(), [
      '--hub',
      ...(o.focus ? ['--focus'] : []),
      ...(o.behind ? ['--behind'] : []),
      ...(o.appearance ? ['--appearance', o.appearance] : []),
    ]);
  const known = new Map<string, DeviceHardware | undefined>();
  const hardware: Hardware = async (serial) => {
    if (!known.has(serial))
      known.set(
        serial,
        await ctx
          .deviceFor(serial)
          .hardware()
          .catch(() => undefined),
      );
    return known.get(serial);
  };
  const choices = hubChoices(ctx);
  let said = '';
  const refresh = async () => {
    const devices = await hubDevices(ctx, hardware);
    const text = JSON.stringify(devices);
    if (text === said) return;
    said = text;
    link.send({ op: 'hub', devices, choices: await choices });
  };
  const acts: Record<string, (m: ViewerMessage) => Promise<unknown> | void> = {
    open: (m) => openWindow(ctx, String(m.serial), o.behind === true),
    close: (m) => closeWindow(String(m.serial)),
    start: async (m) => (await ownerOf(ctx, String(m.id))).boot(String(m.id)),
    stop: async (m) => (await ownerOf(ctx, String(m.id))).shutdown(String(m.id)),
    new: (m) =>
      ctx.providers
        .find((p) => p.virtual?.kind === m.kind)
        ?.virtual?.create?.(m as unknown as NewDevice),
  };
  link.onMessage((m) => {
    if (m.op !== 'hub') return;
    Promise.resolve()
      .then(() => acts[String(m.action)]?.(m))
      .then(refresh)
      .catch((e: Error) => link.send({ op: 'note', text: e.message }));
  });
  const onStop = () => link.kill();
  process.on('SIGINT', onStop);
  process.on('SIGTERM', onStop);
  const timer = setInterval(() => void refresh().catch(() => undefined), POLL_MS);
  await refresh().catch((e: Error) => o.log(e.message));
  await new Promise<void>((done) => link.onExit(() => done()));
  clearInterval(timer);
  process.off('SIGINT', onStop);
  process.off('SIGTERM', onStop);
  return 0;
}
