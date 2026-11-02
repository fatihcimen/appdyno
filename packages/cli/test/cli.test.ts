import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { DeviceProvider } from '@appdyno/core';
import { createServer } from '@appdyno/mcp';
import { DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeDevice } from '../../ops/test/fake-device.js';
import { commandsFor } from '../src/index.js';

describe('commands from the operations', () => {
  let device: FakeDevice;
  let ops: ReturnType<typeof opsFor>;
  const run = async (name: string, ...argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await commandsFor(ops)[name]!.run(argv, {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
    });
    return { code, out, err };
  };

  beforeEach(() => {
    device = new FakeDevice();
    const provider: DeviceProvider = {
      list: async () => [{ serial: device.serial, state: 'device' }],
      handles: () => true,
      open: () => device,
    };
    ops = opsFor(new ServerContext(DEFAULT_POLICY, [provider], { app: 'dev.app' }));
  });

  it('has one command per operation, named with dashes', () => {
    const names = Object.keys(commandsFor(ops));
    expect(names).toHaveLength(Object.keys(ops).length);
    expect(names).toContain('wait-for');
    expect(names).toContain('perf-snapshot');
    expect(names.filter((n) => n.includes('_'))).toEqual([]);
  });

  it('answers `appdyno screen` with the text of the MCP `screen`', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createServer(ops, () => undefined).connect(a);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(b);
    const mcp = (await client.callTool({ name: 'screen', arguments: {} })) as {
      content: { type: string; text: string }[];
    };
    const cli = await run('screen');
    expect(cli.code).toBe(0);
    expect(cli.out).toEqual(mcp.content.map((c) => c.text));
    expect(cli.out[0]).toContain('Form');
  });

  it('types flags by the input schema, with dashes for capitals', async () => {
    expect((await run('long-press', '--x', '100', '--y', '350', '--duration-ms', '500')).code).toBe(
      0,
    );
    expect(device.calls.at(-1)?.args[0]).toEqual({
      kind: 'longPress',
      x: 100,
      y: 350,
      durationMs: 500,
    });
    const wait = await run('wait-for', '--text', 'nothing', '--gone', '--read', 'none');
    expect(wait.out).toEqual(['gone']);
  });

  it('takes the arguments as JSON', async () => {
    const r = await run('steps', '--json', '{"steps":[{"action":"tap","x":100,"y":350}]}');
    expect(r.code).toBe(0);
    expect(r.out[0]).toContain('tapped 100,350');
    expect((await run('tap', '--json', '{"x":100,"y":350}')).out[0]).toContain('tapped 100,350');
  });

  it('says what is wrong with the words, without calling the device', async () => {
    const calls = () => device.calls.length;
    for (const [argv, why] of [
      [['--nope', '1'], /no --nope here; flags: --device --ref --x --y --read/],
      [['--x'], /--x needs a value/],
      [['--x', 'left'], /--x: /],
      [['--read', 'some'], /--read: /],
      [['stray'], /unexpected word: stray/],
      [['--json', '{bad'], /--json needs JSON/],
    ] as const) {
      const before = calls();
      const r = await run('tap', ...argv);
      expect(r.code).toBe(2);
      expect(r.err.join()).toMatch(why);
      expect(calls()).toBe(before);
    }
  });

  it('prints a refusal and exits 1', async () => {
    const r = await run('tap');
    expect(r).toEqual({ code: 1, out: [], err: ['give a ref, or x and y'] });
  });

  it('writes an image to --out, or to a temporary file it names', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'appdyno-cli-')), 'shot.jpg');
    const named = await run('screenshot', '--out', out);
    expect(named.out).toEqual([expect.stringContaining('image '), out]);
    expect(readFileSync(out).length).toBeGreaterThan(0);
    await run('tap', '--x', '100', '--y', '350');
    const temp = await run('screenshot');
    expect(temp.out[1]).toMatch(/appdyno-[0-9a-f]{8}\.jpeg$/);
    expect(existsSync(temp.out[1]!)).toBe(true);
  });
});
