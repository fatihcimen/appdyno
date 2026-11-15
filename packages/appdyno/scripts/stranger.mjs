// A stranger's project: the package's types alone, with no zod and no Node types in reach, every declaration checked.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tsc = join(dirname(fileURLToPath(import.meta.url)), '../../../node_modules/.bin/tsc');

/** Each entry point's example, by the file it is in such a project. */
export const EXAMPLES = { 'drive.ts': 'examples/drive.ts', 'device.ts': 'examples/device.ts' };

/**
 * Type-checks `files` of `project`, which has the package under its `node_modules`, by this repo's compiler.
 * @param {string} project
 * @param {string[]} files
 * @param {NodeJS.ProcessEnv} [env]
 */
export function checkAsStranger(project, files, env = process.env) {
  writeFileSync(
    join(project, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        target: 'es2023',
        lib: ['es2023'],
        module: 'nodenext',
        types: [],
      },
      files,
    }),
  );
  execFileSync(tsc, ['-p', project], { stdio: 'inherit', env });
}
