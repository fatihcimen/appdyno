import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');

/**
 * What reboots, shuts down, erases or resets a device or simulator, or deletes a simulator or emulator, however a source
 * words it: in one string, as the words of a command array, or by a platform's own call. Words run together by quotes
 * and commas are one command, as `['simctl', 'erase', udid]` is `simctl erase`.
 */
const FORBIDDEN: Record<string, RegExp> = {
  'a reboot': /['"`]\s*reboot\b|\badb\b[^'"`\n]*\sreboot\b|\breboot\s*\(/,
  'a power command': /\bsvc[\s'",]+power\b|sys\.powerctl/,
  'a factory reset': /MASTER_CLEAR|factory[\s_-]?reset|wipe[\s_-]?(user)?[\s_-]?data/i,
  'the bootloader': /\bfastboot\b|\bbootloader\b/i,
  'a simulator erased or deleted':
    /\bsimctl[\s'",]+(erase|delete)\b|\[\s*['"](erase|delete)['"]|eraseContents/,
  'a phone rebooted or erased': /\bdevice[\s'",]+(reboot|erase|shutdown)\b|diagnostics_relay/,
  'an emulator deleted': /\bavd[\s'",]+delete\b|\bdelete[\s'",]+avd\b/i,
};

/**
 * Each simulator deleted, by who made it, and nothing else: each line here, in its file. `create` says how to remove what
 * it made and runs none of it; a device suite deletes the one it made, by the id `create` answered or by the name it
 * gave one that was not there before.
 */
const OWN: [string, RegExp][] = [
  ['packages/driver-apple/src/simulators.ts', /^return `xcrun simctl delete \$\{id\}`;$/],
  ['device-tests/simulator-create.test.ts', /^await simctl\.exec\(\['delete', made\]\);$/],
  [
    'device-tests/simulator-create.test.ts',
    /^expect\(r\.text\)\.toContain\(`xcrun simctl delete \$\{made\}`\);$/,
  ],
  [
    'device-tests/hub.test.ts',
    /^if \(named\(\)\) execFileSync\('xcrun', \['simctl', 'delete', MADE\], \{ stdio: 'ignore' \}\);$/,
  ],
];

/** Every language that can run a command: what drives a device, what builds and checks it, and what CI runs. */
const CODE = /\.(ts|mjs|js|kt|kts|swift|m|h|sh|ya?ml|rb)$/;

/** A source's lines that are code: a comment says what is done, and runs nothing. */
const codeLines = (text: string) =>
  text
    .split('\n')
    .map((line, i) => ({ n: i + 1, line: line.trim() }))
    .filter(({ line }) => line && !/^(\/\/|\/\*|\*|#(?!!))/.test(line));

const offences = (file: string, text: string) =>
  codeLines(text).flatMap(({ n, line }) =>
    Object.entries(FORBIDDEN)
      .filter(([, re]) => re.test(line))
      .filter(() => !OWN.some(([f, own]) => f === file && own.test(line)))
      .map(([what]) => `${file}:${n}: ${what}: ${line}`),
  );

const tracked = () =>
  execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    // a unit test drives fakes, and writes down here what it catches
    .filter(
      (f) => CODE.test(f) && !/^packages\/[^/]+\/test\//.test(f) && existsSync(join(root, f)),
    );

describe('a device', () => {
  const files = tracked();

  it('is never rebooted, erased or reset, nor a simulator deleted but by who made it, by any source', () => {
    expect(files.length).toBeGreaterThan(500);
    for (const kind of ['.kt', '.swift', '.m', '.sh', '.yml', '.mjs'])
      expect(
        files.some((f) => f.endsWith(kind)),
        kind,
      ).toBe(true);
    expect(files.flatMap((f) => offences(f, readFileSync(join(root, f), 'utf8')))).toEqual([]);
  });

  it('names only lines that are there', () => {
    const stale = OWN.filter(
      ([file, own]) =>
        !codeLines(readFileSync(join(root, file), 'utf8')).some(({ line }) => own.test(line)),
    );
    expect(stale).toEqual([]);
  });

  it('is told how to remove what `create` made, and nothing runs those words', () => {
    const using = files
      .filter((f) => readFileSync(join(root, f), 'utf8').includes('removedBy'))
      .sort();
    expect(using).toEqual([
      'packages/core/src/virtual.ts',
      'packages/driver-apple/src/simulators.ts',
      'packages/ops/src/control.ts',
    ]);
    const control = readFileSync(join(root, 'packages/ops/src/control.ts'), 'utf8');
    expect(control.match(/removedBy\b.*/g)).toEqual([
      "removedBy ? `: ${maker.removedBy(id)} removes it` : '';",
    ]);
  });

  it('catches what it is there to catch, however it is written', () => {
    const caught = (line: string) => offences('x.ts', line).length > 0;
    for (const line of [
      "await this.adb.exec(serial, 'reboot');",
      "adb.run(['-s', serial, 'reboot', 'bootloader'])",
      'execSync(`adb -s ${s} reboot`)',
      "sh('svc power reboot')",
      "sh('setprop sys.powerctl shutdown')",
      'am broadcast -a android.intent.action.MASTER_CLEAR',
      "sh('recovery --wipe_data')",
      "spawn(emulator, ['-avd', name, '-wipe-data'])",
      'RecoverySystem.rebootWipeUserData(context)',
      'powerManager.reboot(null)',
      "run('fastboot', ['erase', 'userdata'])",
      "this.simctl.exec(['erase', udid])",
      "run('xcrun', ['simctl', 'delete', 'all'])",
      'xcrun simctl erase all',
      '[device eraseContentsAndSettingsWithError:&error];',
      "ctl.json(['device', 'reboot', '--device', udid])",
      'xcrun devicectl device reboot --device X',
      "run(avdmanager(), ['delete', 'avd', '-n', name])",
    ])
      expect(caught(line), line).toBe(true);
    for (const line of [
      "await this.simctl.exec(['spawn', this.udid, 'defaults', 'delete', app]);",
      "await this.simctl.exec(['shutdown', assertUdid(udid)], 120_000);",
      '// an unplugged cable or a reboot',
      'assertEquals("true", AnimationScript.restore(listOf("a" to "1; reboot")))',
      '"escape": .escape, "space": .space, "enter": .enter, "delete": .delete, "tab": .tab,',
      'const forceStop = (pkg: string) => `am force-stop ${pkg}`;',
    ])
      expect(caught(line), line).toBe(false);
  });
});
