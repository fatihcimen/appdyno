import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { assert, beforeAll, describe, expect, it } from 'vitest';
import type { OpData, OpName } from '@appdyno/ops';
import { Devicectl, IosSimulatorDevice } from './workspace.js';

/**
 * Flows on real devices: what an agent does through the MCP tools of the built server, replayed with no
 * model, then by the built command line as CI runs it. On the Android device APPDYNO_ANDROID_SERIAL names
 * and the simulator APPDYNO_IOS_UDID names; Android runs first, and the simulator replays its recording.
 *
 * What the two fixtures share: the bundle id, the link scheme, `name_input`, `password_input`, `submit`,
 * `result`, `add_button`, `open_dialog`, the texts. Where they differ: Android's home buttons have no id
 * (iOS has `open_form` and so on), so they are recorded by text; Android shows `FORM`, which matches iOS's
 * `Form` as matching folds case; Android's dialog button is `android:id/button1`, which is not recorded, so
 * `OK` goes by role and text.
 */
const APP = 'dev.appdyno.fixture';
const CLI = fileURLToPath(new URL('../packages/appdyno/dist/main.js', import.meta.url));

const PASSWORD = 'p4ss-w0rd-7788';
const LISTED_SECRET = 'gizli-kod-9911';
const LONG_MS = 300_000;

const dir = mkdtempSync(join(tmpdir(), 'appdyno-flows-'));
const env = {
  ...(process.env as Record<string, string>),
  APPDYNO_SECRETS: LISTED_SECRET,
  APPDYNO_STATE_DIR: join(dir, 'state'),
};

const secretsIn = (text: string) =>
  [PASSWORD, LISTED_SECRET].filter((secret) => text.includes(secret));

/** The built command line; its exit code is the answer, not a throw. */
const cli = (...args: string[]) =>
  new Promise<{ code: number; out: string; err: string }>((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { env, timeout: LONG_MS, maxBuffer: 1 << 24 },
      (e, out, err) => resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out, err }),
    );
  });

const iphoneFixture = process.env.APPDYNO_IPHONE_FIXTURE_APP ?? '';
const targets = [
  { platform: 'android', serial: process.env.APPDYNO_ANDROID_SERIAL ?? '', form: 'FORM' },
  { platform: 'ios', serial: process.env.APPDYNO_IOS_UDID ?? '', form: 'Form' },
  {
    platform: 'iphone',
    serial: iphoneFixture && (process.env.APPDYNO_IPHONE_UDID ?? ''),
    form: 'Form',
  },
];

let androidRecording: string | undefined;

