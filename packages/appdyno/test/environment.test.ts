import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

/** A variable by its whole name: `TEST_RUNNER_APPDYNO_PORT` is the runner's own, by the prefix XCTest strips. */
const NAME = /(?<![A-Z0-9_])APPDYNO_[A-Z0-9_]+/g;
const namesIn = (files: string[]) => new Set(files.flatMap((f) => read(f).match(NAME) ?? []));

const named = namesIn(tracked.filter((f) => /^packages\/[^/]+\/src\/.+\.ts$/.test(f)));
/** What a person may set: what a page of theirs names. */
const documented = namesIn(
  tracked.filter((f) => /^(README|SECURITY)\.md$|^docs\/.+(?<!\.tr)\.md$/.test(f)),
);
/** What is appdyno's own: the table CONTRIBUTING keeps of them. */
const table = must(
  /^## Variables of its own\n([^]*?)\n## /m.exec(read('CONTRIBUTING.md'))?.[1],
  "CONTRIBUTING's table of variables",
);
const own = new Set(
  [...table.matchAll(/^\| `(APPDYNO_[A-Z0-9_]+)`/gm)].map((m) => must(m[1], 'a name')),
);

describe('an environment variable the sources name', () => {
  it('is said in the docs, or is in the table of those that are appdyno’s own', () => {
    expect(named.size).toBeGreaterThan(30);
    expect([...named].filter((n) => !documented.has(n) && !own.has(n))).toEqual([]);
  });

  it('is one or the other: a page names none of appdyno’s own', () => {
    expect(own.size).toBeGreaterThan(3);
    expect([...own].filter((n) => documented.has(n))).toEqual([]);
  });

  it('of appdyno’s own is one the sources still name', () => {
    expect([...own].filter((n) => !named.has(n))).toEqual([]);
  });
});
