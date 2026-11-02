import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolError, type Op } from '@appdyno/ops';
import { z } from 'zod';

export type Io = { out: (line: string) => void; err: (line: string) => void };

const dashed = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

type FlagSchema = {
  type?: string;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

const schemaOf = (op: Op) =>
  z.toJSONSchema(op.input) as {
    properties?: Record<string, FlagSchema>;
    required?: string[];
  };

/** An op's flags in words, from its schema. */
export function helpOf(op: Op): string {
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
    '  --device <serial>  the device, for this command and the next ones',
  ].join('\n');
}

/** Removes `--flag value` from the words; the value. */
export function takeFlag(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(`--${flag}`);
  if (i < 0) return undefined;
  const [, value] = argv.splice(i, 2);
  return value;
}

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
  const json = (flag: string, word: string) => {
    try {
      return JSON.parse(word) as unknown;
    } catch {
      throw new ToolError(`--${flag} needs JSON: ${word}`);
    }
  };
  const args: Record<string, unknown> = {};
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    if (!word.startsWith('--')) throw new ToolError(`unexpected word: ${word}`);
    const flag = word.slice(2);
    const key = camel(flag);
    const type = properties[key]?.type;
    if (type === 'boolean') {
      const next = argv[i + 1];
      args[key] = next === 'true' || next === 'false' ? argv[++i] === 'true' : true;
      continue;
    }
    if (flag !== 'json' && flag !== 'out' && !properties[key])
      throw new ToolError(
        `no --${flag} here; flags: ${Object.keys(properties)
          .map((k) => `--${dashed(k)}`)
          .join(' ')}`,
      );
    const value = argv[++i];
    if (value === undefined) throw new ToolError(`--${flag} needs a value`);
    if (flag === 'json') Object.assign(args, json(flag, value));
    else if (flag === 'out') out = value;
    else if (type === 'number' || type === 'integer') args[key] = Number(value);
    else if (type === 'array' || type === 'object') args[key] = json(flag, value);
    else args[key] = value;
  }
  const checked = op.input.safeParse(args);
  if (!checked.success)
    throw new ToolError(
      checked.error.issues
        .map((x) => `${x.path.length ? `--${x.path.join('.')}: ` : ''}${x.message}`)
        .join('; '),
    );
  return { args: checked.data as Record<string, unknown>, out };
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
          call = parse(op, argv);
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
          io.err(`${name}: ${e.message}`);
          return 2;
        }
        try {
          const { blocks } = await op.handler(call.args);
          for (const b of blocks) {
            if (b.type === 'text') {
              io.out(b.text);
              continue;
            }
            const file =
              call.out ??
              join(
                tmpdir(),
                `appdyno-${randomBytes(4).toString('hex')}.${b.mimeType.split('/')[1]}`,
              );
            await writeFile(file, Buffer.from(b.data, 'base64'));
            io.out(file);
          }
          return 0;
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
          io.err(e.message);
          return 1;
        }
      },
    };
  });
  return Object.fromEntries(commands.map((c) => [c.name, c]));
}

/** Every command, one line each: its first sentence. */
export const listOf = (ops: Record<string, Op>) =>
  Object.values(ops)
    .map((op) => {
      const name = op.name.replaceAll('_', '-');
      const first = /^.*?[.:](?:\s|$)/.exec(op.description)?.[0]?.trim() ?? op.description;
      return `  ${name.padEnd(16)} ${first}`;
    })
    .join('\n');
