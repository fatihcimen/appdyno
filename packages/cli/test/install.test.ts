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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENTS, SERVER, STDIO, type Client } from '../src/clients.js';
import { fileOf, install, type InstallOptions } from '../src/install.js';
import { jsonEdit } from '../src/jsonc.js';
import { tomlEdit } from '../src/toml.js';

/** A file the size and shape of a client's own state: one list among much else. */
const STATE = (key: string) => `{
  "numStartups": 12,
  "oauthAccount": { "emailAddress": "someone@example.test" },
  "projects": {
    "/work/app": {
      "mcpServers": { "${SERVER}": { "command": "old" } },
      "allowedTools": []
    }
  },
  "${key}": {
    "docs": {
      "type": "http",
      "url": "https://docs.example.test/mcp"
    }
  },
  "tipsHistory": { "a": 1 }
}
`;

/** An editor's settings: comments, a trailing comma, a tab of its own. */
const EDITOR = (key: string) => `// the theme is the one the team uses
{
  "theme": "One Dark", // "One Light" at noon
  /* the servers
     this machine runs */
  "${key}": {
    // keep this first
    "docs": { "command": "node", "args": ["docs.js", "--port=1"], }, // on port 1
    "/* not a comment */": { "command": "//nor this" },
    "other": {
      "command": "node",
    },
  },
  "languages": { "C": { "tab_size": 8 } },
}
`;

const TOML = (key: string) => `# the model this machine uses
model = "a-model"
approval_policy = 'on-request'
notice = """
[${key}.${SERVER}]
not a table: this is text
"""
limits = [
  1, # one
  2,
]

[${key}.docs]
command = "node" # the runtime
args = ["docs.js"]

[${key}.docs.env]
TOKEN = "t"

[profiles.fast]
model = "b-model"
retries = 3
ratio = 0.5
at = 1979-05-27 07:32:00
env = { A = "1", B = "2" }
`;

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
  const file = join(home, client.files[0]!);
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
    expect(out.join('\n')).toContain(backup);
    const copy = join(dirname(file), backup!);
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
    const have = Array.isArray(entry.command)
      ? { ...entry, command: [...entry.command, '--device', 'x'] }
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
    const moved = client.moved!.file ? join(elsewhere, client.moved!.file) : join(elsewhere, 'm');
    mkdirSync(dirname(moved), { recursive: true });
    writeFileSync(moved, sample);
    const env = { [client.moved!.env]: client.moved!.file ? elsewhere : moved };
    expect(fileOf(client, { home, env })).toBe(moved);
    await run(home, { env });
    expect(entryIn(client, moved)).toEqual(client.entry(STDIO));
    expect(readFileSync(file, 'utf8')).toBe(sample);
  });
});

