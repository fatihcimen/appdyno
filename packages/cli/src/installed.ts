import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Check } from '@appdyno/core';

export type Manifest = {
  name: string;
  version: string;
  repository?: string | { url?: string };
};

export const manifestOf = (root: string) =>
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest;

/** A repository's address as a provenance statement has it. */
export const repositoryOf = ({ repository }: Manifest) =>
  (typeof repository === 'string' ? repository : repository?.url)
    ?.replace(/^git\+/, '')
    .replace(/\.git$/, '');

/** A manager this command can drive. */
export type Manager = { by: 'npm'; prefix: string } | { by: 'pnpm' };
/** Appdyno.app, which keeps its own package and replaces itself. */
export type TheApp = { by: 'the app'; bundle: string };
/** What keeps a copy, or what to do instead where this command cannot change it. */
export type Installed = Manager | TheApp | { by: string; instead: string };

/** Where the app keeps the package. */
const IN_THE_APP = /^(.+\.app)\/Contents\/Resources\/app$/;
/** Opened where it was downloaded, or from its disk image: both places are gone by the next open. */
const PASSING_THROUGH = /\/AppTranslocation\/|^\/Volumes\/Appdyno/;

/** Where pnpm 10, and pnpm 11 and 12, really keep a global package. */
const PNPM_GLOBAL = /\/global\/\d+\/\.pnpm\/|\/store\/v\d+\/links\//;
const ONE_OFF = '/_npx/';
/** These hold a `lib/node_modules` too, but the prefix is another manager's to change. */
const OTHER_MANAGER = /\/(Cellar|\.volta|nix\/store)\//;

/** By the real path alone: no program is started, so this says the same with no network and no npm. */
export function installedBy(root: string, name: string): Installed {
  // the published package has no sources
  if (existsSync(join(root, 'src/main.ts')))
    return {
      by: 'a source checkout',
      instead: 'update the checkout: git pull, then pnpm install && pnpm build',
    };
  const [, bundle] = IN_THE_APP.exec(root) ?? [];
  if (bundle !== undefined)
    return PASSING_THROUGH.test(root)
      ? {
          by: 'an app not yet in Applications',
          instead: 'drag Appdyno to Applications, and open it from there',
        }
      : { by: 'the app', bundle };
  if (root.includes(ONE_OFF))
    return {
      by: 'a one-off npx run',
      instead: `npx takes the registry's latest by itself, unverified, so there is nothing to update: npm install -g ${name} once, and ${name} update moves that install, which npx then runs too`,
    };
  if (OTHER_MANAGER.test(root))
    return {
      by: 'kept by another manager',
      instead: `upgrade it with what installed it: its package manager`,
    };
  if (PNPM_GLOBAL.test(root)) return { by: 'pnpm' };
  const global = `/lib/node_modules/${name}`;
  if (root.endsWith(global)) return { by: 'npm', prefix: root.slice(0, -global.length) };
  return {
    by: 'kept by no manager known here',
    instead: `upgrade it with what installed it, or npm install -g ${name} for one this command can update`,
  };
}

/** What a client or a terminal runs, where the app is what is installed. */
export const appCommand = (bundle: string) => join(bundle, 'Contents/Resources/bin/appdyno');

/** A client's entry for this copy; none where the npm package's is the right one. */
export function serverOf(root: string, name: string) {
  const place = installedBy(root, name);
  return 'bundle' in place ? { command: appCommand(place.bundle), args: ['mcp'] } : undefined;
}

export const said = (place: Installed) =>
  'instead' in place ? place.by : `installed by ${place.by}`;

/** The line `doctor` gives this install. */
export function installCheck(root: string): Check {
  const { name, version } = manifestOf(root);
  return { name, ok: true, detail: `${version} at ${root}, ${said(installedBy(root, name))}` };
}
