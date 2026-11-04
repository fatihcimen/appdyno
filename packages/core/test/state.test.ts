import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { deviceState, readState, updateState, writeState, writeWhole } from '../src/state.js';

const Counter = z.object({ n: z.number() });

describe('state files', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'appdyno-state-'));
    file = join(dir, 'deep', 'er', 'a.json');
  });

  it('reads back what it wrote, only this user can read it, and it leaves nothing beside it', () => {
    writeState(file, { n: 1 });
    expect(readState(file, Counter)).toEqual({ n: 1 });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
    expect(readdirSync(dirname(file))).toEqual(['a.json']);
  });

  it('never writes into the old file, so a process killed midway leaves that whole', () => {
    writeState(file, { n: 1 });
    const old = join(dir, 'held-open');
    linkSync(file, old);
    writeState(file, { n: 2 });
    expect(JSON.parse(readFileSync(old, 'utf8'))).toEqual({ n: 1 });
    expect(readState(file, Counter)).toEqual({ n: 2 });
  });

  it('leaves the old file and no temp when the write itself fails', () => {
    writeState(file, { n: 1 });
    mkdirSync(`${file}.${process.pid}.tmp`);
    expect(() => writeWhole(file, 'x')).toThrow();
    expect(readState(file, Counter)).toEqual({ n: 1 });
  });

  it.each([
    ['cut short', '{"n":'],
    ['empty', ''],
    ['of another shape', '{"n":"one"}'],
    ['not an object', '["x"]'],
  ])('reads a file that is %s as nothing', (_, text) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    expect(readState(file, Counter)).toBeUndefined();
  });

  it('reads a missing file as nothing', () => {
    expect(readState(file, Counter)).toBeUndefined();
  });

  it('updates in one step, and an undefined result removes the file', () => {
    updateState(file, Counter, (now) => ({ n: (now?.n ?? 0) + 1 }));
    updateState(file, Counter, (now) => ({ n: (now?.n ?? 0) + 1 }));
    expect(readState(file, Counter)).toEqual({ n: 2 });
    updateState(file, Counter, () => undefined);
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dirname(file))).toEqual([]);
  });

  it('frees its lock when a change throws', () => {
    expect(() =>
      updateState(file, Counter, () => {
        throw new Error('no');
      }),
    ).toThrow('no');
    updateState(file, Counter, () => ({ n: 1 }));
    expect(readState(file, Counter)).toEqual({ n: 1 });
  });

  it('will not go past a lock another process holds, and changes nothing', () => {
    writeState(file, { n: 1 });
    mkdirSync(`${file}.lock`);
    expect(() => updateState(file, Counter, () => ({ n: 2 }))).toThrow('could not lock');
    expect(readState(file, Counter)).toEqual({ n: 1 });
  });

  it('takes over a lock a dead process left long ago', () => {
    writeState(file, { n: 1 });
    mkdirSync(`${file}.lock`);
    const longAgo = new Date(Date.now() - 60_000);
    utimesSync(`${file}.lock`, longAgo, longAgo);
    updateState(file, Counter, () => ({ n: 2 }));
    expect(readState(file, Counter)).toEqual({ n: 2 });
  });

  it('keeps per device, each device in its own file', () => {
    vi.stubEnv('APPDYNO_STATE_DIR', dir);
    const kept = deviceState('things', Counter);
    kept.write('a:1', { n: 1 });
    kept.write('b', { n: 2 });
    expect(kept.read('a:1')).toEqual({ n: 1 });
    kept.update('a:1', (now) => ({ n: (now?.n ?? 0) + 1 }));
    expect(kept.read('a:1')).toEqual({ n: 2 });
    kept.remove('a:1');
    expect(kept.read('a:1')).toBeUndefined();
    expect(kept.read('b')).toEqual({ n: 2 });
  });

  it('refuses to keep what it could not read back, and leaves the old file', () => {
    vi.stubEnv('APPDYNO_STATE_DIR', dir);
    const kept = deviceState('things', Counter);
    kept.write('a', { n: 1 });
    expect(() => kept.write('a', { n: 'one' } as never)).toThrow();
    expect(() => kept.update('a', () => ({ n: 'one' }) as never)).toThrow();
    expect(kept.read('a')).toEqual({ n: 1 });
  });

  it('moves aside what cannot be read, once, and leaves what can be', () => {
    vi.stubEnv('APPDYNO_STATE_DIR', dir);
    const kept = deviceState('things', Counter);
    expect(kept.setAside('a')).toBeUndefined();
    kept.write('a', { n: 1 });
    expect(kept.setAside('a')).toBeUndefined();
    const at = join(dir, 'things', 'a.json');
    writeFileSync(at, '{"n":');
    expect(kept.setAside('a')).toBe(`${at}.bad`);
    expect(readFileSync(`${at}.bad`, 'utf8')).toBe('{"n":');
    expect(existsSync(at)).toBe(false);
    expect(kept.setAside('a')).toBeUndefined();
  });
});
