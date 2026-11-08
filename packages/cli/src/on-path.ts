import { lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { call, failed, refuse, type Run } from './release.js';

/** On the PATH of every shell of a Mac by `/etc/paths`, and not a person's to write without a password. */
export const PATH_LINK = '/usr/local/bin/appdyno';

export type PathOptions = {
  /** Given, never looked up here, so that nothing but the caller can point this at a real home. */
  home: string;
  /** What the app runs, where it is now. */
  command: string;
  run: Run;
  link?: string;
  out: (line: string) => void;
};

/** The link's own target, in this person's home: a moved app repoints it with no password. */
const stableName = (home: string) => join(home, 'Library/Application Support/appdyno/appdyno');

function linkTo(target: string, name: string) {
  rmSync(name, { force: true });
  mkdirSync(dirname(name), { recursive: true });
  symlinkSync(target, name);
}

const targetOf = (link: string) => {
  try {
    return lstatSync(link).isSymbolicLink() ? readlinkSync(link) : `${link} itself`;
  } catch {
    return undefined;
  }
};

/** An AppleScript string, holding a shell word: a home can have a quote in it. */
const inScript = (word: string) => `quoted form of "${word.replace(/[\\"]/g, '\\$&')}"`;

/** The password dialog of the Mac itself, for a change only an administrator may make. */
async function withPassword(shell: string, o: PathOptions) {
  const script = `do shell script ${shell} with administrator privileges`;
  await call(o.run, '/usr/bin/osascript', ['-e', script], { timeout: 120_000 }).catch(
    (e: unknown) => {
      if (/User canceled|-128/.test((e as { stderr?: string }).stderr ?? ''))
        throw refuse('no change was made', 'CANCELLED', 'the password dialog was dismissed');
      throw failed(e, 'asking for an administrator');
    },
  );
}

/** `appdyno path`: this copy of the app on every shell's PATH, by two links. */
export async function putOnPath(o: PathOptions) {
  const link = o.link ?? PATH_LINK;
  const stable = stableName(o.home);
  const there = targetOf(link);
  if (there !== undefined && there !== stable)
    throw refuse(
      `${link} is not this app's: it leads to ${there}`,
      'UNSUPPORTED',
      'it is left as it is: remove it first, if you want this one',
    );
  linkTo(o.command, stable);
  if (there === undefined)
    try {
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(stable, link);
    } catch {
      const made = `"mkdir -p " & ${inScript(dirname(link))} & " && ln -s " & ${inScript(stable)} & " " & ${inScript(link)}`;
      await withPassword(made, o);
    }
  o.out(`appdyno is on the PATH: ${link}`);
  return 0;
}

/** `appdyno path --remove`: only what `appdyno path` made. */
export async function takeOffPath(o: PathOptions) {
  const link = o.link ?? PATH_LINK;
  const stable = stableName(o.home);
  if (targetOf(link) === stable)
    try {
      rmSync(link);
    } catch {
      await withPassword(`"rm " & ${inScript(link)}`, o);
    }
  rmSync(stable, { force: true });
  o.out('appdyno is off the PATH');
  return 0;
}

/** A moved app: its link follows it, and one that was never made is not made now. */
export function followMove(home: string, command: string) {
  const stable = stableName(home);
  if (targetOf(stable) !== undefined) linkTo(command, stable);
}
