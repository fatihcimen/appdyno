import { join } from 'node:path';
import { build } from 'esbuild';

const pkg = join(import.meta.dirname, '..');

/** A test's process, from the sources, as nothing here is built and a real one has no test runner to resolve them. */
export async function childFile(entry: string, outfile: string) {
  await build({
    absWorkingDir: pkg,
    entryPoints: [entry],
    tsconfig: 'tsconfig.json',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile,
    logLevel: 'silent',
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
    },
  });
  return outfile;
}
