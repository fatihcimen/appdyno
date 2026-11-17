import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Stdio } from './clients.js';

/** Where people keep their tools besides what their shell says: Homebrew's, then a user's own and version managers'. */
const SYSTEM = ['/opt/homebrew/bin', '/usr/local/bin'];
const OWN = [
  '.local/bin',
  '.npm-global/bin',
  '.volta/bin',
  '.bun/bin',
  '.local/share/mise/shims',
  '.asdf/shims',
];
/** What the shell's PATH is read between: a shell's start may print a banner, a prompt or a warning around it. */
const MARK = '__appdyno_path__';
/** A shell that asks or hangs as it starts gives no PATH: the places above stand in. */
const SHELL_MS = 5_000;

const ran = promisify(execFile);

/** The newest Node that nvm keeps, where no shell said which. */
function nvmNode(home: string) {
  const dir = join(home, '.nvm/versions/node');
  if (!existsSync(dir)) return undefined;
  const newest = readdirSync(dir)
    .filter((v) => v.startsWith('v'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1);
  return newest && join(dir, newest, 'bin');
}

/** What a person's login shell says its PATH is, as their terminal starts it; undefined where it says nothing in time. */
export async function shellPath(shell: string, home: string, ms = SHELL_MS) {
  try {
    // printenv says it the same in any shell, fish's own list of paths too
    const { stdout } = await ran(
      shell,
      ['-l', '-i', '-c', `echo ${MARK}; /usr/bin/printenv PATH; echo ${MARK}`],
      {
        timeout: ms,
        // their own files, whatever this process was given: HOME may be another for a test
        env: { HOME: home, USER: userInfo().username, SHELL: shell, TERM: 'dumb' },
        encoding: 'utf8',
      },
    );
    return new RegExp(`${MARK}\\n(.*?)\\n${MARK}`).exec(stdout)?.[1];
  } catch {
    return undefined;
  }
}

/** Each folder once, and only those there are. */
export function pathOf(dirs: (string | undefined)[]) {
  return [...new Set(dirs.filter((d): d is string => !!d && existsSync(d)))].join(':');
}

let asked: Promise<string> | undefined;

/**
 * The PATH a person's terminal has, for what an app opened from the Dock runs: its own is `/usr/bin:/bin:/usr/sbin:/sbin`,
 * with no Node, npx or a client's command. Their login shell is asked once, and the usual places stand beside it.
 */
export function personPath(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  asked ??= (async () => {
    const { homedir: home, shell } = userInfo();
    const said = await shellPath(env.SHELL ?? shell ?? '/bin/zsh', home);
    return pathOf([
      ...(said?.split(':') ?? []),
      ...(env.PATH?.split(':') ?? []),
      ...SYSTEM,
      ...OWN.map((d) => join(home, d)),
      nvmNode(home),
    ]);
  })();
  return asked;
}

/** A command by its name, where a PATH has it; a path stays as it is. */
export function commandIn(path: string, name: string) {
  if (name.includes('/')) return name;
  return path
    .split(':')
    .map((dir) => join(dir, name))
    .find((file) => existsSync(file));
}

/** Where a client opened from the Dock finds what it runs: macOS gives it no PATH of a person's. */
export const DOCK_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

/**
 * What a client opened from the Dock is given to run: a command by name it would not find, so its whole path, and a PATH
 * with Node in it, as `npx` and the npm package's own command start by `env node`. One with a path stays as it is.
 */
export function forTheDock(server: Stdio, path = ''): Stdio {
  if (server.command.includes('/')) return server;
  const command = commandIn(path, server.command);
  const node = commandIn(path, 'node');
  if (!command) return server;
  return { ...server, command, ...(node && { env: { PATH: `${dirname(node)}:${DOCK_PATH}` } }) };
}