describe('a JSON file', () => {
  const edit = jsonEdit(false);
  const add = (text: string) => edit.write(text, 'servers', SERVER, STDIO);
  const line = `"${SERVER}": { "command": "npx", "args": ["-y", "appdyno", "mcp"] }`;

  it('keeps every comment and the file’s own indentation', () => {
    const text = EDITOR('servers');
    const after = add(text);
    for (const l of text.split('\n')) expect(after).toContain(l);
    expect(after).toContain(`    ${line},\n`);
  });

  it('takes the indentation of a file with tabs', () => {
    expect(add('{\n\t"a": 1\n}\n')).toBe(`{\n\t"servers": {\n\t\t${line}\n\t},\n\t"a": 1\n}\n`);
  });

  it('fills an empty list and an empty file, and gives them back', () => {
    for (const text of ['{}\n', '{\n  "servers": {}\n}\n', '{ "servers": {} }\n']) {
      const after = add(text);
      expect(edit.read(after, 'servers', SERVER)).toEqual(STDIO);
      expect(JSON.parse(after).servers[SERVER]).toEqual(STDIO);
    }
    expect(add('  \n')).toBe(`{\n  "servers": {\n    ${line}\n  }\n}\n`);
    const empty = '{\n  "servers": {}\n}\n';
    expect(edit.remove(add(empty), 'servers', SERVER)).toBe(empty);
  });

  it('writes into a list on one line, and gives it back', () => {
    const text = '{"servers":{"a":{"command":"x"}}}\n';
    const after = add(text);
    expect(JSON.parse(after).servers).toEqual({ [SERVER]: STDIO, a: { command: 'x' } });
    expect(edit.remove(after, 'servers', SERVER)).toBe(text);
  });

  it.each([
    ['first', `{"s":{${'"appdyno":{},'}"a":1,"b":2}}`, '{"s":{"a":1,"b":2}}'],
    ['in the middle', `{"s":{"a":1,${'"appdyno":{},'}"b":2}}`, '{"s":{"a":1,"b":2}}'],
    ['last', `{"s":{"a":1,"b":2,"appdyno":{}}}`, '{"s":{"a":1,"b":2}}'],
    ['alone', `{"s":{"appdyno":{}}}`, '{"s":{}}'],
    [
      'last, with no comma after it',
      '{\n  "s": {\n    "a": 1,\n    "appdyno": {}\n  }\n}\n',
      '{\n  "s": {\n    "a": 1\n  }\n}\n',
    ],
    [
      'last, with a trailing comma',
      '{\n  "s": {\n    "a": 1,\n    "appdyno": {},\n  }\n}\n',
      '{\n  "s": {\n    "a": 1,\n  }\n}\n',
    ],
    [
      'between comments',
      '{\n  "s": {\n    // one\n    "appdyno": {}, // two\n    "a": 1 // three\n  }\n}\n',
      '{\n  "s": {\n    // one // two\n    "a": 1 // three\n  }\n}\n',
    ],
    [
      'alone, under a comment',
      '{\n  "s": {\n    // one\n    "appdyno": {}\n  }\n}\n',
      '{\n  "s": {\n    // one\n  }\n}\n',
    ],
    [
      'alone, under a comment on its opening line',
      '{\n  "s": { // one\n    "appdyno": {}\n  }\n}\n',
      '{\n  "s": { // one\n  }\n}\n',
    ],
    [
      'alone, with the close on its line',
      '{ "s": { // one\n  "appdyno": {} } }\n',
      '{ "s": { // one\n   } }\n',
    ],
    [
      'last, with the close on its line',
      '{ "s": {\n  "a": 1, // one\n  "appdyno": {} } }\n',
      '{ "s": {\n  "a": 1 // one\n   } }\n',
    ],
  ])('leaves valid text when the entry is %s', (_, text, expected) => {
    const after = edit.remove(text, 's', SERVER);
    expect(after).toBe(expected);
    expect(() => edit.read(after, 's', SERVER)).not.toThrow();
  });

  it.each([
    ['opening on the line of the brace', '{ /* long\n     comment */\n  "a": 1\n}\n'],
    ['ending on the line of the first member', '{ /* long\n     comment */ "a": 1\n}\n'],
    ['in an empty object', '{ /* long\n     comment */ }\n'],
  ])('writes past a comment over two lines, %s, and not into it', (_, text) => {
    const after = add(text);
    expect(edit.read(after, 'servers', SERVER)).toEqual(STDIO);
    expect(after).toContain('/* long\n     comment */');
  });

  it('keeps the strings of an entry as they are, brackets and spaces too', () => {
    const entry = { command: 'x', args: ['a[ b', 'c ]d', '[ e ]'], env: { NOTE: 'f [ g' } };
    const after = edit.write('{}\n', 'servers', SERVER, entry);
    expect(edit.read(after, 'servers', SERVER)).toEqual(entry);
    expect(after).toContain('"args": ["a[ b", "c ]d", "[ e ]"]');
  });

  it('takes out every copy of a name that stands twice, as a client reads the last', () => {
    const text = '{"s":{"appdyno":{"a":1},"b":2,"appdyno":{"c":3}}}\n';
    expect(edit.remove(text, 's', SERVER)).toBe('{"s":{"b":2}}\n');
  });

  it('takes only the list at the top: one nested in a project is another', () => {
    const edits = jsonEdit(true);
    const text = STATE('mcpServers');
    expect(edits.read(text, 'mcpServers', SERVER)).toBeUndefined();
    const after = edits.write(text, 'mcpServers', SERVER, STDIO);
    expect(JSON.parse(after).projects['/work/app'].mcpServers[SERVER]).toEqual({ command: 'old' });
    expect(edits.remove(after, 'mcpServers', SERVER)).toBe(text);
  });

  it('refuses a list that is not one, rather than replace it', () => {
    for (const list of ['null', '[]', '"x"', '3'])
      expect(() => add(`{ "servers": ${list} }`)).toThrow('"servers" is not an object');
  });

  it('holds a name with a quote in it, and keeps a line and block comment apart from strings', () => {
    const text = '{ "s": { "a\\"b//": "/* x */" } /* c */ }';
    expect(edit.read(text, 's', 'a"b//')).toBe('/* x */');
  });

  it('is as strict as the client where comments are not allowed', () => {
    expect(() => jsonEdit(true).read('{ "a": 1, }', 'a', 'b')).toThrow('not JSON');
    expect(jsonEdit(false).read('{ "a": { "b": 1 }, }', 'a', 'b')).toBe(1);
  });
});

