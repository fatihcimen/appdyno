import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const workflows = join(root, '.github/workflows');
const SUITES = ['ios', 'keys', 'views.simulator', 'flows-ci'].map(
  (name) => `device-tests/${name}.test.ts`,
);

/** The tools the script runs, each one that writes down its words: no simulator is made here, and nothing is built. */
const FAKES = {
  xcrun: `case "$*" in
  "simctl list runtimes -j") cat "$FAKE/runtimes.json" ;;
  "--sdk iphonesimulator --show-sdk-version") echo 26.5 ;;
  "simctl create "*) echo FAKE-UDID ;;
esac`,
  xcodebuild: `[ "$1" = -version ] && printf 'Xcode 26.5\\nBuild version 17F42\\n'
exit 0`,
  pnpm: `for word in "$@"; do
  case $word in --outputFile.json=*) cp "$FAKE/report.json" "\${word#*=}" ;; esac
done
exit "$FAKE_VITEST"`,
};

const runtime = (version: string, isAvailable = true) => ({
  name: `iOS ${version}`,
  version,
  buildversion: 'B1',
  identifier: `runtime.${version}`,
  isAvailable,
  supportedDeviceTypes: ['iPhone 9', 'iPhone 17 Pro', 'iPhone 17', 'iPhone 16', 'iPad Air'].map(
    (name) => ({ name, identifier: `type.${name.replaceAll(' ', '-')}` }),
  ),
});

/** A run of the script on those tools: each suite's tests by their statuses, and what vitest exits with. */
function run(statuses: string[][], vitest = 0) {
  const fake = mkdtempSync(join(tmpdir(), 'appdyno-smoke-'));
  for (const [name, body] of Object.entries(FAKES)) {
    writeFileSync(join(fake, name), `#!/bin/sh\necho "${name} $*" >>"$FAKE/log"\n${body}\n`);
    chmodSync(join(fake, name), 0o755);
  }
  const runtimes = [runtime('18.6'), runtime('26.5'), runtime('27.2'), runtime('27.4', false)];
  writeFileSync(join(fake, 'runtimes.json'), JSON.stringify({ runtimes }));
  const testResults = SUITES.map((file, i) => ({
    name: join(root, file),
    startTime: 1_000,
    endTime: 62_400,
    assertionResults: (statuses[i] ?? ['passed']).map((status) => ({ status })),
  }));
  writeFileSync(join(fake, 'report.json'), JSON.stringify({ testResults }));
  const r = spawnSync(process.execPath, [join(root, 'scripts/sim-smoke.mjs'), join(fake, 'out')], {
    encoding: 'utf8',
    env: {
      PATH: `${fake}:/usr/bin:/bin`,
      FAKE: fake,
      FAKE_VITEST: String(vitest),
      GITHUB_SHA: 'abc',
    },
  });
  return {
    status: r.status,
    stderr: r.stderr,
    log: readFileSync(join(fake, 'log'), 'utf8').trim().split('\n'),
    summary: readFileSync(join(fake, 'out/device-summary.md'), 'utf8'),
  };
}

describe('the simulator smoke', () => {
  it("makes a simulator of the Xcode's own runtime, runs each suite on it and deletes it", () => {
    const r = run([]);
    expect(r.status).toBe(0);
    // the newest iPhone with a plain name, on the runtime of the SDK and not the newest there is
    expect(r.log.join('\n')).toMatch(
      /^xcrun simctl create appdyno-ci-\d+ type\.iPhone-17 runtime\.26\.5$/m,
    );
    expect(r.log).toContain('xcrun simctl bootstatus FAKE-UDID -b');
    const suites = r.log.find((line) => line.startsWith('pnpm exec vitest run'));
    for (const file of SUITES) {
      expect(suites).toContain(file);
      expect(existsSync(join(root, file)), file).toBe(true);
    }
    expect(r.log.at(-1)).toBe('xcrun simctl delete FAKE-UDID');
    expect(r.summary).toMatch(
      /\| device \| OS \| Xcode \| date \|\n\| --- \| --- \| --- \| --- \|\n\| iPhone 17 simulator \| iOS 26\.5 \(B1\) \| 26\.5 \(17F42\) \| \d{4}-\d\d-\d\d \|/,
    );
    expect(r.summary).toContain('Commit `abc`.');
    expect(r.summary).toContain('| ios.test.ts | 1 | 0 | 0 | 61 |');
  });

  it('fails where a suite ran nothing, which vitest calls a pass, and deletes its simulator all the same', () => {
    const r = run([['passed'], ['skipped', 'pending']]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('ran nothing: keys.test.ts');
    expect(r.summary).toContain('| keys.test.ts | 0 | 0 | 2 | 61 |');
    expect(r.log.at(-1)).toBe('xcrun simctl delete FAKE-UDID');
  });

  it('exits as vitest did, with the summary written', () => {
    const r = run([['passed', 'failed']], 1);
    expect(r.status).toBe(1);
    expect(r.summary).toContain('| ios.test.ts | 1 | 1 | 0 | 61 |');
  });
});

describe('the workflows', () => {
  const text = (name: string) => readFileSync(join(workflows, name), 'utf8');

  it('name no npm token: a release is published as a trusted publisher alone', () => {
    const named = readdirSync(workflows).filter((f) => /NPM_TOKEN|NODE_AUTH_TOKEN/.test(text(f)));
    expect(named).toEqual([]);
    expect(text('release.yml')).toMatch(/id-token: write[^]*npm publish --provenance/);
  });

  it('publish a tag only after the simulator job, and attach what it said', () => {
    const release = text('release.yml');
    expect(text('ci.yml')).toMatch(/\n {2}sim-smoke:\n(?! {4}(if|continue-on-error):)/);
    expect(release).toMatch(/gate:\n {4}uses: \.\/\.github\/workflows\/ci\.yml/);
    expect(release).toMatch(/publish:\n {4}needs: gate/);
    expect(release).toMatch(/name: sim-smoke[^]*device-summary\.md/);
  });
});
