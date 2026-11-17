import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunCase, RunRecord } from '@appdyno/flows';
import { assert, describe, expect, it } from 'vitest';

/**
 * `appdyno test` as a CI job runs it, by the built command line, on the fixture. The flake has a known cause:
 * the list's basket counts up and survives a `launch`, so a flow that expects 2 after one tap fails on a
 * fresh list and passes on what its first attempt left. On the device APPDYNO_ANDROID_SERIAL or
 * APPDYNO_IOS_UDID names.
 */
const APP = 'dev.appdyno.fixture';
const CLI = fileURLToPath(new URL('../packages/appdyno/dist/main.js', import.meta.url));
const LONG_MS = 300_000;
const PASSWORD = 'p4ss-w0rd-7788';

const targets = [
  ['android', process.env.APPDYNO_ANDROID_SERIAL ?? ''],
  ['ios', process.env.APPDYNO_IOS_UDID ?? ''],
] as const;

for (const [platform, serial] of targets)
  describe.skipIf(!serial)(`a CI job on ${platform}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-ci-'));
    const flows = join(dir, 'flows');
    mkdirSync(join(flows, 'shared'), { recursive: true });
    const write = (name: string, ...lines: string[]) => {
      writeFileSync(join(flows, name), `${lines.join('\n')}\n`);
      return join(flows, name);
    };
    const envFile = join(dir, 'ci.env');
    writeFileSync(envFile, `# the job's values\nWHO="Ayşe Yılmaz"\nPASSWORD_INPUT=${PASSWORD}\n`);
    const env = { ...process.env, APPDYNO_STATE_DIR: join(dir, 'state') };

    const appdyno = (...args: string[]) =>
      new Promise<{ code: number; out: string }>((resolve) => {
        execFile(
          process.execPath,
          [CLI, ...args],
          { env, timeout: LONG_MS, maxBuffer: 1 << 24 },
          (e, out, err) =>
            resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out: `${out}${err}` }),
        );
      });
    const job = async (name: string, ...args: string[]) => {
      const artifacts = join(dir, name);
      const junit = join(artifacts, 'junit.xml');
      const r = await appdyno(
        ...['test', '--device', serial, '--artifacts', artifacts, '--junit', junit],
        ...args,
      );
      process.stderr.write(`--- ${platform} ${name}, exit ${r.code}\n${r.out}\n---\n`);
      return { ...r, artifacts, junit: existsSync(junit) ? readFileSync(junit, 'utf8') : '' };
    };

    write('shared/start.flow', `app ${APP}`, 'stop', 'launch');
    write(
      'shared/form.flow',
      'param WHO',
      'secret PASSWORD_INPUT',
      'open_link "appdyno-fixture://open/form"',
      'type "${WHO}" id=name_input replace',
      'type "${PASSWORD_INPUT}" id=password_input',
      'tap id=submit',
      'assert id=result check=text equals="Sent: ${WHO}"',
    );
    write('a-form.flow', `app ${APP}`, 'tag ci', 'run shared/start.flow', 'run shared/form.flow');
    write(
      'b-list.flow',
      `app ${APP}`,
      'tag ci',
      'run shared/start.flow',
      'open_link "appdyno-fixture://open/list"',
      'wait_for id=add_button',
    );
    write(
      'c-counts.flow',
      `app ${APP}`,
      'tag ci',
      'launch',
      'wait_for id=add_button',
      'tap id=add_button index=2 !ambiguous',
      'assert text="In basket: 2" timeoutMs=1500',
    );
    write('z-nightly.flow', `app ${APP}`, 'tag nightly', 'assert text="No such" timeoutMs=500');

    it(
      'calls a flake flaky, with values from a file, by tag, through flows that run flows',
      async () => {
        const r = await job(
          'retried',
          flows,
          '--tag',
          'ci',
          '--env-file',
          envFile,
          '--retries',
          '1',
        );
        expect(r.code).toBe(0);
        expect(r.out).toContain('ok   a-form.flow');
        expect(r.out).toContain('ok   b-list.flow');
        expect(r.out).toContain('FLAKY c-counts.flow: passed on attempt 2 of 2');
        expect(r.out).toContain('2 passed, 1 flaky, 0 failed');
        expect(r.out).toContain('flaky, passed only on a retry');
        expect(r.junit).toContain('tests="3" failures="0"');
        expect(r.junit).toContain('flakes="1"');
        expect(r.junit).toMatch(/<flakyFailure message="line 6, step 4: .+" type="flow">/);
        expect(r.junit).not.toContain('z-nightly');
        expect(r.junit).not.toContain(PASSWORD);
        expect(r.junit).toContain('Sent: ${WHO}');
        const failed = join(r.artifacts, serial.replace(/[^\w.-]/g, '_'), 'c-counts.flow');
        expect(existsSync(join(failed, 'screen.jpg'))).toBe(true);
      },
      LONG_MS,
    );

    it(
      'fails the same flake with no retry: a failed step stays failed',
      async () => {
        const r = await job('plain', flows, '--tag', 'ci', '--env-file', envFile);
        expect(r.code).toBe(1);
        expect(r.out).toContain('FAIL c-counts.flow: line 6, step 4:');
        expect(r.out).toContain('2 passed, 0 flaky, 1 failed');
        expect(r.junit).toContain('tests="3" failures="1"');
        expect(r.junit).toContain('flakes="0"');
      },
      LONG_MS,
    );

    it(
      'leaves one verdict, a record and a page, and a command that runs a file alone as it ran',
      async () => {
        write(
          'f-form.flow',
          `app ${APP}`,
          'run shared/start.flow',
          'run shared/form.flow',
          'assert text="No such" timeoutMs=500',
        );
        const r = await job(
          'report',
          join(flows, 'a-form.flow'),
          join(flows, 'f-form.flow'),
          '--env-file',
          envFile,
        );
        expect(r.code).toBe(1);
        const read = (name: string) => readFileSync(join(r.artifacts, name), 'utf8');
        expect(read('verdict.txt')).toMatch(
          /^FAIL: 1 passed, 0 flaky, 1 failed on 1 device in \d+s\nbecause: 1 failed\nFAIL \S+ f-form\.flow line 4, step \d+: /,
        );
        const run = JSON.parse(read('run.json')) as RunRecord;
        expect(run).toMatchObject({
          schema: 1,
          verdict: 'FAIL',
          devices: [{ serial, virtual: true }],
        });
        expect(run.devices[0]?.os).toMatch(platform === 'ios' ? /^iOS \d/ : /^Android \d/);
        const [passed, failed] = run.cases;
        assert(passed && failed);
        expect(failed).toMatchObject({ label: 'f-form.flow', outcome: 'failed', app: { id: APP } });
        expect(failed.app?.version).toMatch(/^\d/);
        // the form holds a password field with the secret typed in it: the picture is painted, so it is a PNG
        const shot = failed.attempts[0]?.evidence.shot;
        expect(shot).toMatch(/f-form\.flow\/screen\.png$/);
        expect(
          readFileSync(join(r.artifacts, String(shot)))
            .subarray(1, 4)
            .toString(),
        ).toBe('PNG');
        expect(run.contents).toMatchObject({ shots: 1, painted: 1, trees: 1 });
        expect(r.junit).toContain(`[[ATTACHMENT|${join(r.artifacts, String(shot))}]]`);
        for (const name of ['run.json', 'verdict.txt', 'index.html', 'pr.md'])
          expect(read(name), name).not.toContain(PASSWORD);
        expect(read('index.html')).toContain('<p class="verdict fail">FAIL</p>');
        // each runs alone as it ran: the one that passed passes, the one that failed fails on the same step
        const alone = (c: RunCase, name: string) =>
          appdyno(...c.rerun.split(' ').slice(1), '--artifacts', join(dir, name));
        expect(passed.rerun).toBe(
          `appdyno test ${join(flows, 'a-form.flow')} --device ${serial} --env-file ${envFile}`,
        );
        expect((await alone(passed, 'again-passed')).code).toBe(0);
        const again = await alone(failed, 'again-failed');
        expect(again.code).toBe(1);
        expect(again.out).toContain('FAIL f-form.flow: line 4, step');
      },
      LONG_MS,
    );

    it(
      'runs a part of the files in each of two jobs, and merges them into one report',
      async () => {
        const parts = [];
        for (const i of [1, 2])
          parts.push(
            await job(
              `part-${i}`,
              flows,
              '--tag',
              'ci',
              '--env-file',
              envFile,
              '--shard',
              `${i}/2`,
            ),
          );
        expect(parts.map((p) => /shard \d\/2: (\d) of 3 files/.exec(p.out)?.[1])).toEqual([
          '2',
          '1',
        ]);
        const whole = join(dir, 'whole');
        const merged = await appdyno(
          'test',
          'merge',
          ...parts.map((p) => p.artifacts),
          '--out',
          whole,
        );
        const run = JSON.parse(readFileSync(join(whole, 'run.json'), 'utf8')) as RunRecord;
        expect(run.cases.map((c) => c.label).sort()).toEqual([
          'a-form.flow',
          'b-list.flow',
          'c-counts.flow',
        ]);
        expect(merged.code).toBe(run.verdict === 'PASS' ? 0 : 1);
        expect(merged.out).toContain(`report: ${join(whole, 'index.html')}`);
        const short = await appdyno(
          'test',
          'merge',
          String(parts[0]?.artifacts),
          '--out',
          join(dir, 'short'),
        );
        expect(short.code).toBe(1);
        expect(short.out).toContain('because: ');
        expect(short.out).toContain('shard 2/2 did not run');
      },
      LONG_MS,
    );

    it(
      'says which file a failure is in, and that a file ran itself, before touching anything',
      async () => {
        write('shared/miss.flow', 'launch', '', 'assert text="No such" timeoutMs=500');
        const nested = await job(
          'nested',
          write('d-nested.flow', `app ${APP}`, 'run shared/miss.flow'),
        );
        expect(nested.code).toBe(1);
        expect(nested.junit).toContain('message="miss.flow line 3, step 2:');

        write('shared/loop.flow', 'run ../e-loop.flow');
        const loop = await job(
          'loop',
          write('e-loop.flow', `app ${APP}`, 'stop', 'run shared/loop.flow'),
        );
        expect(loop.code).toBe(1);
        expect(loop.junit).toContain('a flow cannot run itself');
      },
      LONG_MS,
    );

    it(
      'runs a setup and a teardown around each file and each retry, a prepare command, and the checks a run makes',
      async () => {
        // in the state folder, which the command line may write in: a project of its own by its .appdyno
        const suite = join(dir, 'state', 'suite');
        mkdirSync(join(suite, '.appdyno'), { recursive: true });
        const seed = [process.execPath, '-e', "console.log('WHO=Deniz')"];
        writeFileSync(join(suite, '.appdyno', 'test.json'), JSON.stringify({ prepare: { seed } }));
        const put = (name: string, ...lines: string[]) =>
          writeFileSync(join(suite, name), `${lines.join('\n')}\n`);
        const other = platform === 'ios' ? 'android' : 'ios';
        put('_setup.flow', `app ${APP}`, 'param WHO', 'stop', 'launch', 'prepare seed gives=WHO');
        put('_teardown.flow', 'screenshot after', 'stop');
        put(
          'a-steps.flow',
          'param WHO',
          'open_link "appdyno-fixture://open/form"',
          'type "${WHO}" id=name_input replace',
          'type "pw-123456" id=password_input',
          'tap id=submit',
          'assert id=result check=text equals="Sent: ${WHO}"',
          'setting orientation landscape_left',
          'open_link "appdyno-fixture://open/list"',
          'wait_for id=add_button',
          'assert id=add_button check=count min=2 max=60',
          `only ${platform} assert id=add_button index=0 !ambiguous`,
          `only ${other}`,
          '  assert text="No such thing" timeoutMs=500',
          'end',
        );
        put(
          'b-fails.flow',
          'open_link "appdyno-fixture://open/list"',
          'assert id=add_button check=count equals=0 timeoutMs=500',
        );
        const r = await job('phases', suite, '--retries', '1');
        expect(r.code).toBe(1);
        expect(r.out).toContain("prepare seed runs the project's own command:");
        expect(r.out).toContain('ok   a-steps.flow');
        expect(r.out).toMatch(
          /FAIL b-fails\.flow: line 2, step 2: \d+ elements match id=add_button, not 0/,
        );
        expect(r.out).toContain("the failed attempt's teardown runs");
        expect(r.out).toContain('1 passed, 0 flaky, 1 failed');
        expect(r.junit).toContain('setup 1. stop');
        expect(r.junit).toContain('Sent: ${WHO}');
        expect(r.junit).not.toContain('Deniz');
        expect(r.junit).toContain(`skipped, ${other} only`);
        expect(r.junit).toContain('teardown 1. screenshot after');
        // the teardown ran after the pass and after each failed attempt: its picture is beside each file's evidence
        const kept = (file: string) => join(r.artifacts, serial.replace(/[^\w.-]/g, '_'), file);
        expect(existsSync(join(kept('a-steps.flow'), 'after.png'))).toBe(true);
        expect(existsSync(join(kept('b-fails.flow'), 'after.png'))).toBe(true);
        expect(existsSync(join(kept('b-fails.flow'), 'attempt-2', 'screen.jpg'))).toBe(true);
        if (platform === 'ios') {
          // a simulator has no rotation lock to write down, so its turn is not put back, and with the home screen
          // in front, as the teardown leaves it, the list reads rotation 0 turned or not: upright again, for what
          // runs next
          const upright = [
            '--device',
            serial,
            '--json',
            '{"name":"orientation","value":"portrait"}',
          ];
          expect((await appdyno('set-device', ...upright)).code).toBe(0);
        } else {
          // the turn a-steps made was put back once the file had run
          const info = await appdyno(
            ...['list-devices', '--device', serial, '--json', '{"selected":true}'],
          );
          expect(info.out).toContain('rotation 0');
        }
      },
      LONG_MS,
    );

    it(
      'exits 1 when the tags select nothing',
      async () => {
        const r = await job('none', join(flows, 'a-form.flow'), '--tag', 'no-such-tag');
        expect(r.code).toBe(1);
        expect(r.out).toContain('--tag no-such-tag');
      },
      LONG_MS,
    );
  });
