import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { entryCommand } from '../src/client-state.js';
import { SERVER, STDIO } from '../src/clients.js';
import { jsonEdit } from '../src/jsonc.js';
import { tomlEdit } from '../src/toml.js';
import { EDITOR, STATE, TOML } from './samples.js';

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
      expect(JSON.parse(after)).toHaveProperty(['servers', SERVER], STDIO);
    }
    expect(add('  \n')).toBe(`{\n  "servers": {\n    ${line}\n  }\n}\n`);
    const empty = '{\n  "servers": {}\n}\n';
    expect(edit.remove(add(empty), 'servers', SERVER)).toBe(empty);
  });

  it('writes into a list on one line, and gives it back', () => {
    const text = '{"servers":{"a":{"command":"x"}}}\n';
    const after = add(text);
    expect(JSON.parse(after)).toHaveProperty('servers', { [SERVER]: STDIO, a: { command: 'x' } });
    expect(edit.remove(after, 'servers', SERVER)).toBe(text);
  });

  it.each([
    ['first', '{"s":{"appdyno":{},"a":1,"b":2}}', '{"s":{"a":1,"b":2}}'],
    ['in the middle', '{"s":{"a":1,"appdyno":{},"b":2}}', '{"s":{"a":1,"b":2}}'],
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
    [
      'last, with a comment over two lines after it',
      '{ "s": {\n  "a": 1, // one\n  "appdyno": {} /* two\n  more */\n} }\n',
      '{ "s": {\n  "a": 1 // one\n   /* two\n  more */\n} }\n',
    ],
    [
      'before a comment over two lines that leads to the next',
      '{ "s": {\n  "x": 1, // one\n  "appdyno": {}, /* two\n  more */ "a": 1\n} }\n',
      '{ "s": {\n  "x": 1, // one\n   /* two\n  more */ "a": 1\n} }\n',
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
    expect(JSON.parse(after)).toHaveProperty(['projects', '/work/app', 'mcpServers', SERVER], {
      command: 'old',
    });
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

  it('puts back word for word what JSON has no way to say', () => {
    const text = `[mcp_servers.${SERVER}]\ncommand = "old"\nargs = ['mcp']\nenv = { A = "1" }\ntool_timeout_sec = 1_800\nat = 1979-05-27\nnote = """two\nlines"""\n"a key" = 1\n`;
    const had = tomlEdit.read(text, 'mcp_servers', SERVER) as Record<string, unknown>;
    const moved = tomlEdit.write(text, 'mcp_servers', SERVER, { ...had, command: 'new' });
    expect(moved).toBe(text.replace('"old"', '"new"'));
    // an undo, with the table gone by then
    expect(tomlEdit.write('', 'mcp_servers', SERVER, had)).toBe(text);
  });

  it('tells apart two values JSON cannot say, as reading an edit back must', () => {
    const read = (value: string) =>
      tomlEdit.read(`[mcp_servers.${SERVER}]\nenv = ${value}\n`, 'mcp_servers', SERVER);
    expect(isDeepStrictEqual(read('{ A = "1" }'), read('{ A = "1" }'))).toBe(true);
    expect(isDeepStrictEqual(read('{ A = "1" }'), read('{ A = "2" }'))).toBe(false);
  });

  it('gives no variable of a value it cannot read', () => {
    const text = `[mcp_servers.${SERVER}]\ncommand = "npx"\nenv = { A = "1" }\n`;
    const entry = entryCommand(tomlEdit.read(text, 'mcp_servers', SERVER));
    expect({ ...entry?.env }).toEqual({});
  });

  it('takes a server whose name is only quoted to hold a dot for another', () => {
    const other = `[mcp_servers."${SERVER}.staging"]\ncommand = "elsewhere"\n`;
    expect(tomlEdit.read(other, 'mcp_servers', SERVER)).toBeUndefined();
    expect(tomlEdit.remove(`${other}\n${table}`, 'mcp_servers', SERVER)).toBe(other);
    expect(add(other)).toBe(`${other}\n${table}`);
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
