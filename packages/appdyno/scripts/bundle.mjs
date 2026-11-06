// The one package: the workspace and every dependency inlined in dist (installing it needs no registry),
// the workspace's types beside them, and the agents the driver packages made.
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE_PARTS, VIEWER_TEST_FILES } from '@appdyno/core';
import { DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { build } from 'esbuild';
import { bundledPackages, noticesFor } from './notices.mjs';
import { publishedReadme } from './published-readme.mjs';
import { toolsInterface } from './tool-types.mjs';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(pkg, 'dist');
/** @type {import('esbuild').BuildOptions} */
const options = {
  absWorkingDir: pkg,
  // not tsconfig.json: its paths lead to the sources, and what was type-checked is each package's dist
  tsconfig: 'tsconfig.build.json',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: 'dist',
  logLevel: 'warning',
};

const main = await build({
  ...options,
  entryPoints: ['src/main.ts', 'src/index.ts'],
  bundle: true,
  metafile: true,
  // the CJS code inside (ajv) requires Node's modules
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
});
// their own files, found at run time: what a build with this folder gone simply does not have
const metafiles = [main.metafile];
const stream = '../driver-apple/src/phone-stream';
if (existsSync(stream)) {
  const worker = await build({
    ...options,
    entryPoints: ['index', 'worker'].map((f) => ({
      in: `${stream}/${f}.ts`,
      out: `phone-stream/${f}`,
    })),
    bundle: true,
    metafile: true,
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
    },
  });
  metafiles.push(worker.metafile);
}
chmodSync(join(dist, 'main.js'), 0o755);

// the public face and nothing behind it: the workspace is inlined, and shows no types
const PUBLIC = ['index.d.ts', 'library.d.ts'];
for (const f of readdirSync(dist))
  if (f.endsWith('.d.ts') && !PUBLIC.includes(f)) rmSync(join(dist, f));
const face = join(dist, 'library.d.ts');
const interfaceInSource = /export interface Tools \{[\s\S]*?\n\}/;
const declared = readFileSync(face, 'utf8');
if (!interfaceInSource.test(declared)) throw new Error('library.d.ts has no Tools to fill in');
const ops = Object.values(opsFor(new ServerContext(DEFAULT_POLICY, [])));
writeFileSync(face, declared.replace(interfaceInSource, toolsInterface(ops)));

// a stranger's project: this package's types alone, with no zod in reach and every declaration checked
const stranger = mkdtempSync(join(tmpdir(), 'appdyno-types-'));
try {
  const installed = join(stranger, 'node_modules/appdyno');
  mkdirSync(join(installed, 'dist'), { recursive: true });
  for (const f of PUBLIC) cpSync(join(dist, f), join(installed, 'dist', f));
  writeFileSync(join(installed, 'package.json'), readFileSync(join(pkg, 'package.json')));
  cpSync(join(pkg, 'examples/drive.ts'), join(stranger, 'drive.ts'));
  writeFileSync(
    join(stranger, 'tsconfig.json'),
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
      files: ['drive.ts'],
    }),
  );
  execFileSync(join(pkg, '../../node_modules/.bin/tsc'), ['-p', stranger], { stdio: 'inherit' });
} finally {
  rmSync(stranger, { recursive: true, force: true });
}

const agents = join(pkg, 'agents');
rmSync(agents, { recursive: true, force: true });
const { agent, ios, mac, viewer } = NATIVE_PARTS;
const packed = (from, part, filter = () => true) =>
  cpSync(from, join(agents, part.packaged), { recursive: true, filter });
const android = join(pkg, '../driver-android/agents', agent.packaged);
if (existsSync(android)) packed(android, agent);
packed(join(pkg, '../driver-apple/agents', ios.packaged), ios);
packed(join(pkg, '../..', viewer.repo), viewer, (f) => !VIEWER_TEST_FILES.test(basename(f)));
packed(join(pkg, '../..', mac.repo), mac);

// what a registry shows, and what has to travel with copies of the code inlined above
const { repository } = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
writeFileSync(
  join(pkg, 'README.md'),
  publishedReadme(readFileSync(join(pkg, '../../README.md'), 'utf8'), repository.url),
);
writeFileSync(
  join(pkg, 'THIRD_PARTY_NOTICES'),
  noticesFor(
    readFileSync(join(pkg, '../../THIRD_PARTY_NOTICES'), 'utf8'),
    bundledPackages(metafiles, pkg),
  ),
);

for (const f of ['main.js', 'index.js'])
  console.log(`${f} ${(statSync(join(dist, f)).size / 1e6).toFixed(1)} MB`);
