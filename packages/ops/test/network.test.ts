import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { ServerContext } from '../src/context.js';
import { harEntries } from '../src/network.js';
import { DEFAULT_POLICY } from '../src/policy.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { checkedOps } from '@appdyno/testing/calls.js';

const dir = mkdtempSync(join(tmpdir(), 'appdyno-har-'));
let files = 0;
const file = (text: string) => {
  const f = join(dir, `${files++}.har`);
  writeFileSync(f, text);
  return f;
};
const har = (entries: unknown[]) =>
  file(JSON.stringify({ log: { version: '1.2', pages: [], entries } }, null, 1));

describe('a proxy export', () => {
  const entry = (at: string, text?: string) => ({
    startedDateTime: at,
    time: 12.4,
    request: { method: 'POST', url: 'https://api.example.com/v1?token=abc' },
    response: { status: 201, content: { size: 3, ...(text && { text }) } },
  });

  it('gives each request, whether its body is there, and only those since the capture began', async () => {
    const list = await harEntries(
      har([entry('2026-01-01T00:00:00Z'), entry('2026-01-01T00:00:10Z', 'hey')]),
      Date.parse('2026-01-01T00:00:05Z'),
    );
    expect(list).toEqual([
      {
        at: '2026-01-01T00:00:10Z',
        method: 'POST',
        url: 'https://api.example.com/v1?token=abc',
        status: 201,
        ms: 12,
        bytes: 3,
        body: true,
      },
    ]);
    expect((await harEntries(har([entry('2026-01-01T00:00:00Z')])))[0]?.body).toBe(false);
  });

  it('takes braces and quotes in a body for what they are, and entries across chunks', async () => {
    const big = 'x'.repeat(300_000); // over one read of the stream
    const list = await harEntries(
      har([
        entry('2026-01-01T00:00:00Z', `{"a":"}}}\\"{{`),
        entry('2026-01-01T00:00:01Z', big),
        entry('2026-01-01T00:00:02Z', '"entries": [{'),
      ]),
    );
    expect(list.map((e) => e.at)).toEqual([
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:01Z',
      '2026-01-01T00:00:02Z',
    ]);
  });

  it('calls a file that is no export what it is', async () => {
    await expect(harEntries(file('not json'))).rejects.toThrow(/not a HAR file/);
    await expect(harEntries(file('{"log":{"entries":[{"a"'))).resolves.toEqual([]);
  });

  it('is read on any device, bounded, with credentials hidden', async () => {
    const device = new FakeDevice();
    const ctx = new ServerContext(
      DEFAULT_POLICY,
      [
        {
          list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
          handles: () => true,
          open: () => device,
        },
      ],
      { app: 'dev.app' },
    );
    const op = must(checkedOps(ctx).network, 'network');
    const list = Array.from({ length: 10 }, (_, i) => ({
      ...entry('2026-01-01T00:00:00Z'),
      request: { method: 'GET', url: `https://a.test/${i}?token=abc` },
    }));
    const r = await op.handler(op.input.parse({ action: 'read', har: har(list), limit: 3 }));
    const text = r.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    expect(text).toMatch(/^3 of 10 from/);
    expect(text).toContain('https://a.test/9?token=•••');
    expect(text).not.toContain('https://a.test/6');
    expect(text).toMatch(/bodies: 0 of 3 in the export/);
    // a start with no way names the ways this device has, and points to what each sees
    await expect(op.handler(op.input.parse({ action: 'start' }))).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringMatching(/^start needs via: this device has proxy/) as unknown,
      hint: 'network paths says what each sees, and what it costs',
    });
  });
});
