import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exclusively, ownerIn, thisOwner } from '../src/index.js';

const file = () => join(mkdtempSync(join(tmpdir(), 'appdyno-owner-')), 'a', 'held.json');
const busy = (o: { tool: string }) => new Error(`held by ${o.tool}`);

describe('one at a time', () => {
  it('refuses a second holder in this process, and frees it at the end', async () => {
    const f = file();
    let inner: unknown;
    await exclusively(f, 'first', busy, async () => {
      inner = await exclusively(f, 'second', busy, async () => 'ran').catch(
        (e: Error) => e.message,
      );
    });
    expect(inner).toBe('held by first');
    expect(existsSync(f)).toBe(false);
    await expect(exclusively(f, 'third', busy, async () => 'ran')).resolves.toBe('ran');
  });

  it('frees it when the body fails', async () => {
    const f = file();
    await expect(
      exclusively(f, 'x', busy, async () => {
        throw new Error('it failed');
      }),
    ).rejects.toThrow('it failed');
    expect(existsSync(f)).toBe(false);
  });

  it('takes over what a dead process left', async () => {
    const f = file();
    const dead = spawnSync('true').pid;
    await exclusively(f, 'held', busy, async () => {
      writeFileSync(f, JSON.stringify({ ...thisOwner('old'), pid: dead }));
      expect(ownerIn(f)).toBeUndefined();
    });
    writeFileSync(f, JSON.stringify({ ...thisOwner('old'), pid: dead }));
    await expect(exclusively(f, 'new', busy, async () => 'ran')).resolves.toBe('ran');
  });

  it('reads a broken file as no owner', async () => {
    const f = file();
    await exclusively(f, 'x', busy, async () => {
      writeFileSync(f, 'not json');
      expect(ownerIn(f)).toBeUndefined();
    });
  });
});
