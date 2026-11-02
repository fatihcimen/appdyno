import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolError, type Op } from '@appdyno/ops';
import { z } from 'zod';

export type Io = { out: (line: string) => void; err: (line: string) => void };

/** One operation on the command line: exit code 0, 1 when refused, 2 when the words make no call. */
export type Command = {
  name: string;
  description: string;
  run: (argv: string[], io: Io) => Promise<number>;
};

const camel = (flag: string) => flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** `--flag value` and `--json '{...}'` as the op's arguments, typed by its input schema. */
function parse(op: Op, argv: string[]) {
  const { properties = {} } = z.toJSONSchema(op.input) as {
    properties?: Record<string, { type?: string }>;
  };
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
          .map((k) => `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`)
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
