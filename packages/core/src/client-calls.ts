import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { deviceStateFile, readState, stateDir, writeWhole } from './state.js';

/** A client that started this server, or one that came in over HTTP: one name may be both, as two different places. */
export type ClientLink = 'stdio' | 'http';

const Call = z.object({
  name: z.string(),
  version: z.string().optional(),
  link: z.enum(['stdio', 'http']),
  last: z.string(),
});

/** The last real call of one client: only what it said of itself and when, as anyone who opens the hub reads this. */
export type ClientCall = z.infer<typeof Call>;

/** A client's own words end up as a label in a window. */
const MAX_NAME = 80;
/** One write per client this often: an agent can call many times a second, and a finer time says nothing more. */
const WRITE_MS = 10_000;

const FOLDER = 'clients';

const plain = (s: string) =>
  s
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .trim()
    .slice(0, MAX_NAME);

const fileOf = (name: string, link: ClientLink) => deviceStateFile(FOLDER, `${link}-${name}`);

const written = new Map<string, number>();

/** Called on each tool call. It may not fail one: this is a note about the call, and never the call. */
export function noteClientCall(said: { name: string; version?: string }, link: ClientLink) {
  const name = plain(said.name);
  if (!name) return;
  const file = fileOf(name, link);
  const now = Date.now();
  if (now - (written.get(file) ?? -WRITE_MS) < WRITE_MS) return;
  written.set(file, now);
  const version = plain(said.version ?? '');
  const call = { name, ...(version && { version }), link, last: new Date(now).toISOString() };
  try {
    writeWhole(file, JSON.stringify(call));
  } catch {
    written.delete(file);
  }
}

/** Every client that has called a tool here, for as long as nothing took its record away. */
export function clientCalls(): ClientCall[] {
  const folder = join(stateDir(), FOLDER);
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.json'))
    .flatMap((n) => readState(join(folder, n), Call) ?? []);
}

/** A client taken out starts again: its old calls prove nothing of the entry it gets next. */
export function forgetClientCall({ name, link }: Pick<ClientCall, 'name' | 'link'>) {
  const file = fileOf(name, link);
  written.delete(file);
  rmSync(file, { force: true });
}
