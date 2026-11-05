// The one package: the workspace and every dependency inlined in dist (installing it needs no registry),
// the workspace's types beside them, and the agents the driver packages made.
import {
  chmodSync,
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { bundledPackages, noticesFor } from './notices.mjs';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(pkg, 'dist');
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
// not bundled: its import of ./main.js stays, so that there is one copy
await build({ ...options, entryPoints: ['src/mcp-bin.ts'] });
for (const bin of ['main.js', 'mcp-bin.js']) chmodSync(join(dist, bin), 0o755);

// what dist/index.d.ts reaches; the other workspace packages are inlined and show no types
const TYPED = ['protocol', 'core', 'perf', 'driver-android', 'driver-apple'];
const types = join(dist, 'types');
for (const name of TYPED)
  cpSync(join(pkg, '..', name, 'dist'), join(types, name), {
    recursive: true,
    filter: (p) => statSync(p).isDirectory() || p.endsWith('.d.ts'),
  });
for (const f of readdirSync(dist, { recursive: true }))
  if (f.endsWith('.d.ts')) {
    const file = join(dist, f);
    const text = readFileSync(file, 'utf8');
    const local = text.replace(/(['"])@appdyno\/([\w-]+)\1/g, (_, quote, name) => {
      if (!TYPED.includes(name)) throw new Error(`${f} reaches the types of @appdyno/${name}`);
      const path = relative(dirname(file), join(types, name, 'index.js'));
      return `${quote}${path.startsWith('.') ? path : `./${path}`}${quote}`;
    });
    if (local !== text) writeFileSync(file, local);
  }

const agents = join(pkg, 'agents');
rmSync(agents, { recursive: true, force: true });
cpSync(join(pkg, '../driver-android/agents/android'), join(agents, 'android'), { recursive: true });
cpSync(join(pkg, '../driver-apple/agents/ios-src'), join(agents, 'ios-src'), { recursive: true });
cpSync(join(pkg, '../../mirror/Viewer'), join(agents, 'mirror-src'), { recursive: true });
cpSync(join(pkg, '../../mac'), join(agents, 'mac-src'), { recursive: true });

// what a registry shows, and what has to travel with copies of the code inlined above
cpSync(join(pkg, '../../README.md'), join(pkg, 'README.md'));
writeFileSync(
  join(pkg, 'THIRD_PARTY_NOTICES'),
  noticesFor(
    readFileSync(join(pkg, '../../THIRD_PARTY_NOTICES'), 'utf8'),
    bundledPackages(metafiles, pkg),
  ),
);

for (const f of ['main.js', 'index.js'])
  console.log(`${f} ${(statSync(join(dist, f)).size / 1e6).toFixed(1)} MB`);
