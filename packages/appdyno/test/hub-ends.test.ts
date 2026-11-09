import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STOP_MS } from '../src/lifetime.js';
import { childFile } from './child-file.js';

const dir = mkdtempSync(join(tmpdir(), 'appdyno-hub-ends-'));
const hub = join(dir, 'hub.mjs');

beforeAll(() => childFile('test/hub-ends.child.ts', hub));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('a hub whose window has closed', () => {
  it('ends, whatever it started is still under way', async () => {
    const child = spawn(process.execPath, [hub], { stdio: ['ignore', 'pipe', 'inherit'] });
    let said = '';
    child.stdout.on('data', (chunk) => (said += String(chunk)));
    const began = Date.now();
    const ended = await new Promise<number | null>((resolve) => {
      const late = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(null);
      }, STOP_MS + 10_000);
      child.once('exit', (code) => {
        clearTimeout(late);
        resolve(code);
      });
    });
    expect(said).toContain('closed');
    expect(ended).toBe(0);
    expect(Date.now() - began).toBeLessThan(STOP_MS + 5_000);
  }, 30_000);
});
