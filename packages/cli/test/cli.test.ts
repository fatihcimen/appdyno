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
import { commandsFor, deviceFlag, listOf, takeFlag } from '../src/index.js';

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
      [['--nope', '1'], /no --nope here; flags: --ref --x --y --read/],
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

  it('lists flags from the schema on --help, and does not call the device', async () => {
    const before = device.calls.length;
    const r = await run('wait-for', '--help');
    expect(r.code).toBe(0);
    const help = r.out.join('\n');
    expect(help).toContain('appdyno wait-for');
    for (const flag of [
      '--text',
      '--id',
      '--ref',
      '--gone',
      '--timeout-ms',
      '--read <diff|full|none>',
    ])
      expect(help).toContain(flag);
    expect(help).toContain('default "diff"');
    expect(device.calls.length).toBe(before);
    expect(listOf(ops)).toContain('perf-snapshot');
    expect(listOf(ops).split('\n')).toHaveLength(Object.keys(ops).length);
  });

  it('removes a flag from the words and gives its value', () => {
    const words = ['--x', '1', '--device', 'emulator-5612', '--y', '2'];
    expect(takeFlag(words, 'device')).toBe('emulator-5612');
    expect(words).toEqual(['--x', '1', '--y', '2']);
    expect(takeFlag(words, 'device')).toBeUndefined();
  });

  it('leaves use-device its own --device, and takes it off every other command', () => {
    const own = ['--device', 'emulator-5612'];
    expect(deviceFlag('use-device', own)).toBeUndefined();
    expect(own).toEqual(['--device', 'emulator-5612']);
    const other = ['--device', 'emulator-5612'];
    expect(deviceFlag('screen', other)).toBe('emulator-5612');
    expect(other).toEqual([]);
  });

  it('keeps the selection and the diff baseline between processes in a small file', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'appdyno-cli-')), 'state', 'cli-session.json');
    const provider: DeviceProvider = {
      list: async () => [
        { serial: 'other', state: 'device' },
        { serial: device.serial, state: 'device' },
      ],
      handles: () => true,
      open: () => device,
    };
    const process = async (name: string, ...argv: string[]) => {
      const ctx = new ServerContext(DEFAULT_POLICY, [provider], { remember: file });
      const out: string[] = [];
      const code = await commandsFor(opsFor(ctx))[name]!.run(argv, {
        out: (s) => out.push(s),
        err: (s) => out.push(s),
      });
      ctx.close();
      return { code, out: out.join('\n') };
    };
    expect((await process('use-device', '--device', device.serial, '--app', 'dev.app')).code).toBe(
      0,
    );
    const screen = await process('screen');
    expect(screen.out).toContain('Form');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      serial: device.serial,
      app: 'dev.app',
    });
    expect(readFileSync(file, 'utf8').length).toBeLessThan(2_000);
    // a new process diffs against what the last one showed
    const again = await process('tap', '--x', '5', '--y', '2390');
    expect(again.code).toBe(0);
    expect(again.out).toContain('screen unchanged');
    expect(again.out).toContain('no change seen in');
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
