// Copies the built Android agent into the package (agents/android/agent.apk) with its sha256.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
