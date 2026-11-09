import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { must, type DeviceProvider } from '@appdyno/core';
import { createServer } from '@appdyno/mcp';
import { DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { DeviceError } from '@appdyno/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeDevice } from '../../ops/test/fake-device.js';
import { checkedOps } from '../../ops/test/helpers.js';
import {
  askOnTerminal,
  cliSessionFile,
  commandsFor,
  deviceFlag,
  flowWords,
  listOf,
  takeFlag,
} from '../src/index.js';

describe('commands from the operations', () => {
  let device: FakeDevice;
  let ops: ReturnType<typeof opsFor>;
  const run = async (name: string, ...argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await must(commandsFor(ops)[name], name).run(argv, {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
    });
    return { code, out, err };
  };

  beforeEach(() => {
    device = new FakeDevice();
    const provider: DeviceProvider = {
      list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
      handles: () => true,
      open: () => device,
    };
    ops = checkedOps(new ServerContext(DEFAULT_POLICY, [provider], { app: 'dev.app' }));
  });

  it('takes the first bare word of an op with actions as its action', async () => {
    const r = await run('report', 'stop');
    expect(r.code).toBe(1);
    expect(r.err.join('')).toMatch(/no report is open/);
    expect((await run('report', 'nothing')).err.join('')).toMatch(/unexpected word: nothing/);
    expect((await run('report', 'stop', 'stop')).err.join('')).toMatch(/unexpected word: stop/);
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
    expect(
      (
        await run(
          'gesture',
          '--kind',
          'long_press',
          '--x',
          '100',
          '--y',
          '350',
          '--duration-ms',
          '500',
        )
      ).code,
    ).toBe(0);
    expect(device.calls.at(-1)?.args[0]).toEqual({
      kind: 'longPress',
      x: 100,
      y: 350,
      durationMs: 500,
    });
    const wait = await run('wait-for', '--text', 'nothing', '--gone', '--read', 'none');
    expect(wait.out).toEqual(['gone']);
  });

  it('writes a screenshot in the format the name of --out says, and replaces what is there', async () => {
    Object.defineProperty(device, 'mirror', { value: {} });
    const asked: unknown[] = [];
    const shot = device.screenshot.bind(device);
    Object.assign(device, {
      screenshot: (o: { format: string }) => {
        asked.push(o.format);
        return shot();
      },
    });
    const file = join(mkdtempSync(join(tmpdir(), 'appdyno-cli-')), 'a.png');
    expect((await run('screenshot', '--out', file)).code).toBe(0);
    expect((await run('screenshot', '--out', file)).code).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect(asked).toEqual(['png', 'png']);
    const notes = await run('screenshot', '--out', file.replace('a.png', 'a.txt'));
    expect(notes.code).toBe(1);
    expect(notes.err[0]).toContain('a .png, .jpg or .jpeg');
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
      [['--nope', '1'], /no --nope here; flags: --ref --x --y --selector --read/],
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

  it('calls only what has no default required', async () => {
    const help = (await run('wait-for', '--help')).out.join('\n');
    expect(help).not.toContain('required; default');
    expect(help).toMatch(/--read <diff\|full\|none> {2}default "diff"/);
    expect((await run('use-device', '--help')).out.join('\n')).toMatch(
      /--device <\w+> {2}required/,
    );
  });

  it('lists the device flag once, as an op that takes a device has its own', async () => {
    const help = (await run('use-device', '--help')).out.join('\n');
    expect(help.match(/^ {2}--device /gm)).toHaveLength(1);
    expect((await run('tap', '--help')).out.join('\n')).toContain('--device <serial>');
    expect((await run('app', '--help')).out.join('\n')).toContain('--yes  yes to what');
    expect((await run('tap', '--help')).out.join('\n')).not.toContain('--yes');
  });

  it('says each command in a whole sentence, or marks where it cut one', () => {
    const lines = listOf(ops).split('\n');
    expect(lines.filter((l) => l.endsWith(':'))).toEqual([]);
    expect(lines.every((l) => l.length <= 124)).toBe(true);
    for (const l of lines) expect(l).toMatch(/(\.|…)$/);
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
      list: () =>
        Promise.resolve([
          { serial: 'other', state: 'device', ready: true },
          { serial: device.serial, state: 'device', ready: true },
        ]),
      handles: () => true,
      open: () => device,
    };
    const process = async (name: string, ...argv: string[]) => {
      const ctx = new ServerContext(DEFAULT_POLICY, [provider], { remember: file });
      const out: string[] = [];
      const code = await must(commandsFor(opsFor(ctx))[name], name).run(argv, {
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

  it('gives two terminals in two folders a session each', async () => {
    process.env.APPDYNO_STATE_DIR = mkdtempSync(join(tmpdir(), 'appdyno-cli-'));
    const other = new FakeDevice('emulator-5612');
    const provider: DeviceProvider = {
      list: () =>
        Promise.resolve(
          [device, other].map((d) => ({ serial: d.serial, state: 'device', ready: true })),
        ),
      handles: () => true,
      open: (serial) => (serial === other.serial ? other : device),
    };
    const inFolder = async (cwd: string, name: string, ...argv: string[]) => {
      const ctx = new ServerContext(DEFAULT_POLICY, [provider], { remember: cliSessionFile(cwd) });
      const out: string[] = [];
      await must(commandsFor(opsFor(ctx))[name], name).run(argv, {
        out: (s) => out.push(s),
        err: (s) => out.push(s),
      });
      ctx.close();
      return out.join('\n');
    };
    expect(cliSessionFile('/work/one')).toBe(cliSessionFile('/work/one'));
    expect(cliSessionFile('/work/one')).not.toBe(cliSessionFile('/work/two'));
    await inFolder('/work/one', 'use-device', '--device', device.serial);
    await inFolder('/work/two', 'use-device', '--device', other.serial);
    expect(await inFolder('/work/one', 'device-info')).toContain(device.serial);
    expect(await inFolder('/work/two', 'device-info')).toContain(other.serial);
  });

  it('prints a refusal and exits 1', async () => {
    const r = await run('tap');
    expect(r).toEqual({
      code: 1,
      out: [],
      err: [
        'INVALID_ARGUMENT: give a ref, a selector, or x and y',
        '  screen lists the elements, each by its ref, role and words',
      ],
    });
  });

  it('prints what to do with a refusal, once', async () => {
    device.screen = 'login';
    const several = await run('tap', '--json', '{"selector":{"text":"Add"}}');
    expect(several.code).toBe(1);
    expect(several.err[0]).toContain('2 elements match');
    expect(several.err[1]).toBe('  give the selector an index, or use a ref');
    device.fail = new DeviceError('TIMEOUT', 'the build hung', 'the last lines of its log');
    const failed = await run('screen');
    expect(failed.code).toBe(1);
    expect(failed.err).toEqual(['TIMEOUT: the build hung', '  the last lines of its log']);
  });

  it('writes an image to --out, or to a temporary file it names', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'appdyno-cli-')), 'shot.jpg');
    Object.defineProperty(device, 'mirror', { value: {} });
    const named = await run('screenshot', '--out', out);
    expect(named.out).toEqual([expect.stringContaining(`saved ${out}`)]);
    expect(readFileSync(out).length).toBeGreaterThan(0);
    await run('tap', '--x', '100', '--y', '350');
    const temp = await run('screenshot');
    expect(temp.out[1]).toMatch(/appdyno-[0-9a-f]{8}\.jpeg$/);
    expect(existsSync(must(temp.out[1], 'its file'))).toBe(true);
  });
});

describe('flow on the command line', () => {
  it('takes its action and file as words, and repeats --param', () => {
    expect(
      flowWords(['run', 'a.flow', '--from', '3', '--param', 'A=1', '--param', 'B=x=y']),
    ).toEqual([
      '--action',
      'run',
      '--file',
      'a.flow',
      '--from',
      '3',
      '--params',
      '["A=1","B=x=y"]',
    ]);
    expect(flowWords(['save', 'a.flow', '--overwrite'])).toEqual([
      '--action',
      'save',
      '--file',
      'a.flow',
      '--overwrite',
    ]);
    expect(flowWords(['--action', 'start'])).toEqual(['--action', 'start']);
    expect(
      flowWords(['run', 'a.flow', '--env-file', 'ci.env', '--iterations', '5', '--scenario', 'x']),
    ).toEqual([
      '--action',
      'run',
      '--file',
      'a.flow',
      '--env-file',
      'ci.env',
      '--iterations',
      '5',
      '--scenario',
      'x',
    ]);
    expect(() => flowWords(['run', 'a.flow', 'extra'])).toThrow(/unexpected word: extra/);
  });
});

describe('a command that loses data', () => {
  const runOn = async (argv: string[], answer?: boolean) => {
    const cleared: string[] = [];
    const asked: string[] = [];
    const device = Object.assign(new FakeDevice(), {
      apps: {
        clearData: (app: string) => {
          cleared.push(app);
          return Promise.resolve();
        },
      },
    });
    const provider: DeviceProvider = {
      list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
      handles: () => true,
      open: () => device,
    };
    const ops = checkedOps(new ServerContext(DEFAULT_POLICY, [provider], { app: 'dev.app' }));
    const err: string[] = [];
    const code = await must(commandsFor(ops).app, 'app').run(argv, {
      out: () => undefined,
      err: (s) => err.push(s),
      ...(answer !== undefined && {
        ask: (q: string) => {
          asked.push(q);
          return Promise.resolve(answer);
        },
      }),
    });
    return { code, err: err.join('\n'), cleared, asked };
  };

  it('asks the person at the terminal, and goes ahead only on a yes', async () => {
    const yes = await runOn(['clear'], true);
    expect(yes).toMatchObject({ code: 0, cleared: ['dev.app'] });
    expect(yes.asked).toEqual([expect.stringMatching(/^Clear the data of dev\.app on .*\? /)]);
    const no = await runOn(['clear'], false);
    expect(no).toMatchObject({ code: 1, cleared: [] });
    expect(no.err).toContain('app clear on');
    expect(no.err).toContain('was not allowed: its question got no yes, and nothing was done');
  });

  it('takes --yes for the answer, and with nobody to ask refuses, saying so', async () => {
    expect(await runOn(['clear', '--yes'], false)).toMatchObject({
      code: 0,
      cleared: ['dev.app'],
      asked: [],
    });
    const none = await runOn(['clear']);
    expect(none).toMatchObject({ code: 1, cleared: [] });
    expect(none.err).toContain('this client cannot ask');
    expect(none.err).toContain('--yes');
  });

  it('reads only a y or a yes as one, from the terminal', async () => {
    const answer = async (typed: string) => {
      const input = new PassThrough();
      const said = askOnTerminal('Clear?', input, new PassThrough());
      input.end(typed);
      return said;
    };
    expect(await answer('y\n')).toBe(true);
    expect(await answer(' YES \n')).toBe(true);
    expect(await answer('\n')).toBe(false);
    expect(await answer('yes please\n')).toBe(false);
  });
});
