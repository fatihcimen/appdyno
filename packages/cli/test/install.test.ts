import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { must } from '@appdyno/core';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';
import { CLIENTS, SERVER, STDIO, type Client } from '../src/clients.js';
import { fileOf, install, type InstallOptions } from '../src/install.js';
import { jsonEdit } from '../src/jsonc.js';
import { tomlEdit } from '../src/toml.js';
import { EDITOR, STATE, TOML } from './samples.js';

const SAMPLE = { json: STATE, jsonc: EDITOR, toml: TOML };

/** Each as a client would be stopped by it: cut short, or stray text. */
const MALFORMED = {
  json: ['{ "a": 1, ', '{ "a": 1 } trailing', '// a comment\n{}\n', '[1]\n'],
  jsonc: ['{ "a": 1, ', '{ "a" 1 }', '/* no end {}', '"text"\n'],
  toml: ['a = ', 'a = "no end\n', 'just words\n', '[table\n', 'a = [1, 2\n', 'a = b\n'],
};

const EDITS = { json: jsonEdit(true), jsonc: jsonEdit(false), toml: tomlEdit };

const homes: string[] = [];

function homeWith(client: Client, text?: string) {
  const home = mkdtempSync(join(tmpdir(), 'appdyno-home-'));
  homes.push(home);
  const file = join(home, must(client.files[0], 'its file'));
  mkdirSync(dirname(file), { recursive: true });
  if (text !== undefined) writeFileSync(file, text);
  return { home, file };
}

async function run(home: string, o: Partial<InstallOptions> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await install({
    home,
    env: {},
    yes: true,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    ...o,
  });
  return { code, out, err };
}

const beside = (file: string) =>
  readdirSync(dirname(file)).filter((f) => f.includes(`${SERVER}-backup`));

const entryIn = (client: Client, file: string) =>
  EDITS[client.format].read(readFileSync(file, 'utf8'), client.key, SERVER);

afterEach(() => vi.useRealTimers());