describe('a TOML file', () => {
  const add = (text: string) => tomlEdit.write(text, 'mcp_servers', SERVER, STDIO);
  const table = `[mcp_servers.${SERVER}]\ncommand = "npx"\nargs = ["-y", "appdyno", "mcp"]\n`;

  it('adds a table at the end and keeps all before it', () => {
    const text = TOML('mcp_servers');
    expect(add(text)).toBe(`${text}\n${table}`);
  });

  it('begins an empty file', () => {
    expect(add('')).toBe(table);
    expect(tomlEdit.remove(table, 'mcp_servers', SERVER)).toBe('');
  });

  it('is not fooled by its own name inside a string', () => {
    expect(tomlEdit.read(TOML('mcp_servers'), 'mcp_servers', SERVER)).toBeUndefined();
  });

  it('takes the table with a tables of its own, leaving the ones around it', () => {
    const before = '[a]\nb = 1\n\n';
    const after = '\n# the next one\n[c]\nd = 2\n';
    const text = `${before}${table}\n[mcp_servers.${SERVER}.env]\nA = "1"\n${after}`;
    expect(tomlEdit.remove(text, 'mcp_servers', SERVER)).toBe(
      `${before}# the next one\n[c]\nd = 2\n`,
    );
  });

  it('reads an entry over several lines, and quoted names', () => {
    const text = `[mcp_servers."${SERVER}"]\ncommand = "npx"\nargs = [\n  "-y",\n  "appdyno",\n  "mcp"\n]\n`;
    expect(tomlEdit.read(text, 'mcp_servers', SERVER)).toEqual(STDIO);
  });

  it.each([
    [`[mcp_servers]\n${SERVER} = { command = "npx" }\n`],
    [`mcp_servers.${SERVER}.command = "npx"\n`],
  ])('refuses an entry written inline rather than add a second: %j', (text) => {
    expect(() => add(text)).toThrow('edit it by hand');
  });

  it.each([
    [`mcp_servers = { docs = { command = "node" } }\n`],
    [`mcp_servers = { ${SERVER} = { command = "npx" } }\n`],
  ])('refuses a list on one line, as a table after it breaks the file: %j', (text) => {
    expect(() => add(text)).toThrow('edit it by hand');
    expect(() => tomlEdit.read(text, 'mcp_servers', SERVER)).toThrow('edit it by hand');
  });

  it('takes a list of tables or of dotted keys as one a table can join', () => {
    for (const text of [`[mcp_servers.docs]\nc = 1\n`, `mcp_servers.docs.c = 1\n`])
      expect(add(text)).toBe(`${text}\n${table}`);
  });

  it('replaces only the table, keeping its own subtable', () => {
    const text = `[mcp_servers.${SERVER}]\ncommand = "old"\n\n[mcp_servers.${SERVER}.env]\nA = "1"\n`;
    expect(add(text)).toBe(`${table}\n[mcp_servers.${SERVER}.env]\nA = "1"\n`);
  });

  it('says the line of what it cannot read', () => {
    expect(() => tomlEdit.read('a = 1\nb = 2\nwords\n', 'k', 'n')).toThrow('line 3');
  });
});

describe('install', () => {
  const [json, , cursor] = CLIENTS.filter((c) => c.format !== 'toml');
  const withTwo = () => {
    const a = homeWith(cursor!, '{}\n');
    const other = CLIENTS.find((c) => c.format === 'toml')!;
    const b = join(a.home, other.files[0]!);
    mkdirSync(dirname(b), { recursive: true });
    writeFileSync(b, '');
    return { home: a.home, first: a.file, second: b };
  };

  it('asks which, and changes only the ones picked', async () => {
    const { home, first, second } = withTwo();
    const ask = vi.fn(async () => '2');
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
    await run(home, { yes: false, ask: async () => 'all' });
    expect(readFileSync(first, 'utf8')).toContain(SERVER);
    expect(readFileSync(second, 'utf8')).toContain(SERVER);
  });

  it.each(['9', 'x', '1 9', '0'])('changes nothing on an answer that names none: %s', async (w) => {
    const { home, first, second } = withTwo();
    const { code, err } = await run(home, { yes: false, ask: async () => w });
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
    const ask = async () => {
      writeFileSync(first, '{ "theme": "written meanwhile" }\n');
      return '1';
    };
    await run(home, { yes: false, ask });
    expect(readFileSync(first, 'utf8')).toContain('written meanwhile');
    expect(JSON.parse(readFileSync(first, 'utf8'))[cursor!.key][SERVER]).toBeDefined();
  });

  it('writes through a link to the real file, and the link stays one', async () => {
    const { home, file } = homeWith(cursor!);
    const dotfiles = mkdtempSync(join(tmpdir(), 'appdyno-dotfiles-'));
    homes.push(dotfiles);
    const real = join(dotfiles, 'mcp.json');
    writeFileSync(real, '{}\n');
    symlinkSync(real, file);
    await run(home);
    expect(lstatSync(file).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toContain(SERVER);
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
    const { home, file } = homeWith(json!, '{}\n');
    await run(home);
    await run(home, { remove: true });
    const [first, second] = beside(file).sort();
    expect(second).toBeDefined();
    expect(readFileSync(join(dirname(file), first!), 'utf8')).toBe('{}\n');
    expect(readFileSync(join(dirname(file), second!), 'utf8')).toContain(SERVER);
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

  it('leaves a backup of what it repointed', async () => {
    const client = CLIENTS.find((c) => c.format === 'jsonc')!;
    const { home, file } = homeWith(client, '{}\n');
    await run(home, { server: here });
    const before = readFileSync(file, 'utf8');
    await run(home, { server: moved, moved: true });
    const backups = readdirSync(dirname(file)).filter((f) => f.includes('-backup-'));
    expect(backups.map((f) => readFileSync(join(dirname(file), f), 'utf8'))).toContain(before);
  });

  it('adds nothing and writes nothing when no entry is stale', async () => {
    const client = CLIENTS.find((c) => c.format === 'jsonc')!;
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
    const client = CLIENTS.find((c) => c.format === 'jsonc')!;
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
