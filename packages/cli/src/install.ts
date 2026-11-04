import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeWhole } from '@appdyno/core';
import { CLIENTS, SERVER, STDIO, type Client } from './clients.js';
import { jsonEdit } from './jsonc.js';
import { tomlEdit } from './toml.js';

const EDIT = { json: jsonEdit(true), jsonc: jsonEdit(false), toml: tomlEdit };

/** A changed line is shown this far: a settings file on one line holds much else. */
const MAX_SHOWN = 200;

export type InstallOptions = {
  /** Given, never looked up here, so that nothing but the caller can point this at a real home. */
  home: string;
  env: Record<string, string | undefined>;
  yes?: boolean | undefined;
  remove?: boolean | undefined;
  dryRun?: boolean | undefined;
  /** Asks the person at the terminal; none when there is none. */
  ask?: ((question: string) => Promise<string>) | undefined;
  out: (line: string) => void;
  err: (line: string) => void;
};

type Outcome = {
  client: Client;
  file: string;
  did: 'added' | 'replaced' | 'removed' | 'right' | 'absent' | 'refused';
  before: string;
  after: string;
  why?: string;
};

/** Where this client keeps its servers on this Mac, or nothing when it is not here. */
export function fileOf(client: Client, { home, env }: Pick<InstallOptions, 'home' | 'env'>) {
  const moved = client.moved && env[client.moved.env];
  const files = moved ? [join(moved, client.moved!.file)] : client.files.map((f) => join(home, f));
  return (
    files.find((f) => existsSync(f)) ??
    (client.ownFile ? undefined : files.find((f) => existsSync(dirname(f))))
  );
}

/** `want` is met when `have` holds all of it: flags and variables added by hand stay. */
const fits = (have: unknown, want: unknown): boolean => {
  if (Array.isArray(want)) return Array.isArray(have) && want.every((x, i) => fits(have[i], x));
  if (typeof want !== 'object' || want === null) return have === want;
  if (typeof have !== 'object' || have === null) return false;
  return Object.entries(want).every(([k, v]) => fits((have as Record<string, unknown>)[k], v));
};

function outcomeFor(client: Client, file: string, removing: boolean | undefined): Outcome {
  const { key } = client;
  const base = { client, file, before: '', after: '' };
  try {
    const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const same = { ...base, before, after: before };
    const edit = EDIT[client.format];
    const have = edit.read(before, key, SERVER);
    if (removing) {
      if (have === undefined) return { ...same, did: 'absent' };
      return { ...same, did: 'removed', after: edit.remove(before, key, SERVER) };
    }
    if (fits(have, client.entry)) return { ...same, did: 'right' };
    const after = edit.write(before, key, SERVER, client.entry);
    return { ...same, did: have === undefined ? 'added' : 'replaced', after };
  } catch (e) {
    return { ...base, did: 'refused', why: (e as Error).message };
  }
}

const changes = ({ did }: Outcome) => did === 'added' || did === 'replaced' || did === 'removed';

/** Backed up first, then replaced whole: through a link to the real file, in its own mode. */
function apply({ file, before, after }: Outcome) {
  if (!existsSync(file)) {
    writeWhole(file, after);
    return undefined;
  }
  const real = realpathSync(file);
  const { mode } = statSync(real);
  const name = `${real}.${SERVER}-backup-${new Date().toISOString().replace(/\W/g, '')}`;
  let backup = name;
  // never over an earlier one: that may be the only copy of the file as it was
  for (let n = 2; existsSync(backup); n++) backup = `${name}-${n}`;
  writeFileSync(backup, before, { flag: 'wx', mode: mode & 0o777 });
  writeWhole(real, after, mode & 0o777);
  return backup;
}

/** The lines that differ: no two edits here touch far apart, so one run covers them. */
function changedLines(before: string, after: string) {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const shown = (sign: string, lines: string[]) =>
    lines.map((l) => `${sign} ${l.length > MAX_SHOWN ? `${l.slice(0, MAX_SHOWN)}...` : l}`);
  return [
    ...shown('-', a.slice(head, a.length - tail)),
    ...shown('+', b.slice(head, b.length - tail)),
  ];
}

const said = ({ client, file, did, why }: Outcome) =>
  ({
    added: `${client.name}: added to ${file}`,
    replaced: `${client.name}: its entry replaced in ${file}`,
    removed: `${client.name}: removed from ${file}`,
    right: `${client.name}: already right in ${file}`,
    absent: `${client.name}: not in ${file}`,
    refused: `${client.name}: refused, ${file} is left as it is: ${why}`,
  })[did];

const ANY_CLIENT = JSON.stringify({ mcpServers: { [SERVER]: STDIO } }, null, 2);

/** The ones asked for, or undefined when the answer names none of them. */
function picked(answer: string, outcomes: Outcome[]) {
  const words = answer
    .trim()
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (words.length === 1 && words[0] === 'all') return outcomes;
  const chosen = words.map((w) => outcomes[Number(w) - 1]);
  return chosen.every(Boolean) ? (chosen as Outcome[]) : undefined;
}

/** Adds this server to the MCP clients on this Mac, or with `remove` takes it out. Exit code 0, 1 or 2. */
export async function install(o: InstallOptions): Promise<number> {
  const found = CLIENTS.flatMap((client) => {
    const file = fileOf(client, o);
    return file ? [outcomeFor(client, file, o.remove)] : [];
  });
  if (found.length === 0) {
    o.out(
      `no MCP client found on this Mac; for yours, add this to its server list:\n${ANY_CLIENT}`,
    );
    return 1;
  }
  let refused = false;
  const tell = (p: Outcome) => {
    refused ||= p.did === 'refused';
    (p.did === 'refused' ? o.err : o.out)(said(p));
  };
  found.filter((p) => !changes(p)).forEach(tell);
  const open = found.filter(changes);
  if (o.dryRun) {
    for (const p of open) {
      o.out(`would be ${said(p)}`);
      for (const l of changedLines(p.before, p.after)) o.out(l);
    }
    return refused ? 1 : 0;
  }
  let chosen = open;
  if (!o.yes && open.length > 0) {
    if (!o.ask) {
      for (const p of open) o.err(`${p.client.name}: ${p.file}`);
      o.err('this is no terminal to ask at: --yes takes all of these');
      return 2;
    }
    open.forEach((p, i) => o.out(`${i + 1}. ${p.client.name}: ${p.file}`));
    const answer = await o.ask(`${o.remove ? 'remove from' : 'add to'} which? (numbers, or all) `);
    const asked = picked(answer, open);
    if (!asked) {
      o.err(`no such choice: ${answer}`);
      return 2;
    }
    chosen = asked;
  }
  let wrote = false;
  for (const { client, file } of chosen) {
    // a client may have written its file while the question was open
    const now = outcomeFor(client, file, o.remove);
    if (!changes(now)) {
      tell(now);
      continue;
    }
    try {
      const backup = apply(now);
      wrote = true;
      o.out(`${said(now)}${backup ? ` (backup: ${backup})` : ''}`);
    } catch (e) {
      tell({ ...now, did: 'refused', why: (e as Error).message });
    }
  }
  if (wrote) o.out('restart a client for it to see the change');
  return refused ? 1 : 0;
}
