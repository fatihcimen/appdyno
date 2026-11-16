import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { run } from '@appdyno/core';
import type { FlowStep } from '@appdyno/flows';
import { z } from 'zod';
import { approvePrepare } from '../approval.js';
import type { ServerContext } from '../context.js';
import type { Session } from '../session.js';
import { ToolError } from '../tool.js';
import { inside } from '../writes.js';

/** The project's own file: what each `prepare` step's name runs, a command as its words or a flow by its path. */
const CONFIG = join('.appdyno', 'test.json');

/** How long a preparation may take. */
const PREPARE_MS = 120_000;

const Config = z
  .object({ prepare: z.record(z.string(), z.union([z.array(z.string()).min(1), z.string()])) })
  .strict();

/**
 * A project's root for a flow in `dir`: the nearest folder at or above it that holds `.appdyno` or `.git`; with
 * neither, `dir` alone. A run started from any folder finds the same one.
 */
export function projectRoot(dir: string) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, '.appdyno')) || existsSync(join(d, '.git'))) return d;
    if (dirname(d) === d) return resolve(dir);
  }
}

/** What the project of a flow's file names, a command or a flow each, and where. */
function prepares(file: string) {
  const root = projectRoot(dirname(resolve(file)));
  const config = join(root, CONFIG);
  if (!existsSync(config)) return { root, config, named: undefined };
  try {
    return { root, config, named: Config.parse(JSON.parse(readFileSync(config, 'utf8'))).prepare };
  } catch (e) {
    throw new ToolError(
      `${config}: ${e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message}`,
      'INVALID_ARGUMENT',
      'it holds {"prepare": {"a-name": ["command", "argument"]}}',
    );
  }
}

/** The flow a `prepare` step's name stands for, where the project names one: its steps go in the step's place. */
export function preparedFlow(st: FlowStep, file: string): string | undefined {
  const { root, named } = prepares(file);
  const entry = named?.[String(st.args.name)];
  return typeof entry === 'string' ? resolve(root, entry) : undefined;
}

/** The command of a `prepare` step, by the name the project gives it: refused before a run where there is none. */
export function preparedCommand(st: FlowStep, file: string) {
  const { root, config, named } = prepares(file);
  const name = String(st.args.name);
  const argv = named?.[name];
  if (!Array.isArray(argv))
    throw new ToolError(
      `${st.file ?? file}:${st.line}: ${named ? `${config} names no preparation ${name}: ${Object.keys(named).join(', ') || 'it names none'}` : `prepare ${name} needs ${config}, which is not there`}`,
      'NOT_FOUND',
      'it holds {"prepare": {"a-name": ["command", "argument"]}}: a flow names a preparation, and only the project says what it runs',
    );
  const [command, ...args] = argv as [string, ...string[]];
  return { root, config, name, command, args, line: argv.join(' ') };
}

/** What a `prepare` step needs of its run. */
export type PreparePlace = {
  /** The flow's file, whose project names the command. */
  file: string;
  /** A person at a terminal started the run: the command runs with nothing asked. */
  prepares: boolean;
  /** The flow's secrets: a value given for one is hidden as any of them is. */
  secrets: string[];
  /** The names a person gave a value for, which stay theirs. */
  kept: ReadonlySet<string>;
};

/**
 * Runs a `prepare` step's command on this Mac, with no shell, in the project's root, and gives the values it printed
 * for the names the step lists. The project is one inside the folders this server writes in, and the command runs on a
 * person's yes unless one started the run at a terminal: a person who ran `appdyno test` ran the project's own
 * commands, as a test script's are.
 */
export async function prepared(
  ctx: ServerContext,
  s: Session,
  st: FlowStep,
  at: PreparePlace,
  clean: (text: string) => string,
): Promise<Record<string, string>> {
  const { file } = at;
  const { root, config, name, command, args, line } = preparedCommand(st, file);
  inside(ctx.policy, config);
  if (!at.prepares) await approvePrepare(ctx.policy, s, name, line);
  const env = {
    ...process.env,
    APPDYNO_DEVICE: s.device.serial,
    APPDYNO_PLATFORM: s.device.platform,
    APPDYNO_APP: s.appId ?? '',
    APPDYNO_FLOW: resolve(file),
  };
  const out = await run(command, args, { cwd: root, env, timeout: PREPARE_MS }).catch(
    (thrown: unknown) => {
      const e = thrown as Error & { code?: unknown; killed?: boolean; stderr?: string };
      const why = e.killed ? `did not end in ${PREPARE_MS / 1000} s` : `exit ${String(e.code)}`;
      const said = clean((e.stderr ?? e.message).trim().split('\n').slice(-5).join('\n'));
      throw new ToolError(`prepare ${name} failed (${line}: ${why})\n${said}`, 'CHECK_FAILED');
    },
  );
  const printed = new Map(
    out.stdout.split(/\r?\n/).flatMap((l): [string, string][] => {
      const at = l.indexOf('=');
      return at > 0 ? [[l.slice(0, at), l.slice(at + 1)]] : [];
    }),
  );
  const gives = (st.args.gives as string[] | undefined) ?? [];
  const missing = gives.filter((n) => !printed.has(n));
  if (missing.length > 0)
    throw new ToolError(
      `prepare ${name} printed no ${missing.join(', ')}: a value is a line NAME=value`,
      'CHECK_FAILED',
    );
  ctx.hide(at.secrets.flatMap((n) => printed.get(n) ?? []));
  return Object.fromEntries(
    gives.filter((n) => !at.kept.has(n)).map((n) => [n, printed.get(n) ?? '']),
  );
}
