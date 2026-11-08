// What a copy of the bundle has to carry: the notice of every package with code in it, as esbuild counted it, and of
// every package another one's build put inside its own files.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LICENSE_FILE = /^licen[sc]e(\.|$)/i;
const BETWEEN = `\n\n${'-'.repeat(72)}\n\n`;

/** The folder of each package with bytes in the output. A module tree-shaking emptied is not in the copy. */
export function bundledPackages(metafiles, root) {
  const folders = new Set();
  for (const { outputs } of metafiles)
    for (const { inputs } of Object.values(outputs))
      for (const [input, { bytesInOutput }] of Object.entries(inputs)) {
        const at = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
        if (at && bytesInOutput > 0) folders.add(join(root, at[1]));
      }
  return [...folders];
}

/** A package another's build inlined, by the region that build left around its code: its name and version. */
const INLINED = /^\/\/#region [^\n]*?node_modules\/\.pnpm\/((?:@[^/+]+\+)?[^/@]+)@([^/_]+)/gm;

/**
 * The folder holding the notice of each package inlined in a bundled one, which has no folder of its own to read:
 * `held` keeps one per package, at the version inlined, or the build stops.
 */
export function inlinedPackages(metafiles, root, held) {
  const found = new Map();
  for (const { outputs } of metafiles)
    for (const { inputs } of Object.values(outputs))
      for (const [input, { bytesInOutput }] of Object.entries(inputs))
        if (bytesInOutput > 0 && input.includes('node_modules/'))
          for (const [, name, version] of readFileSync(join(root, input), 'utf8').matchAll(INLINED))
            found.set(name.replace('+', '/'), version);
  return [...found].map(([name, version]) => {
    const folder = join(held, name);
    const manifest = join(folder, 'package.json');
    const kept = existsSync(manifest)
      ? JSON.parse(readFileSync(manifest, 'utf8')).version
      : undefined;
    if (kept !== version)
      throw new Error(
        `${name} ${version} is inlined in a bundled package, and ${folder} holds ${kept ? `the notice of ${kept}` : 'none'}`,
      );
    return folder;
  });
}

/** One package's notice. None to pass on stops the build, as the copy could not lawfully go out without it. */
function noticeOf(folder) {
  const { name, version, license } = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
  const file = readdirSync(folder).find((f) => LICENSE_FILE.test(f));
  if (!file) throw new Error(`${name} ${version} is bundled and has no license file to pass on`);
  return `${name} ${version} (${license})\n\n${readFileSync(join(folder, file), 'utf8').trim()}`;
}

/** The repository's own notices, then each bundled package's, in a stable order. */
export const noticesFor = (own, folders) =>
  `${[own.trim(), ...folders.map(noticeOf).sort()].join(BETWEEN)}\n`;
