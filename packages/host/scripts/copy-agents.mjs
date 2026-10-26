// Copies the agents into the package: the built Android agent (agents/android/agent.apk, with its
// sha256) and the iOS runner's sources (agents/ios-src, built once on first use where no build is).
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const built = join(pkg, '../../android/agent/build/outputs/apk/debug/agent-debug.apk');
if (!existsSync(built)) {
  console.error(`no agent build at ${built}: run ./gradlew :agent:assembleDebug in android/`);
  process.exit(1);
}
const out = join(pkg, 'agents/android');
mkdirSync(out, { recursive: true });
copyFileSync(built, join(out, 'agent.apk'));
const sha = createHash('sha256').update(readFileSync(built)).digest('hex');
writeFileSync(join(out, 'agent.apk.sha256'), `${sha}\n`);
console.log(`agent.apk ${sha.slice(0, 12)}`);

// the iOS runner: project, runner, its core and the fixture (no build products)
const ios = join(pkg, '../../ios');
const dest = join(pkg, 'agents/ios-src');
rmSync(dest, { recursive: true, force: true });
for (const part of ['Appdyno.xcodeproj', 'Runner', 'RunnerCore/Sources', 'Fixture'])
  cpSync(join(ios, part), join(dest, part), { recursive: true, filter: (p) => !/xcuserdata|\.build|\.derived/.test(p) });
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d).sort()) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(dest);
const h = createHash('sha256');
for (const f of files) h.update(relative(dest, f)).update(readFileSync(f));
const srcSha = h.digest('hex');
writeFileSync(join(dest, 'sources.sha256'), `${srcSha}\n`);
console.log(`ios-src ${files.length} files ${srcSha.slice(0, 12)}`);
