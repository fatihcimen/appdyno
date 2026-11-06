import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeWhole } from '../src/state.js';

const calls = vi.hoisted(() => [] as string[]);

/** A power cut cannot be had in a test: what stands in for one is that the text reaches the disk before the rename. */
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    fsyncSync: (fd: number) => {
      calls.push('fsync');
      fs.fsyncSync(fd);
    },
    renameSync: (from: string, to: string) => {
      calls.push('rename');
      fs.renameSync(from, to);
    },
  };
});

describe('a file written whole', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'appdyno-whole-')), 'a.json');

  beforeEach(() => {
    calls.length = 0;
  });

  it('reaches the disk before its rename, for a person’s own file', () => {
    const f = file();
    writeWhole(f, 'the text', { mode: 0o640, durable: true });
    expect(calls).toEqual(['fsync', 'rename']);
    expect(readFileSync(f, 'utf8')).toBe('the text');
    expect(statSync(f).mode & 0o777).toBe(0o640);
  });

  it('asks no disk of a state file, which is written as often as a call', () => {
    const f = file();
    writeWhole(f, 'the text');
    expect(calls).toEqual(['rename']);
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });
});
