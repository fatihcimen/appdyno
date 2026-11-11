import { createHash, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { deviceStateFile, must } from '@appdyno/core';
import { argumentsFor, DATA_LOSS, inCall, ToolError, type Op } from '@appdyno/ops';
import { z } from 'zod';

/** `ask`: a person at a terminal, to say yes to what loses data; none where nobody is there to answer. */
export type Io = {
  out: (line: string) => void;
  err: (line: string) => void;
  ask?: (question: string) => Promise<boolean>;
};

/** The question on stderr, as stdout is the answer's: only a y or a yes is one. */
export async function askOnTerminal(
  question: string,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stderr,
) {
  const line = createInterface({ input, output });
  try {
    return /^y(es)?$/i.test((await line.question(`${question} [y/N] `)).trim());
  } finally {
    line.close();
  }
}

/** Where a command line keeps its device and diff baseline: by folder, so two terminals are two sessions. */
export const cliSessionFile = (cwd = process.cwd()) =>
  deviceStateFile('cli', createHash('sha256').update(cwd).digest('hex'));

const dashed = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

type FlagSchema = {
  type?: string;
  properties?: Record<string, FlagSchema>;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

const schemaOf = (op: Op) =>
  // as a caller writes it: what has a default is not required
  z.toJSONSchema(op.input, { io: 'input' }) as {
    properties?: Record<string, FlagSchema>;
    required?: string[];
  };

/** An op's flags in words, from its schema. */
function helpOf(op: Op): string {
  const { properties = {}, required = [] } = schemaOf(op);
  const flags = Object.entries(properties).map(([key, p]) => {
    const value = p.enum ? p.enum.join('|') : (p.type ?? 'json');
    const notes = [
      required.includes(key) ? 'required' : undefined,
      p.description,
      p.default !== undefined ? `default ${JSON.stringify(p.default)}` : undefined,
    ].filter(Boolean);
    return `  --${dashed(key)}${p.type === 'boolean' ? '' : ` <${value}>`}${notes.length ? `  ${notes.join('; ')}` : ''}`;
  });
  return [
    `appdyno ${op.name.replaceAll('_', '-')} [flags]`,
    op.description,
    '',
    'flags:',
    ...flags,
    `  --json '{...}'  the arguments as JSON`,
    '  --out <file>  where an image goes',
    ...(properties.device
      ? []
      : ['  --device <serial>  the device, for this command and the next ones']),
    ...(Object.keys(DATA_LOSS).some((k) => k.startsWith(`${op.name} `))
      ? ['  --yes  yes to what would ask before it loses data']
      : []),
  ].join('\n');
}

/** Removes `--flag value` from the words; the value. */
export function takeFlag(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(`--${flag}`);
  if (i < 0) return undefined;
  const [, value] = argv.splice(i, 2);
  return value;
}

/** The device a command's words name for the whole process; `use-device` takes its own as an argument. */
export const deviceFlag = (command: string | undefined, argv: string[]) =>
  command === 'use-device' ? undefined : takeFlag(argv, 'device');

/** One operation on the command line: exit code 0, 1 when refused, 2 when the words make no call. */
export type Command = {
  name: string;
  description: string;
  run: (argv: string[], io: Io) => Promise<number>;
};

const camel = (flag: string) => flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** `--flag value` and `--json '{...}'` as the op's arguments, typed by its input schema. */
function parse(op: Op, argv: string[]) {
  const { properties = {} } = schemaOf(op);
  // a selector's words as flags: taken, so that the op refuses them as it does over MCP, saying where they go
  const words = properties.selector?.properties ?? {};
  const json = (flag: string, word: string) => {
    try {
      return JSON.parse(word) as unknown;
    } catch {
      throw new ToolError(`--${flag} needs JSON: ${word}`, 'INVALID_ARGUMENT');
    }
  };
  const args: Record<string, unknown> = {};
  let out: string | undefined;
  let yes = false;
  for (let i = 0; i < argv.length; i++) {
    const word = must(argv[i], 'a word');
    // `record start`: the first bare word of an op with actions
    if (i === 0 && !word.startsWith('--') && properties.action?.enum?.includes(word)) {
      args.action = word;
      continue;
    }
    if (!word.startsWith('--')) throw new ToolError(`unexpected word: ${word}`, 'INVALID_ARGUMENT');
    const flag = word.slice(2);
    // the person's answer to a question the op would ask, and no argument of it
    if (flag === 'yes') {
      yes = true;
      continue;
    }
    const key = camel(flag);
    const known = properties[key] ?? words[key];
    const type = known?.type;
    if (type === 'boolean') {
      const next = argv[i + 1];
      args[key] = next === 'true' || next === 'false' ? argv[++i] === 'true' : true;
      continue;
    }
    if (flag !== 'json' && flag !== 'out' && !known)
      throw new ToolError(
        `no --${flag} here; flags: ${Object.keys(properties)
          .map((k) => `--${dashed(k)}`)
          .join(' ')}`,
        'INVALID_ARGUMENT',
      );
    const value = argv[++i];
    if (value === undefined) throw new ToolError(`--${flag} needs a value`, 'INVALID_ARGUMENT');
    if (flag === 'json') Object.assign(args, json(flag, value));
    else if (flag === 'out') out = value;
    else if (type === 'number' || type === 'integer') args[key] = Number(value);
    else if (type === 'array' || type === 'object') args[key] = json(flag, value);
    else args[key] = value;
  }
  // an op that saves by name itself takes the format from it; bytes written here would be its reply's, and an image it
  // shows beside the file would be written over it
  if (out && properties.file && properties.overwrite)
    Object.assign(args, {
      file: out,
      overwrite: true,
      ...(properties.inline && { inline: false }),
    });
  return { args: argumentsFor(op, args, '--'), out, yes };
}

const FLOW_VALUES = new Set([
  '--action',
  '--app',
  '--file',
  '--to',
  '--from',
  '--params',
  '--env-file',
  '--iterations',
  '--scenario',
  '--json',
  '--out',
]);

/** `flow run a.flow --from 3 --param A=1` as the op's flags: action, file, then the rest. */
export function flowWords(argv: string[]): string[] {
  const out: string[] = [];
  const params: string[] = [];
  const named = ['--action', '--file'];
  for (let i = 0; i < argv.length; i++) {
    const word = must(argv[i], 'a word');
    if (word === '--param') params.push(argv[++i] ?? '');
    else if (FLOW_VALUES.has(word)) out.push(word, argv[++i] ?? '');
    else if (word.startsWith('--')) out.push(word);
    else {
      const flag = named.shift();
      if (flag === undefined) throw new ToolError(`unexpected word: ${word}`, 'INVALID_ARGUMENT');
      out.push(flag, word);
    }
  }
  return params.length > 0 ? [...out, '--params', JSON.stringify(params)] : out;
}

/** One command per op, named with dashes: its text blocks are printed; an image goes to a file. */
export function commandsFor(ops: Record<string, Op>): Record<string, Command> {
  const commands = Object.values(ops).map((op): Command => {
    const name = op.name.replaceAll('_', '-');
    return {
      name,
      description: op.description,
      run: async (argv, io) => {
        if (argv.includes('--help') || argv.includes('-h')) {
          io.out(helpOf(op));
          return 0;
        }
        let call;
        try {
          call = parse(op, op.name === 'flow' ? flowWords(argv) : argv);
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
          io.err(`${name}: ${e.message}`);
          if (e.hint) io.err(`  ${e.hint}`);
          return 2;
        }
        const ask = call.yes ? () => Promise.resolve(true) : io.ask;
        try {
          const { blocks, data } = await inCall(ask ? { ask } : {}, () => op.handler(call.args));
          for (const b of blocks) {
            if (b.type === 'text') {
              io.out(b.text);
              continue;
            }
            const file =
              call.out ??
              join(
                tmpdir(),
                `appdyno-${randomBytes(4).toString('hex')}.${String(b.mimeType.split('/')[1])}`,
              );
            await writeFile(file, Buffer.from(b.data, 'base64'));
            io.out(file);
          }
          // a gate says so with its exit code
          return typeof data.exitCode === 'number' ? data.exitCode : 0;
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
          io.err(`${e.code}: ${e.message}`);
          if (e.hint && !e.message.endsWith(e.hint)) io.err(`  ${e.hint}`);
          return 1;
        }
      },
    };
  });
  return Object.fromEntries(commands.map((c) => [c.name, c]));
}

const LINE_WIDTH = 100;

/** A description's first sentence, whole, or cut at a word and marked as cut. */
const firstSentence = (description: string) => {
  const s = /^.*?\.(?=\s|$)/s.exec(description)?.[0] ?? description;
  return s.length <= LINE_WIDTH ? s : `${s.slice(0, s.lastIndexOf(' ', LINE_WIDTH))} …`;
};

/** Every command, one line each: its first sentence. */
export const listOf = (ops: Record<string, Op>) =>
  Object.values(ops)
    .map((op) => {
      const name = op.name.replaceAll('_', '-');
      return `  ${name.padEnd(16)} ${firstSentence(op.description)}`;
    })
    .join('\n');
