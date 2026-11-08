import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { must } from '../src/must.js';
import { clientCalls, forgetClientCall, noteClientCall } from '../src/client-calls.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'appdyno-calls-'));
  vi.stubEnv('APPDYNO_STATE_DIR', dir);
});

describe('what is kept of a client', () => {
  it('is its name, its version, how it came and when, with nothing else', () => {
    noteClientCall({ name: 'Some Client', version: '1.2' }, 'stdio');
    const [file] = readdirSync(join(dir, 'clients'));
    const kept = JSON.parse(
      readFileSync(join(dir, 'clients', must(file, 'a file')), 'utf8'),
    ) as object;
    expect(Object.keys(kept).sort()).toEqual(['last', 'link', 'name', 'version']);
    expect(clientCalls()).toMatchObject([{ name: 'Some Client', version: '1.2', link: 'stdio' }]);
  });

  it('keeps one name that came both ways as two', () => {
    noteClientCall({ name: 'one' }, 'stdio');
    noteClientCall({ name: 'one' }, 'http');
    expect(clientCalls().map((c) => c.link)).toEqual(expect.arrayContaining(['stdio', 'http']));
  });

  it('takes a client at its word only as a plain label', () => {
    noteClientCall({ name: `../../x\n${'y'.repeat(200)}`, version: '\u0007' }, 'stdio');
    noteClientCall({ name: ' \n ' }, 'stdio');
    const calls = clientCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toMatch(/^\.\.\/\.\.\/x y+$/);
    expect(calls[0]?.name.length).toBe(80);
    expect(calls[0]).not.toHaveProperty('version');
    expect(readdirSync(join(dir, 'clients'))).toHaveLength(1);
  });

  it('writes once in a while, however fast the calls come, and the time moves on', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    try {
      noteClientCall({ name: 'quick' }, 'stdio');
      const first = must(clientCalls()[0], 'a call').last;
      vi.setSystemTime(1_005_000);
      noteClientCall({ name: 'quick' }, 'stdio');
      expect(clientCalls()[0]?.last).toBe(first);
      vi.setSystemTime(1_011_000);
      noteClientCall({ name: 'quick' }, 'stdio');
      expect(must(clientCalls()[0], 'a call').last).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never fails a call, and a file that is no record is passed over', () => {
    vi.stubEnv('APPDYNO_STATE_DIR', '/dev/null/nowhere');
    expect(() => noteClientCall({ name: 'a' }, 'stdio')).not.toThrow();
    expect(clientCalls()).toEqual([]);
  });

  it('forgets a client taken out, and can hear from it again at once', () => {
    noteClientCall({ name: 'gone' }, 'stdio');
    forgetClientCall({ name: 'gone', link: 'stdio' });
    expect(clientCalls()).toEqual([]);
    noteClientCall({ name: 'gone' }, 'stdio');
    expect(clientCalls()).toHaveLength(1);
  });
});