for (const { platform, serial, form } of targets)
  describe.skipIf(!serial)(`flows on ${platform}`, () => {
    let client: Client;
    // the server writes a flow inside its own folder or its state folder
    const file = join(dir, 'state', `${platform}.flow`);
    const cliFile = join(dir, 'state', `${platform}-cli.flow`);
    const params = [`PASSWORD_INPUT=${PASSWORD}`, `SECRET_1=${LISTED_SECRET}`];

    const raw = async <N extends OpName>(name: N, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool(
        { name, arguments: args },
        {
          timeout: LONG_MS,
        },
      )) as {
        isError?: boolean;
        content: { type: string; text?: string }[];
        structuredContent?: Record<string, unknown>;
      };
      return {
        error: r.isError === true,
        text: r.content.map((c) => c.text ?? '').join('\n'),
        data: (r.structuredContent ?? {}) as OpData<N> & { code?: string },
      };
    };
    const call = async <N extends OpName>(name: N, args: Record<string, unknown> = {}) => {
      const r = await raw(name, args);
      expect(r.error ? r.text : '').toBe('');
      return r;
    };
    const refOf = (text: string, label: string) =>
      new RegExp(`(@[a-z0-9-]+) (?:\\w+ )?"${label}"`).exec(text)?.[1];

    beforeAll(async () => {
      if (platform === 'iphone') await new Devicectl(serial).install(iphoneFixture);
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [CLI, 'mcp', '--device', serial, '--app', APP, '--allow-devices', `^${serial}$`],
        env,
        stderr: 'pipe',
      });
      client = new Client({ name: 'flows-test', version: '0' });
      await client.connect(transport);
      return async () => {
        await client.close();
        if (platform === 'ios') await new IosSimulatorDevice(serial).stopAgent();
      };
    }, 240_000);

    it(
      'records the form, the list and the dialog through the MCP tools',
      async () => {
        await call('flow', { action: 'start' });
        await call('terminate_app');
        await call('launch_app');
        const home = await call('screen');
        // by ref, as an agent does: the file must not keep it
        await call('tap', { ref: refOf(home.text, form) });
        await call('wait_for', { selector: { id: 'name_input' }, timeoutMs: 8_000 });
        const screen = await call('screen');
        await call('type_text', { ref: refOf(screen.text, 'Your name'), text: LISTED_SECRET });
        await call('type_text', { selector: { id: 'name_input' }, text: 'Ayşe', replace: true });
        await call('type_text', { selector: { id: 'password_input' }, text: PASSWORD });
        await call('tap', { selector: { id: 'submit' } });
        await call('assert', { selector: { id: 'result' }, check: 'text', equals: 'Sent: Ayşe' });

        await call('open_link', { url: 'appdyno-fixture://open/list' });
        await call('scroll_to', { selector: { text: 'Product 25' }, maxSwipes: 15 });
        const adds = (await call('find', { selector: { id: 'add_button' } })).data.matches;
        // from the middle: the first rows of a scrolled iOS list lie under its navigation bar
        const middle = Math.floor(adds.length / 2);
        const add = adds[middle];
        assert(add);
        await call('tap', { ref: add.ref });
        await call('assert', { selector: { text: 'In basket: 1' }, timeoutMs: 3_000 });

        await call('open_link', { url: 'appdyno-fixture://open/dialog' });
        await call('tap', { selector: { id: 'open_dialog' } });
        await call('wait_for', { selector: { text: 'OK' }, timeoutMs: 5_000 });
        await call('tap', { selector: { text: 'OK' } });
        await call('assert', { selector: { id: 'result' }, check: 'text', equals: 'Confirmed' });

        const stop = await call('flow', { action: 'stop' });
        expect(stop.data.flagged).toEqual(
          expect.arrayContaining([expect.stringMatching(/ambiguous/)]),
        );
        const saved = await call('flow', { action: 'save', file });
        expect(saved.text).toContain(`steps to ${file}`);

        const text = readFileSync(file, 'utf8');
        process.stderr.write(`--- the ${platform} recording\n${text}---\n`);
        if (platform === 'android') androidRecording = file;
        expect(text).toContain(`app ${APP}`);
        expect(text).toContain('secret PASSWORD_INPUT');
        expect(text).toContain('secret SECRET_1');
        expect(text).toContain('id=name_input');
        expect(text).toContain(`id=add_button index=${middle} !ambiguous`);
        expect(text).toContain('role=button text="OK"');
        expect(text).toContain('equals="Sent: Ayşe"');
        expect(text).not.toMatch(/@[a-z0-9]+/);
        expect(text).not.toContain('button1');
      },
      LONG_MS,
    );

    it('leaves no secret in the saved file or where a recording is kept', () => {
      expect(secretsIn(readFileSync(file, 'utf8'))).toEqual([]);
      const kept = join(dir, 'state', 'recordings');
      for (const f of readdirSync(kept))
        expect(secretsIn(readFileSync(join(kept, f), 'utf8'))).toEqual([]);
    });

    it(
      'replays it on the same device with no model, each step timed from action to settled',
      async () => {
        const r = await call('flow', { action: 'run', file, params });
        process.stderr.write(`--- ${platform} replay\n${r.text}\n---\n`);
        expect(secretsIn(r.text)).toEqual([]);
        expect(r.text).toMatch(/^passed: \d+ steps$/m);
        const { timings } = r.data;
        assert(timings);
        const taps = timings.filter((t) => t.step.startsWith('tap'));
        expect(taps.length).toBeGreaterThan(3);
        for (const t of taps) {
          expect(t.settledMs).toBeGreaterThan(0);
          // the device's time from the action on leaves out the lookup before it
          expect(t.settledMs).toBeLessThanOrEqual(t.ms);
        }
        // the app really is where the flow says it ended
        await call('assert', { selector: { id: 'result' }, check: 'text', equals: 'Confirmed' });
      },
      LONG_MS,
    );

    it(
      'stops at a miss with the nearest candidates, and goes on with --from',
      async () => {
        const flow = join(dir, `${platform}-miss.flow`);
        writeFileSync(
          flow,
          `app ${APP}\nstop\nlaunch\n# not a thing\ntap text="${form}x"\ntap text="${form}"\n`,
        );
        const r = await raw('flow', { action: 'run', file: flow });
        expect(r.error).toBe(true);
        expect(r.data.code).toBe('NOT_FOUND');
        expect(r.text).toContain(`${flow}:5: step 3 failed`);
        expect(r.text).toMatch(new RegExp(`nearest: @\\w+ \\w+ "${form}"`, 'i'));
        // the screen as it was: the home, untouched
        expect(r.text).toContain('appdyno fixture');
        expect(r.text).toContain('--from 3');
        await call('assert', { selector: { text: 'appdyno fixture' } });

        const go = await call('flow', { action: 'run', file: flow, from: 4 });
        expect(go.text).toContain('passed: 1 steps');
        await call('wait_for', { selector: { id: 'name_input' }, timeoutMs: 8_000 });
      },
      LONG_MS,
    );

    it(
      'refuses several matches rather than take one',
      async () => {
        const flow = join(dir, `${platform}-many.flow`);
        writeFileSync(
          flow,
          `app ${APP}\nopen_link "appdyno-fixture://open/list"\ntap id=add_button\n`,
        );
        const r = await raw('flow', { action: 'run', file: flow });
        expect(r.error).toBe(true);
        expect(r.data.code).toBe('AMBIGUOUS');
        expect(r.text).toContain(`${flow}:3`);
        await call('assert', { selector: { text: 'In basket: 1' }, check: 'absent' });
      },
      LONG_MS,
    );

    it(
      'runs as a test: non-zero exit, parsed JUnit, a failure’s screenshot and tree',
      async () => {
        const tests = mkdtempSync(join(dir, `${platform}-tests-`));
        writeFileSync(join(tests, 'a-recorded.flow'), readFileSync(file));
        writeFileSync(
          join(tests, 'b-fails.flow'),
          `app ${APP}\nsecret CODE\nstop\nlaunch\nassert id=none check=text equals="\${CODE}" timeoutMs=500\n`,
        );
        writeFileSync(
          join(tests, 'c-after.flow'),
          `app ${APP}\nstop\nlaunch\nassert text="appdyno fixture"\n`,
        );
        const artifacts = join(dir, `${platform}-artifacts`);
        const junit = join(artifacts, 'report.xml');
        const r = await cli(
          'test',
          tests,
          '--device',
          serial,
          '--share',
          '--artifacts',
          artifacts,
          '--junit',
          junit,
          '--param',
          'CODE=kod-sifre-1',
          ...params.flatMap((p) => ['--param', p]),
        );
        process.stderr.write(`--- ${platform} test\n${r.out}${r.err}\n---\n`);
        expect(r.code).toBe(1);
        expect(r.out).toContain('ok   a-recorded.flow');
        expect(r.out).toContain('FAIL b-fails.flow');
        expect(r.out).toContain('ok   c-after.flow');

        // a real parser says it is well formed; the rest is what a CI system reads from it
        execFileSync('xmllint', ['--noout', junit]);
        const xml = readFileSync(junit, 'utf8');
        expect(/<testsuites tests="(\d+)" failures="(\d+)"/.exec(xml)?.slice(1)).toEqual([
          '3',
          '1',
        ]);
        const cases = [...xml.matchAll(/<testcase name="([^"]+)"[^>]*>([\s\S]*?)<\/testcase>/g)];
        expect(cases.map(([, name, body]) => [name, body?.includes('<failure')])).toEqual([
          ['a-recorded.flow', false],
          ['b-fails.flow', true],
          ['c-after.flow', false],
        ]);
        expect(xml).toContain('line 5, step 3');
        expect(xml).toContain('settled in');
        expect(secretsIn(xml)).toEqual([]);
        expect(xml).not.toContain('kod-sifre-1');

        const kept = join(artifacts, serial.replace(/[^\w.-]/g, '_'), 'b-fails.flow');
        const shot = readFileSync(join(kept, 'screen.jpg'));
        expect(shot.subarray(0, 2).toString('hex')).toBe('ffd8');
        const tree = JSON.parse(readFileSync(join(kept, 'tree.json'), 'utf8')) as {
          nodes: unknown[];
        };
        expect(tree.nodes.length).toBeGreaterThan(0);
        expect(existsSync(join(artifacts, serial, 'a-recorded.flow'))).toBe(false);
      },
      LONG_MS,
    );

    it(
      'records and replays from the command line, each command its own process',
      async () => {
        const flow = cliFile;
        const run = async (...args: string[]) => {
          const r = await cli(...args, '--device', serial, '--share');
          expect(r.err && r.code ? r.err : '').toBe('');
          expect(r.code).toBe(0);
          return r;
        };
        await run('flow', 'start');
        await run('terminate-app', '--app', APP);
        await run('launch-app', '--app', APP);
        await run('tap', '--json', JSON.stringify({ selector: { text: form } }));
        await run('assert', '--id', 'name_input', '--timeout-ms', '8000');
        await run('flow', 'stop');
        await run('flow', 'save', flow);
        const text = readFileSync(flow, 'utf8');
        // Android's home buttons have no id; iOS's do, and an id goes first
        expect(text).toContain(
          platform === 'android' ? 'tap role=button text="FORM"' : 'tap id=open_form',
        );
        expect(text).toContain('assert id=name_input');
        const again = await run('flow', 'run', flow);
        expect(again.out).toContain('passed: 4 steps');
      },
      LONG_MS,
    );

    it('exports to Maestro, or names the step it has no form for', async () => {
      const yaml = await call('flow', {
        action: 'export',
        file: cliFile,
      });
      expect(yaml.text).toContain(`appId: "${APP}"`);
      expect(yaml.text).toContain('tapOn:');
      const recorded = await raw('flow', { action: 'export', file });
      expect(recorded.error).toBe(true);
      expect(recorded.text).toMatch(/step \d+ \(line \d+, type\): .*whole field/);
    });

    it.skipIf(platform !== 'ios' || !process.env.APPDYNO_ANDROID_SERIAL)(
      'replays the Android recording on the simulator',
      async () => {
        expect(androidRecording).toBeDefined();
        const r = await call('flow', { action: 'run', file: androidRecording, params });
        process.stderr.write(`--- the Android recording on iOS\n${r.text}\n---\n`);
        expect(r.text).toMatch(/^passed: \d+ steps$/m);
        await call('assert', { selector: { id: 'result' }, check: 'text', equals: 'Confirmed' });
      },
      LONG_MS,
    );
  });
