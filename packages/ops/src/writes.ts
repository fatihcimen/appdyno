import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { stateDir } from '@appdyno/core';
import { byPerson, type Policy } from './policy.js';
import { ToolError } from './tool.js';

/** What exists of a path, a link at its end included: what lies past it has no link in it. */
const nearest = (p: string): string => {
  try {
    lstatSync(p);
    return p;
  } catch {
    return dirname(p) === p ? p : nearest(dirname(p));
  }
};

const real = (p: string) => {
  const at = nearest(p);
  try {
    return join(realpathSync(at), relative(at, p));
  } catch {
    return undefined;
  }
};

/**
 * The folder this server runs in, as a project's: a client that starts a server at the disk's root or in the home
 * folder gave it no project, and all of a disk or a home, with a shell's start files in it, is no folder to write in.
 */
function projectFolder() {
  const cwd = process.cwd();
  return cwd === parse(cwd).root || real(cwd) === real(homedir()) ? undefined : cwd;
}

type Folders = Pick<Policy, 'writeDirs'>;

/** The folders a tool call may write in: the project's, the state folder, and those the server was started with. */
export const writeFolders = (policy: Folders) => [
  ...[projectFolder()].filter((f) => f !== undefined),
  stateDir(),
  ...(policy.writeDirs ?? []).map((d) => resolve(d)),
];

/**
 * The path of a file or folder a client asked to have written, inside the folders this server writes in, and no other:
 * the client names the path, and the server's own command line sets the folders. A link that leads out is out. Every
 * tool that writes where its caller says comes through here, and with `itself` a project a tool builds, which may be
 * one of the folders.
 */
export function inside(policy: Folders, path: string, itself = false) {
  const to = resolve(path);
  const roots = writeFolders(policy);
  const under = (p: string | undefined, root: string | undefined) => {
    const r = p !== undefined && root !== undefined ? relative(root, p) : '..';
    return (itself || r !== '') && !r.startsWith('..') && !isAbsolute(r);
  };
  if (!roots.some((root) => under(to, root) && under(real(to), real(root))))
    throw new ToolError(
      `${to} is outside the folders this server writes to`,
      'POLICY_DENIED',
      `give a path inside ${roots.join(' or ')}; ${byPerson('by starting it with --allow-write and that folder (APPDYNO_ALLOW_WRITE)')}`,
    );
  return to;
}

/** A file and its folders: what is there stays unless `overwrite`. */
export function writeNew(path: string, text: string, overwrite: boolean | undefined) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, { flag: overwrite ? 'w' : 'wx' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST')
      throw new ToolError(`${path} exists: overwrite true replaces it`, 'INVALID_ARGUMENT');
    throw new ToolError(`cannot write ${path}: ${(e as Error).message}`, 'INVALID_ARGUMENT');
  }
  return path;
}

export const writeInside = (
  policy: Folders,
  path: string,
  text: string,
  overwrite: boolean | undefined,
) => writeNew(inside(policy, path), text, overwrite);
