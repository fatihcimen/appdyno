import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SETTINGS } from '@appdyno/core';
import { childFile } from './child-file.js';

const ROUNDS = 12;

let child: string;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-child-'));
  child = await childFile('test/two-processes.child.ts', join(dir, 'child.mjs'));
});

const running: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
  for (const c of running.splice(0)) c.kill('SIGKILL');
});

function start(names: readonly string[], state: string) {
  const c = spawn(process.execPath, [child, names.join(','), String(ROUNDS)], {
    env: { ...process.env, APPDYNO_STATE_DIR: state },
  });
  running.push(c);
  let out = '';
  let err = '';
  c.stderr.on('data', (d) => (err += String(d)));
  const said = (word: string) =>
    new Promise<string>((resolve, reject) => {
      c.stdout.on('data', (d) => {
        out += String(d);
        const line = out.split('\n').find((l) => l.startsWith(word));
        if (line !== undefined) resolve(line.slice(word.length).trim());
      });
      c.once('exit', (code) => reject(new Error(`exited ${code} before ${word}: ${err}`)));
    });
  return { c, said };
}

describe('two processes on one device', () => {
  it('both keep every old value, racing on one conditions file', async () => {
    const state = mkdtempSync(join(tmpdir(), 'appdyno-two-'));
    const half = Math.floor(SETTINGS.length / 2);
    const sets = [SETTINGS.slice(0, half), SETTINGS.slice(half)];
    const both = sets.map((names) => start(names, state));
    const ready = both.map((p) => p.said('ready'));
    const done = both.map((p) => p.said('done'));
    await Promise.all(ready);
    for (const { c } of both) c.stdin.write('go\n');
    const lost = (await Promise.all(done)).map((d) => JSON.parse(d) as string[]);
    expect(lost).toEqual([[], []]);

    const folder = join(state, 'conditions');
    const [file] = readdirSync(folder).filter((f) => f.endsWith('.json'));
    const entries = JSON.parse(readFileSync(join(folder, file!), 'utf8')) as Record<
      string,
      { was: string; owner: { pid: number } }
    >;
    expect(Object.keys(entries).sort()).toEqual([...SETTINGS].sort());
    both.forEach(({ c }, i) => {
      for (const name of sets[i]!) expect(entries[name]?.owner.pid).toBe(c.pid);
    });
  });
});
