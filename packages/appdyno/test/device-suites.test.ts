import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const SCRIPT = join(root, 'scripts/device-suites.mjs');
const suites = join(root, 'device-tests');

const run = (...args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
const on = (serial: string) => {
  const [variable, ...files] = run('of', serial).stdout.trim().split('\n');
  return { variable, files };
};

const SIMULATOR = '00000000-0000-4000-8000-000000000001';
const IPHONE = '00001234-0123456789ABCDEF';

/** Each names its own device, by a variable of its own: nothing here can take it for one device alone. */
const OWN_GATE = [
  'hub.clients.test.ts',
  'hub.connect.sim.test.ts',
  'hub.connect.test.ts',
  'hub.driving.test.ts',
  'hub.room.test.ts',
  'hub.shared.test.ts',
  'mirror.pair.test.ts',
  'trace-temp.test.ts',
];

describe('which suites a device can take', () => {
  it('goes by the kind of id it was given', () => {
    expect(on('emulator-5612').variable).toBe('APPDYNO_ANDROID_SERIAL');
    expect(on('EXAMPLE0SERIAL00').variable).toBe('APPDYNO_ANDROID_SERIAL');
    expect(on(SIMULATOR).variable).toBe('APPDYNO_IOS_UDID');
    expect(on(IPHONE).variable).toBe('APPDYNO_IPHONE_UDID');
  });

  it('lists the files that read its variable, and only those', () => {
    const android = on('emulator-5612').files;
    expect(android).toContain('device-tests/android.test.ts');
    expect(android).toContain('device-tests/mirror.android.test.ts');
    expect(android).not.toContain('device-tests/ios.test.ts');
    expect(on(SIMULATOR).files).toContain('device-tests/mirror.simulator.test.ts');
    expect(on(IPHONE).files).toContain('device-tests/iphone.test.ts');
  });

  it('leaves no suite with no place: a device takes it, or it gates itself and is named here', () => {
    const taken = new Set(
      ['emulator-5612', SIMULATOR, IPHONE].flatMap((serial) =>
        on(serial).files.map((f) => f.replace('device-tests/', '')),
      ),
    );
    const all = readdirSync(suites).filter((f) => f.endsWith('.test.ts'));
    expect(all.filter((f) => !taken.has(f)).sort()).toEqual(OWN_GATE);
  });

  it('refuses a call with nothing to go by', () => {
    expect(run('of').status).toBe(2);
    expect(run().status).toBe(2);
  });
});

describe('a run of a suite', () => {
  const report = (counts: Record<string, number>) => {
    const file = join(mkdtempSync(join(tmpdir(), 'appdyno-suites-')), 'report.json');
    writeFileSync(file, JSON.stringify(counts));
    return run('check', file);
  };

  it('that skipped all it holds is told from one that passed', () => {
    const none = report({ numPassedTests: 0, numFailedTests: 0, numTotalTests: 21 });
    expect(none.status).toBe(3);
    expect(none.stdout).toContain('ran nothing: all 21 tests skipped');
  });

  it('that ran anything is left to its own exit code', () => {
    expect(report({ numPassedTests: 1, numFailedTests: 0, numTotalTests: 21 }).status).toBe(0);
    expect(report({ numPassedTests: 0, numFailedTests: 1, numTotalTests: 21 }).status).toBe(0);
  });
});

describe('ci.sh', () => {
  const ci = join(root, 'scripts/ci.sh');

  it('parses', () => {
    expect(spawnSync('zsh', ['-n', ci], { encoding: 'utf8' }).stderr).toBe('');
  });

  it('will not run the iPhone suites with no fixture, before it starts anything', () => {
    const { APPDYNO_IPHONE_FIXTURE_APP: _left, ...env } = process.env;
    const r = spawnSync('zsh', [ci, '--iphone', IPHONE], { encoding: 'utf8', env });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('APPDYNO_IPHONE_FIXTURE_APP');
  });

  it('has every suite it names, as a path that moved would pass by skipping', () => {
    const named = [...readFileSync(ci, 'utf8').matchAll(/device-tests\/([\w.-]+\.test\.ts)/g)];
    expect(named.length).toBeGreaterThan(5);
    const all = readdirSync(suites);
    expect(named.map((m) => must(m[1], 'a suite')).filter((f) => !all.includes(f))).toEqual([]);
  });

  it('goes through the check that tells nothing from a pass, on every suite it names', () => {
    const text = readFileSync(ci, 'utf8');
    expect(text.match(/vitest run --config/g)).toHaveLength(1);
    expect(text).toMatch(/ran\(\) \{[^]*device-suites\.mjs check/);
  });
});
