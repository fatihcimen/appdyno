import { join } from 'node:path';
import { readState, stateDir, type Startable, type VirtualDevices } from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { byPerson } from './policy.js';
import { ToolError } from './tool.js';

/** The serial each one this tool shut down ran as, by its name: a stopped emulator has none of its own. */
export const RanAs = z.record(z.string(), z.string());
export const ranAsFile = () => join(stateDir(), 'ran-as.json');

export type Virtual = { d: Startable; on: VirtualDevices; ranAs?: string };

/** Every virtual device of every driver, with the driver that has it, and the serial a stopped one ran as. */
export async function virtuals(ctx: ServerContext) {
  const ranAs = readState(ranAsFile(), RanAs) ?? {};
  const out: Virtual[] = [];
  for (const p of ctx.providers) {
    const on = p.virtual;
    if (!on) continue;
    const found = await on.startable().catch(() => [] as Startable[]);
    out.push(
      ...found.map((d) => {
        const was = d.serial ? undefined : ranAs[d.name];
        return { d, on, ...(was && { ranAs: was }) };
      }),
    );
  }
  return out;
}

/**
 * What a virtual device answers to, by `name` and in the allow list alike: its id, its serial (a stopped one's, the one it
 * ran as), its name, and a simulator's without its runtime.
 */
const namesOf = ({ d, ranAs }: Virtual) => [
  ...new Set(
    [d.id, d.serial ?? ranAs, d.name, d.name.replace(/ \([^()]*\)$/, '')].filter(
      (n): n is string => n !== undefined,
    ),
  ),
];

/** As `ServerContext.checkDevice`, by every name it answers to, so that a boot is allowed where the shutdown before it was. */
export function checkVirtual(ctx: ServerContext, x: Virtual) {
  const { devices } = ctx.policy;
  const names = namesOf(x);
  if (devices && !names.some((n) => devices.test(n)))
    throw new ToolError(
      `${x.d.name} is not allowed on this server`,
      'POLICY_DENIED',
      `${byPerson('by --allow-devices')}: it is matched against ${names.join(', ')}`,
    );
}

export async function namedVirtual(ctx: ServerContext, id: string) {
  const all = await virtuals(ctx);
  const hits = all.filter((x) => namesOf(x).includes(id));
  const [only, other] = hits;
  if (only && !other) return only;
  throw new ToolError(
    hits.length === 0
      ? `no simulator or emulator is named ${id} (action list)`
      : `more than one is named ${id}: ${hits.map((x) => x.d.id).join(', ')}`,
    hits.length === 0 ? 'NOT_FOUND' : 'AMBIGUOUS',
  );
}

/** A connected device and every name it answers to: its serial, its model, and a simulator's or an AVD's name. */
type Known = { serial: string; label: string; names: string[] };

/** The connected devices by every name each answers to. */
async function known(ctx: ServerContext): Promise<Known[]> {
  const [listed, virtual] = await Promise.all([ctx.devices(), virtuals(ctx)]);
  return listed.map((d) => {
    const v = virtual.filter((x) => x.d.serial === d.serial);
    const names = [
      d.serial,
      d.model,
      d.sameAs,
      ...v.flatMap((x) => [...namesOf(x), x.d.model]),
    ].filter((n): n is string => !!n);
    return {
      serial: d.serial,
      label: v[0]?.d.name ?? d.model ?? d.serial,
      names: [...new Set(names)],
    };
  });
}

/**
 * The serial of the device a caller names: by its serial or udid, a simulator's or an AVD's name, or its model, as a
 * person calls it. The allow list is matched against each of those names, and a device it lets in by another name than
 * its serial is let in by its serial too. A refusal says the devices this server may drive, by name.
 */
export async function deviceNamed(ctx: ServerContext, said: string): Promise<string> {
  const all = await known(ctx);
  const named = (k: Known) => k.names.includes(said);
  const loose = (k: Known) => k.names.some((n) => n.toLowerCase() === said.toLowerCase());
  const hits = all.some(named) ? all.filter(named) : all.filter(loose);
  const { devices } = ctx.policy;
  const allowed = (k: Known) => !devices || k.names.some((n) => devices.test(n));
  const mayUse = all
    .filter(allowed)
    .map((k) => (k.label === k.serial ? k.serial : `${k.label} (${k.serial})`));
  const offer = mayUse.length > 0 ? `; this server may drive: ${mayUse.join(', ')}` : '';
  const [only, other] = hits;
  if (other)
    throw new ToolError(
      `more than one device is named ${said}: ${hits.map((k) => `${k.label} (${k.serial})`).join(', ')}`,
      'AMBIGUOUS',
      'name it by its serial',
    );
  if (!only) {
    // one not listed may still be reached by its serial, as a phone that is joining
    if (!devices || devices.test(said)) return said;
    throw new ToolError(
      `no device here is named ${said}${offer}`,
      'NOT_FOUND',
      'use_device takes one of those',
    );
  }
  if (!allowed(only))
    throw new ToolError(
      `${only.label} (${only.serial}) is not allowed on this server${offer}`,
      'POLICY_DENIED',
      mayUse.length > 0
        ? 'use_device takes one of those'
        : `${byPerson('by --allow-devices')}: it is matched against ${only.names.join(', ')}`,
    );
  ctx.allowAs(only.serial);
  return only.serial;
}
