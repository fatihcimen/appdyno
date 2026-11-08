import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { must, type ClientCall } from '@appdyno/core';
import { afterEach, describe, expect, it } from 'vitest';
import { clientRows, entryCommand } from '../src/client-state.js';
import { BROWSER_CLIENTS, CLIENTS, clientNamed, SERVER, type Client } from '../src/clients.js';
import { apply, outcomeFor } from '../src/install.js';

const homes: string[] = [];

const home = () => {
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-states-'));
  homes.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const where = (dir: string) => ({ home: dir, env: {} });
const fileIn = (dir: string, client: Client) => join(dir, must(client.files[0], 'its file'));
const rowOf = (dir: string, client: { name: string }, calls: ClientCall[] = []) =>
  must(
    clientRows(where(dir), calls).find((r) => r.name === client.name),
    client.name,
  );
/** A folder that holds the client, or its own file where it writes that itself. */
const present = (dir: string, client: Client) => {
  const file = fileIn(dir, client);
  mkdirSync(dirname(file), { recursive: true });
  if (client.ownFile) writeFileSync(file, '{}\n');
  return file;
};
const added = (dir: string, client: Client) => {
  const file = present(dir, client);
  const planned = outcomeFor(client, file, {});
  apply(planned);
  return file;
};
const call = (name: string, link: ClientCall['link'] = 'stdio'): ClientCall => ({
  name,
  link,
  last: '2026-11-05T12:00:00.000Z',
});

/** What each client names itself, as far as its own `says` goes: a plain word it would match. */
const callOf = (client: Client) => call(client.says.source.replace(/\^|\\b|\|.*$/g, ''));

describe.each(CLIENTS)('$name on this Mac', (client) => {
  it('is not here while nothing of it is', () => {
    expect(rowOf(home(), client).state).toBe('absent');
  });

  it('has nothing of ours until it is added', () => {
    const dir = home();
    const file = present(dir, client);
    expect(rowOf(dir, client)).toMatchObject({ state: 'open', file });
  });

  it('is only added until it has really called', () => {
    const dir = home();
    added(dir, client);
    expect(rowOf(dir, client).state).toBe('added');
    expect(rowOf(dir, client, [call('another-name-altogether')]).state).toBe('added');
  });

  it('is connected by a real call of its own, with when', () => {
    const dir = home();
    added(dir, client);
    expect(rowOf(dir, client, [callOf(client)])).toMatchObject({
      state: 'connected',
      last: '2026-11-05T12:00:00.000Z',
    });
  });

  it('is not connected by an old call once its entry is gone', () => {
    const dir = home();
    present(dir, client);
    expect(rowOf(dir, client, [callOf(client)]).state).toBe('open');
  });

  it('is stale only against the app, whose command is its own', () => {
    const dir = home();
    added(dir, client);
    expect(rowOf(dir, client).stale).toBeUndefined();
    const server = { command: '/Applications/X.app/Contents/Resources/bin/x', args: ['mcp'] };
    const row = must(
      clientRows({ ...where(dir), server }, []).find((r) => r.name === client.name),
      client.name,
    );
    expect(row.stale).toBe(true);
  });

  it('says so when it will not take an edit, and why', () => {
    const dir = home();
    present(dir, client);
    writeFileSync(fileIn(dir, client), client.format === 'toml' ? 'a = \n' : '{ "a": 1, ');
    const row = rowOf(dir, client);
    expect(row.state).toBe('refused');
    expect(row.why).toBeTruthy();
  });

  it('puts an entry back as it was, with what was set by hand', () => {
    const dir = home();
    const file = added(dir, client);
    const entry = { ...(outcomeFor(client, file, {}).had as object), hand: 'set' };
    apply(outcomeFor(client, file, { back: entry }));
    const removed = outcomeFor(client, file, { remove: true });
    apply(removed);
    apply(outcomeFor(client, file, { back: removed.had as Record<string, unknown> }));
    expect(outcomeFor(client, file, {}).had).toMatchObject({ hand: 'set' });
  });

  it('is tried by what its own entry runs, by name or as a list', () => {
    const dir = home();
    const file = added(dir, client);
    expect(entryCommand(outcomeFor(client, file, {}).had)).toMatchObject({
      command: 'npx',
      args: ['-y', SERVER, 'mcp'],
    });
  });
});

describe('a client in a browser', () => {
  it.each(BROWSER_CLIENTS)('$name has nothing to do here, and a file of none', (client) => {
    expect(rowOf(home(), client)).toMatchObject({ state: 'browser' });
    expect(rowOf(home(), client).file).toBeUndefined();
  });

  it('is connected only by a call over HTTP: the same name on stdio is the app on this Mac', () => {
    const client = must(BROWSER_CLIENTS[1], 'a second client in a browser');
    const [name] = must(/^\w+/.exec(client.says.source), 'its name');
    expect(rowOf(home(), client, [call(name, 'stdio')]).state).toBe('browser');
    expect(rowOf(home(), client, [call(name, 'http')]).state).toBe('connected');
  });
});

describe('a client the list has not got', () => {
  it('still counts: its call stands as a row of its own, under its own name', () => {
    expect(rowOf(home(), { name: 'A Client Of Its Own' }, [call('A Client Of Its Own')])).toEqual({
      name: 'A Client Of Its Own',
      state: 'connected',
      last: '2026-11-05T12:00:00.000Z',
    });
  });

  it('is named on a device by its own word', () => {
    expect(clientNamed('A Client Of Its Own')).toBe('A Client Of Its Own');
  });
});

describe('the name on a device', () => {
  it.each(CLIENTS)('of $name is what a person calls it', (client) => {
    const word = clientNamed(callOf(client).name);
    expect(client.short ?? client.name).toBe(word);
  });
});

describe('where a file is moved', () => {
  it('reads the state from where the client keeps it', () => {
    const client = must(
      CLIENTS.find((c) => c.moved?.file && !c.ownFile),
      'a client whose file moves',
    );
    const to = must(client.moved, 'where it moves');
    const dir = home();
    const moved = join(dir, 'elsewhere');
    mkdirSync(dirname(join(moved, to.file)), { recursive: true });
    const env = { [to.env]: moved };
    expect(clientRows({ home: dir, env }, []).find((r) => r.name === client.name)).toMatchObject({
      state: 'open',
      file: join(moved, to.file),
    });
  });
});
