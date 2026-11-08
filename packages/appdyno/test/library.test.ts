import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as library from '../src/index.js';
import { drive } from '../examples/drive.js';
import { FakeDevice } from '../../ops/test/fake-device.js';

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

  it('has one name to call, and the rest are types', () => {
    expect(Object.keys(library)).toEqual(['connect']);
  });
});
