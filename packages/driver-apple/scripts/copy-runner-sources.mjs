// Copies the iOS runner's sources into the package (agents/ios-src: project, runner, its core and the
// fixture, no build products), built once on first use where no build is.
import { createHash } from 'node:crypto';
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const ios = join(pkg, '../../ios');
const dest = join(pkg, 'agents/ios-src');
rmSync(dest, { recursive: true, force: true });
for (const part of ['Appdyno.xcodeproj', 'Runner', 'RunnerCore/Sources', 'Fixture', 'Branding'])
  cpSync(join(ios, part), join(dest, part), {
    recursive: true,
    filter: (p) => !/xcuserdata|\.build|\.derived/.test(p),
  });
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
