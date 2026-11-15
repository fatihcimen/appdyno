import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { must } from '@appdyno/core';
import * as library from '../src/index.js';
import { drive } from '../examples/drive.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';

const device = new FakeDevice();

vi.mock('../src/providers.js', () => ({
  deviceProviders: () => [
    {
      list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
      handles: () => true,
      open: () => device,
    },
  ],
}));

describe('the library', () => {
  it('runs the example the docs show', async () => {
    const flow = join(mkdtempSync(join(tmpdir(), 'appdyno-library-')), 'a.flow');
    writeFileSync(flow, 'assert text="Bilgiler"\n');
    const lines: string[] = [];
    await expect(drive(flow, (l) => lines.push(l))).resolves.toBe(true);
    expect(lines[0]).toContain('tapped');
    expect(lines[1]).toMatch(/^assert text="Bilgiler": \d+ ms$/);
    expect(lines[2]).toMatch(/^NOT_FOUND: /);
    const shown = readFileSync(
      new URL('../../../docs/reference/library.md', import.meta.url),
      'utf8',
    );
    const example = readFileSync(new URL('../examples/drive.ts', import.meta.url), 'utf8');
    expect(shown).toContain(example.trim());
  });

  it('refuses an allowDevices that is no regular expression, saying what it takes', () => {
    // plain JavaScript can give anything: a string failed every call with a TypeError
    expect(() => library.connect({ allowDevices: '^emulator-' as never })).toThrow(
      expect.objectContaining({
        code: 'INVALID_ARGUMENT',
        message: 'allowDevices takes a regular expression, as /^emulator-/, not a string',
      }),
    );
    expect(() => library.connect({ allowDevices: /^emulator-/ })).not.toThrow();
  });

  it('is refused a device another process holds, and drives it beside that process when it shares', async () => {
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    const pid = must(other.pid, "the other process's pid");
    try {
      const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
      }).trim();
      const claims = join(must(process.env.APPDYNO_STATE_DIR, 'APPDYNO_STATE_DIR'), 'claims');
      mkdirSync(claims, { recursive: true });
      const claim = join(claims, `${device.serial}.json`);
      const held = JSON.stringify({
        pid,
        started,
        tool: 'appdyno mcp',
        since: '2026-11-15T00:00:00Z',
      });
      writeFileSync(claim, held);

      const alone = library.connect();
      await expect(alone.tool('screen', {})).rejects.toMatchObject({
        code: 'DEVICE_CLAIMED',
        message: expect.stringContaining(`pid ${pid}`) as unknown,
      });
      await alone.close();

      const beside = library.connect({ share: true });
      expect((await beside.tool('screen', {})).data.elements).toBeGreaterThan(0);
      await beside.close();
      // the other's hold stands: sharing takes nothing from it
      expect(readFileSync(claim, 'utf8')).toBe(held);

      vi.stubEnv('APPDYNO_SHARE', '1');
      const byEnv = library.connect();
      expect((await byEnv.tool('screen', {})).data.elements).toBeGreaterThan(0);
      await byEnv.close();
    } finally {
      vi.unstubAllEnvs();
      other.kill('SIGKILL');
    }
  });

  it('has one name to call, and the rest are types', () => {
    expect(Object.keys(library)).toEqual(['connect']);
  });
});