describe.each(CLIENTS)('$name', (client) => {
  const sample = SAMPLE[client.format](client.key);

  it('keeps its paths relative to a home that is given', () => {
    for (const f of client.files) expect(isAbsolute(f)).toBe(false);
  });

  it('gains the one entry, and removing it gives the file back byte for byte', async () => {
    const { home, file } = homeWith(client, sample);
    expect((await run(home)).code).toBe(0);
    expect(entryIn(client, file)).toEqual(client.entry(STDIO));
    const after = readFileSync(file, 'utf8');
    expect(after).not.toBe(sample);
    expect(after.split('\n').length - sample.split('\n').length).toBeLessThanOrEqual(7);
    expect((await run(home, { remove: true })).code).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(sample);
  });

  it('writes a backup first, whole and as private as the file', async () => {
    const { home, file } = homeWith(client, sample);
    chmodSync(file, 0o600);
    const { out } = await run(home);
    const [backup] = beside(file);
    assert(backup);
    expect(out.join('\n')).toContain(backup);
    const copy = join(dirname(file), backup);
    expect(readFileSync(copy, 'utf8')).toBe(sample);
    expect(statSync(copy).mode & 0o777).toBe(0o600);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('leaves a file that is already right alone, with no backup', async () => {
    const { home, file } = homeWith(client, sample);
    await run(home);
    const first = readFileSync(file, 'utf8');
    const { ino } = statSync(file);
    const again = await run(home);
    expect(again.code).toBe(0);
    expect(again.out.join('\n')).toContain('already right');
    expect(readFileSync(file, 'utf8')).toBe(first);
    expect(statSync(file).ino).toBe(ino);
    expect(beside(file)).toHaveLength(1);
  });

  it('shows the change on a dry run and writes nothing', async () => {
    const { home, file } = homeWith(client, sample);
    const { code, out } = await run(home, { dryRun: true, yes: false });
    expect(code).toBe(0);
    expect(out.join('\n')).toContain(`would be ${client.name}: added`);
    expect(out.join('\n')).toMatch(new RegExp(`^\\+ .*${SERVER}`, 'm'));
    expect(readFileSync(file, 'utf8')).toBe(sample);
    expect(beside(file)).toEqual([]);
  });

  it('removing what is not there changes nothing', async () => {
    const { home, file } = homeWith(client, sample);
    const { code, out } = await run(home, { remove: true });
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('not in');
    expect(readFileSync(file, 'utf8')).toBe(sample);
    expect(beside(file)).toEqual([]);
  });

  it.each(MALFORMED[client.format])('refuses a malformed file: %j', async (text) => {
    const { home, file } = homeWith(client, text);
    for (const o of [{}, { remove: true }, { dryRun: true }]) {
      const { code, err } = await run(home, o);
      expect(code).toBe(1);
      expect(err.join('\n')).toContain('refused');
      expect(readFileSync(file, 'utf8')).toBe(text);
      expect(beside(file)).toEqual([]);
    }
  });

  it('keeps flags, variables and times set by hand: the entry is right as it is', async () => {
    const extra =
      client.format === 'toml'
        ? `[${client.key}.${SERVER}]\ncommand = "npx"\nargs = ["-y", "appdyno", "mcp", "--device", "x"]\nstartup_timeout_sec = 5\ntool_timeout_sec = 7200\n`
        : undefined;
    const entry = client.entry(STDIO);
    const words: unknown[] | undefined = Array.isArray(entry.command) ? entry.command : undefined;
    const have = words
      ? { ...entry, command: [...words, '--device', 'x'] }
      : { ...entry, args: [...STDIO.args, '--device', 'x'], env: { A: '1' } };
    const text = extra ?? JSON.stringify({ [client.key]: { [SERVER]: have } }, null, 2);
    const { home, file } = homeWith(client, text);
    expect((await run(home)).out.join('\n')).toContain('already right');
    expect(readFileSync(file, 'utf8')).toBe(text);
  });

  it('replaces an entry that runs something else, and nothing beside it', async () => {
    const { home, file } = homeWith(client, sample);
    await run(home);
    const right = readFileSync(file, 'utf8');
    const edit = EDITS[client.format];
    writeFileSync(file, edit.write(right, client.key, SERVER, { command: 'elsewhere' }));
    expect((await run(home)).out.join('\n')).toContain('its entry replaced');
    expect(readFileSync(file, 'utf8')).toBe(right);
  });

  it.runIf(!client.ownFile)('begins a file when the client has only its folder', async () => {
    const { home, file } = homeWith(client);
    expect((await run(home)).code).toBe(0);
    expect(entryIn(client, file)).toEqual(client.entry(STDIO));
    expect(beside(file)).toEqual([]);
  });

  it.runIf(client.ownFile)('is not there until it has written its own file', async () => {
    const { home, file } = homeWith(client);
    expect((await run(home)).code).toBe(1);
    expect(existsSync(file)).toBe(false);
  });

  it.runIf(client.moved)('follows the variable that moves its file', async () => {
    const { home, file } = homeWith(client, sample);
    const elsewhere = mkdtempSync(join(tmpdir(), 'appdyno-moved-'));
    homes.push(elsewhere);
    const to = must(client.moved, 'where it moves');
    const moved = to.file ? join(elsewhere, to.file) : join(elsewhere, 'm');
    mkdirSync(dirname(moved), { recursive: true });
    writeFileSync(moved, sample);
    const env = { [to.env]: to.file ? elsewhere : moved };
    expect(fileOf(client, { home, env })).toBe(moved);
    await run(home, { env });
    expect(entryIn(client, moved)).toEqual(client.entry(STDIO));
    expect(readFileSync(file, 'utf8')).toBe(sample);
  });
});

describe('install', () => {
  const [json, , cursor] = CLIENTS.filter((c) => c.format !== 'toml');
  assert(json && cursor);
  const withTwo = () => {
    const a = homeWith(cursor, '{}\n');
    const other = must(
      CLIENTS.find((c) => c.format === 'toml'),
      'a TOML client',
    );
    const b = join(a.home, must(other.files[0], 'its file'));
    mkdirSync(dirname(b), { recursive: true });
    writeFileSync(b, '');
    return { home: a.home, first: a.file, second: b };
  };

  it('asks which, and changes only the ones picked', async () => {
    const { home, first, second } = withTwo();
    const ask = vi.fn(() => Promise.resolve('2'));
    const { code, out } = await run(home, { yes: false, ask });
    expect(code).toBe(0);
    expect(ask).toHaveBeenCalledOnce();
    expect(out[0]).toMatch(/^1\. /);
    expect(out[1]).toMatch(/^2\. /);
    expect(readFileSync(first, 'utf8')).toBe('{}\n');
    expect(readFileSync(second, 'utf8')).toContain(SERVER);
  });

  it('takes all when told', async () => {
    const { home, first, second } = withTwo();
    await run(home, { yes: false, ask: () => Promise.resolve('all') });
    expect(readFileSync(first, 'utf8')).toContain(SERVER);
    expect(readFileSync(second, 'utf8')).toContain(SERVER);
  });

  it.each(['9', 'x', '1 9', '0'])('changes nothing on an answer that names none: %s', async (w) => {
    const { home, first, second } = withTwo();
    const { code, err } = await run(home, { yes: false, ask: () => Promise.resolve(w) });
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('no such choice');
    expect(readFileSync(first, 'utf8')).toBe('{}\n');
    expect(readFileSync(second, 'utf8')).toBe('');
  });

  it('with no terminal to ask at, lists them, changes nothing and asks for --yes', async () => {
    const { home, first } = withTwo();
    const { code, err } = await run(home, { yes: false });
    expect(code).toBe(2);
    expect(err.join('\n')).toContain(first);
    expect(err.at(-1)).toContain('--yes');
    expect(readFileSync(first, 'utf8')).toBe('{}\n');
  });

  it('goes on past a file it refuses, and exits 1 for it', async () => {
    const { home, first, second } = withTwo();
    writeFileSync(first, '{ broken');
    const { code, err } = await run(home);
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('refused');
    expect(readFileSync(first, 'utf8')).toBe('{ broken');
    expect(readFileSync(second, 'utf8')).toContain(SERVER);
  });

  it('reads the file again after the question: a client may have written it meanwhile', async () => {
    const { home, first } = withTwo();
    const ask = () => {
      writeFileSync(first, '{ "theme": "written meanwhile" }\n');
      return Promise.resolve('1');
    };
    await run(home, { yes: false, ask });
    expect(readFileSync(first, 'utf8')).toContain('written meanwhile');
    expect(JSON.parse(readFileSync(first, 'utf8'))).toHaveProperty([cursor.key, SERVER]);
  });

  it('writes through a link to the real file, and the link stays one', async () => {
    const { home, file } = homeWith(cursor);
    const dotfiles = mkdtempSync(join(tmpdir(), 'appdyno-dotfiles-'));
    homes.push(dotfiles);
    const real = join(dotfiles, 'mcp.json');
    writeFileSync(real, '{}\n');
    symlinkSync(real, file);
    await run(home);
    expect(lstatSync(file).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toContain(SERVER);
  });

  it('writes no edit that does not read back as asked: a table that stands twice', async () => {
    const client = must(
      CLIENTS.find((c) => c.format === 'toml'),
      'a TOML client',
    );
    const text = `[mcp_servers.${SERVER}]\ncommand = "old"\n\n[mcp_servers.${SERVER}]\nargs = ["x"]\n`;
    const { home, file } = homeWith(client, text);
    const { code, err } = await run(home);
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('refused');
    expect(readFileSync(file, 'utf8')).toBe(text);
    expect(beside(file)).toEqual([]);
  });

  it.each([
    ['JSON', cursor, Buffer.from('{ "name": "caf\xe9" }\n', 'latin1')],
    [
      'TOML',
      must(
        CLIENTS.find((c) => c.format === 'toml'),
        'a TOML client',
      ),
      Buffer.from('# caf\xe9\na = 1\n', 'latin1'),
    ],
  ])('refuses %s that is not UTF-8, which it could not put back', async (_, client, bytes) => {
    const { home, file } = homeWith(client);
    writeFileSync(file, bytes);
    const { code, err } = await run(home);
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('refused');
    expect(readFileSync(file).equals(bytes)).toBe(true);
    expect(beside(file)).toEqual([]);
  });

  it('keeps the mark at the head of a file, and its backup is the file to the byte', async () => {
    const client = must(
      CLIENTS.find((c) => c.format === 'toml'),
      'a TOML client',
    );
    const mark = Buffer.from([0xef, 0xbb, 0xbf]);
    const bytes = Buffer.concat([mark, Buffer.from('name = "café"\n')]);
    const { home, file } = homeWith(client);
    writeFileSync(file, bytes);
    await run(home);
    expect(readFileSync(file).subarray(0, 3)).toEqual(mark);
    const [backup] = beside(file);
    assert(backup);
    expect(readFileSync(join(dirname(file), backup)).equals(bytes)).toBe(true);
  });

  it('leaves a link that leads nowhere, whose place a new file would take', async () => {
    const { home, file } = homeWith(cursor);
    symlinkSync(join(home, 'an unmounted disk', 'mcp.json'), file);
    const { code, err } = await run(home);
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('leads nowhere');
    expect(lstatSync(file).isSymbolicLink()).toBe(true);
  });

  it('leaves a file its owner closed to writing, though a rename would go through', async () => {
    const { home, file } = homeWith(cursor, '{}\n');
    chmodSync(file, 0o400);
    const { code, err } = await run(home);
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('refused');
    expect(readFileSync(file, 'utf8')).toBe('{}\n');
    expect(beside(file)).toEqual([]);
  });

  it('keeps the mode of a file open to others, whatever this process gives a new one', async () => {
    const { home, file } = homeWith(cursor, '{}\n');
    chmodSync(file, 0o666);
    await run(home);
    expect(statSync(file).mode & 0o777).toBe(0o666);
  });

  it('says what to add by hand when it finds no client', async () => {
    const home = mkdtempSync(join(tmpdir(), 'appdyno-home-'));
    homes.push(home);
    const { code, out } = await run(home);
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('"mcpServers"');
    expect(JSON.parse(out.join('\n').slice(out.join('\n').indexOf('{')))).toEqual({
      mcpServers: { [SERVER]: STDIO },
    });
  });

  it('keeps two backups of two changes in one moment apart, the first as it was', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
    const { home, file } = homeWith(json, '{}\n');
    await run(home);
    await run(home, { remove: true });
    const [first, second] = beside(file).sort();
    assert(first && second);
    expect(readFileSync(join(dirname(file), first), 'utf8')).toBe('{}\n');
    expect(readFileSync(join(dirname(file), second), 'utf8')).toContain(SERVER);
  });

  it('says a folder it cannot write to, leaves the file and goes on', async () => {
    const { home, first, second } = withTwo();
    chmodSync(dirname(first), 0o500);
    try {
      const { code, err } = await run(home);
      expect(code).toBe(1);
      expect(err.join('\n')).toContain('refused');
      expect(readFileSync(first, 'utf8')).toBe('{}\n');
      expect(readFileSync(second, 'utf8')).toContain(SERVER);
    } finally {
      chmodSync(dirname(first), 0o700);
    }
  });

  it('touches nothing under the home it was not given', async () => {
    const real = mkdtempSync(join(tmpdir(), 'appdyno-real-home-'));
    homes.push(real);
    vi.stubEnv('HOME', real);
    const { home } = withTwo();
    await run(home);
    expect(readdirSync(real)).toEqual([]);
    vi.unstubAllEnvs();
  });
});

describe('install, from the app', () => {
  const bin = (bundle: string) => `${bundle}/Contents/Resources/bin/appdyno`;
  const here = { command: bin('/Applications/Appdyno.app'), args: ['mcp'] };
  const moved = { command: bin('/Users/a/Tools/Appdyno.app'), args: ['mcp'] };

  it.each(CLIENTS.map((c) => [c.name, c] as const))(
    '%s gets the same entry, with the app in it',
    async (_, client) => {
      const { home, file } = homeWith(client, client.format === 'toml' ? '' : '{}\n');
      expect((await run(home, { server: here })).code).toBe(0);
      expect(entryIn(client, file)).toEqual(client.entry(here));
      expect(JSON.stringify(entryIn(client, file))).toContain(here.command);
      expect(JSON.stringify(entryIn(client, file))).not.toContain('npx');
    },
  );

  it.each(CLIENTS.map((c) => [c.name, c] as const))(
    '%s follows an app that moved, and keeps what a person added',
    async (_, client) => {
      const { home, file } = homeWith(client, client.format === 'toml' ? '' : '{}\n');
      await run(home, { server: here });
      const edit = client.format === 'toml' ? tomlEdit : jsonEdit(client.format === 'json');
      const entry = entryIn(client, file) as Record<string, unknown>;
      const flagged = { ...entry, startup_note: 'mine' };
      writeFileSync(file, edit.write(readFileSync(file, 'utf8'), client.key, SERVER, flagged));
      expect((await run(home, { server: moved, moved: true })).code).toBe(0);
      const after = entryIn(client, file) as Record<string, unknown>;
      expect(JSON.stringify(after)).toContain(moved.command);
      expect(JSON.stringify(after)).not.toContain(here.command);
      expect(after.startup_note).toBe('mine');
    },
  );

  it('keeps the variables of a TOML entry a table, when the app moved', async () => {
    const client = must(
      CLIENTS.find((c) => c.format === 'toml'),
      'a TOML client',
    );
    const table = `[${client.key}.${SERVER}]\ncommand = "${here.command}"\nargs = ["mcp"]\nenv = { A = "1" }\n`;
    const { home, file } = homeWith(client, table);
    expect((await run(home, { server: moved, moved: true })).code).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(table.replace(here.command, moved.command));
  });

  it('leaves a backup of what it repointed', async () => {
    const client = must(
      CLIENTS.find((c) => c.format === 'jsonc'),
      'a JSONC client',
    );
    const { home, file } = homeWith(client, '{}\n');
    await run(home, { server: here });
    const before = readFileSync(file, 'utf8');
    await run(home, { server: moved, moved: true });
    const backups = readdirSync(dirname(file)).filter((f) => f.includes('-backup-'));
    expect(backups.map((f) => readFileSync(join(dirname(file), f), 'utf8'))).toContain(before);
  });

  it('adds nothing and writes nothing when no entry is stale', async () => {
    const client = must(
      CLIENTS.find((c) => c.format === 'jsonc'),
      'a JSONC client',
    );
    const empty = homeWith(client, '{}\n');
    await run(empty.home, { server: moved, moved: true });
    expect(readFileSync(empty.file, 'utf8')).toBe('{}\n');
    const right = homeWith(client, '{}\n');
    await run(right.home, { server: moved });
    const written = readFileSync(right.file, 'utf8');
    await run(right.home, { server: moved, moved: true });
    expect(readFileSync(right.file, 'utf8')).toBe(written);
  });

  it('never repoints an entry that is not the app', async () => {
    const client = must(
      CLIENTS.find((c) => c.format === 'jsonc'),
      'a JSONC client',
    );
    const { home, file } = homeWith(client, '{}\n');
    await run(home, {});
    const written = readFileSync(file, 'utf8');
    await run(home, { server: moved, moved: true });
    expect(readFileSync(file, 'utf8')).toBe(written);
  });

  it('says the entry to add by hand with the app in it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'appdyno-install-'));
    const { code, out } = await run(home, { server: here });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain(here.command);
  });
});
