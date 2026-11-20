import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, type NetworkSource } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { ServerContext } from '../src/context.js';
import { harEntries } from '../src/network-har.js';
import { DEFAULT_POLICY, redactLog, type Policy } from '../src/policy.js';
import { textOf } from '../src/tool.js';
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

describe('an address in a capture', () => {
  it('loses what signs it, as a link to a file in a store or behind a CDN has', () => {
    const clean = (url: string) => redactLog(DEFAULT_POLICY, url);
    expect(
      clean(
        'https://files.store.example/a.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261116&X-Amz-Date=20261116T000000Z&X-Amz-Security-Token=FwoGZXIvYXdzEJr&X-Amz-Signature=5d672d79c15b13162d9279b0855cfba6',
      ),
    ).toBe(
      'https://files.store.example/a.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=•••&X-Amz-Date=20261116T000000Z&X-Amz-Security-Token=•••&X-Amz-Signature=•••',
    );
    expect(
      clean(
        'https://acct.store.example/c/a.jpg?sv=2026-01-01&se=2026-11-17T00%3A00Z&sig=Zm9vYmFyYmF6cXV4',
      ),
    ).toBe('https://acct.store.example/c/a.jpg?sv=2026-01-01&se=2026-11-17T00%3A00Z&sig=•••');
    expect(
      clean(
        'https://d111.cdn.example/a.mp4?Expires=1794787200&Signature=nitfHRCrtziwO2HwPfWw~yYDhUF5EwRunQA&Key-Pair-Id=K2JCJMDEHXQW5F',
      ),
    ).toBe(
      'https://d111.cdn.example/a.mp4?Expires=1794787200&Signature=•••&Key-Pair-Id=K2JCJMDEHXQW5F',
    );
  });
});

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

  it('is read on any device, bounded, with credentials hidden, from where a tool reads alone', async () => {
    const device = new FakeDevice();
    const capture = (policy: Policy) =>
      must(
        checkedOps(
          new ServerContext(
            policy,
            [
              {
                list: () =>
                  Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
                handles: () => true,
                open: () => device,
              },
            ],
            { app: 'dev.app' },
          ),
        ).capture_network,
        'capture_network',
      );
    // a HAR outside the folders a tool reads, as a person's own export in a folder of theirs, is not read
    const outside = capture(DEFAULT_POLICY);
    await expect(
      outside.handler(outside.input.parse({ action: 'read', har: har([]) })),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    const op = capture({ ...DEFAULT_POLICY, writeDirs: [dir] });
    const list = Array.from({ length: 10 }, (_, i) => ({
      ...entry('2026-01-01T00:00:00Z'),
      request: { method: 'GET', url: `https://a.test/${i}?token=abc` },
    }));
    const r = await op.handler(op.input.parse({ action: 'read', har: har(list), limit: 3 }));
    const text = r.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    // the host's own line, then the first of its paths the limit has room for, each query by its names
    expect(text).toMatch(/^2 of 10 from .*: contains, method, status or after narrows it\n/);
    expect(text).toContain('\na.test:\n  GET /0?token 201 12 ms 3 B\n  GET /1?token 201 12 ms 3 B');
    expect(text).not.toContain('/2?token');
    expect(text).not.toContain('abc');
    const narrowed = await op.handler(
      op.input.parse({ action: 'read', har: har(list), contains: 'a.test', limit: 3 }),
    );
    const whole = narrowed.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    expect(whole).toMatch(/^3 of 10 from/);
    expect(whole).toContain('https://a.test/9?token=•••');
    expect(whole).not.toContain('https://a.test/6');
    expect(text).toMatch(/bodies: 0 of 10 in the export/);
    // a start with no way names the ways this device has, and points to what each sees
    await expect(op.handler(op.input.parse({ action: 'start' }))).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringMatching(/^start needs via: this device has proxy/) as unknown,
      hint: 'capture_network paths says what each sees, and what it costs',
    });
  });
});

describe('a packet trace that has ended by itself', () => {
  /** A device whose trace runs until `ended` says when it ended, and holds one row. */
  const traced = (ended: () => number | undefined) => {
    process.env.APPDYNO_STATE_DIR = mkdtempSync(join(tmpdir(), 'appdyno-state-'));
    const device = new FakeDevice();
    const way = { starts: 0, stops: 0 };
    const network: NetworkSource = {
      paths: () => Promise.resolve([{ via: 'packets', sees: 'packets by port' }]),
      start: () => Promise.resolve({ via: 'packets', n: ++way.starts }),
      read: () => Promise.resolve({ entries: [] }),
      stop: () => {
        way.stops++;
        return Promise.resolve({
          entries: [{ direction: 'Received', host: 'TCP port 443', packets: 3, bytes: 900 }],
        });
      },
      endedAt: () => Promise.resolve(ended()),
    };
    Object.assign(device, { network });
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
    const op = must(checkedOps(ctx).capture_network, 'capture_network');
    const start = () => op.handler(op.input.parse({ action: 'start', via: 'packets' }));
    return { device, way, start };
  };

  it('is read and ended by the next start, which says what it saw', async () => {
    const { device, way, start } = traced(() => Date.parse('2026-11-18T22:35:23.000Z'));
    await start();
    const text = textOf((await start()).blocks);
    expect(text).toMatch(/^capturing by packets/);
    expect(text).toContain(
      `\nthe last capture on ${device.serial}, by packets, ended on its own at 2026-11-18T22:35:23.000Z:\n`,
    );
    expect(text).toContain('TCP port 443');
    expect(way).toEqual({ starts: 2, stops: 1 });
  });

  it('refuses while it runs, saying how it ends', async () => {
    const { way, start } = traced(() => undefined);
    await start();
    await expect(start()).rejects.toMatchObject({
      code: 'DEVICE_CLAIMED',
      message: expect.stringMatching(/^packets has been capturing on .* since /) as unknown,
      hint: 'capture_network stop ends it',
    });
    expect(way).toEqual({ starts: 1, stops: 0 });
  });
});
