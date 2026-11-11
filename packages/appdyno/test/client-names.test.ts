import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CLIENTS } from '@appdyno/cli';
import { must } from '@appdyno/core';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');

/**
 * What the clients are called has to be written somewhere, and only here: the list, how to set each up, and the
 * places a person searching for one finds this tool.
 */
const CLIENT_DATA = [
  'packages/cli/src/clients.ts',
  'docs/guides/clients.md',
  'docs/guides/clients.tr.md',
  'README.md',
  'README.tr.md',
  'packages/appdyno/package.json',
];

const trackedFiles = () =>
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((f) => existsSync(join(root, f)) && statSync(join(root, f)).isFile());

describe('a client', () => {
  it('has its name and folders in those files, and in no other', () => {
    const tracked = trackedFiles();
    expect(tracked.length).toBeGreaterThan(100);
    expect(tracked).toEqual(expect.arrayContaining(CLIENT_DATA));
    const marks = CLIENTS.flatMap((c) => [
      ...c.name.split(' and ').map((name) => new RegExp(`\\b${name}\\b`)),
      ...c.files.map((f) => new RegExp(f.replaceAll('.', '\\.'))),
    ]);
    expect(marks.length).toBeGreaterThan(CLIENTS.length);
    const hits = tracked
      .filter((f) => !CLIENT_DATA.includes(f) && !f.endsWith('.apk') && !/\.(png|jpg|jar)$/.test(f))
      .flatMap((f) => {
        const text = readFileSync(join(root, f), 'latin1');
        return marks.filter((m) => m.test(text)).map((m) => `${f}: ${m.source}`);
      });
    expect(hits).toEqual([]);
  });

  it('is named in the README, where a person searching for it looks', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    const line = must(
      readme.split('\n').find((l) => l.startsWith('Works with ')),
      'the line of clients',
    );
    const unnamed = CLIENTS.flatMap((c) => c.name.split(' and '))
      .map((name) => name.replace(/ (desktop|CLI|in a browser)$/, ''))
      .filter((name) => !line.includes(name));
    expect(unnamed).toEqual([]);
  });
});
