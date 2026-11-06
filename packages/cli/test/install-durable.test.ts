import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENTS } from '../src/clients.js';
import { install } from '../src/install.js';

const writes = vi.hoisted(() => [] as ({ durable?: boolean } | undefined)[]);

vi.mock('@appdyno/core', async (original) => {
  const core = await original<typeof import('@appdyno/core')>();
  return {
    ...core,
    writeWhole: (...args: Parameters<typeof core.writeWhole>) => {
      writes.push(args[2]);
      core.writeWhole(...args);
    },
  };
});

const client = CLIENTS.find((c) => c.format === 'jsonc' && !c.ownFile)!;

function homeWith(text?: string) {
  const home = mkdtempSync(join(tmpdir(), 'appdyno-durable-'));
  const file = join(home, client.files[0]!);
  mkdirSync(dirname(file), { recursive: true });
  if (text !== undefined) writeFileSync(file, text);
  return home;
}

describe("a client's file", () => {
  beforeEach(() => {
    writes.length = 0;
  });

  it.each([
    ['begun', undefined],
    ['edited', '{}\n'],
  ])('holds through a power cut when %s', async (_, text) => {
    const code = await install({
      home: homeWith(text),
      env: {},
      yes: true,
      out: () => undefined,
      err: () => undefined,
    });
    expect(code).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ durable: true });
  });
});
