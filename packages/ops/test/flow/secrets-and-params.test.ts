import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commentRun,
  flowFiles,
  mergeRuns,
  paramsOf,
  readRun,
  shareLines,
  zipRun,
} from '../../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { SCREENS } from '@appdyno/testing/fake-screens.js';
import { callerOf, flowsFor, SECRET, flowHelpers } from './harness.js';

describe('flows', () => {
  let dir: string;
  let device: FakeDevice;
  const { context, refusal, recorded } = flowHelpers(
    () => device,
    () => dir,
  );
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'appdyno-flow-'));
    vi.stubEnv('APPDYNO_STATE_DIR', join(dir, 'state'));
    device = new FakeDevice();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('secrets', () => {
    it('a password field, and any later echo, become a name; no value reaches the disk', async () => {
      device.screen = 'login';
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('type_text', { text: SECRET, selector: { id: 'pass' } });
        await call('check_element', {
          selector: { id: 'greeting' },
          check: 'text',
          equals: `Merhaba ${SECRET}`,
        });
        await call('tap_screen', { selector: { id: 'greeting' } });
      });
      expect(device.typed).toEqual([SECRET]);
      expect(text).toBe(`app dev.app
secret PASS

type "\${PASS}" id=pass
assert id=greeting check=text equals="Merhaba \${PASS}"
tap id=greeting
`);
      const kept = readdirSync(join(dir, 'state', 'recordings'));
      for (const f of kept)
        expect(readFileSync(join(dir, 'state', 'recordings', f), 'utf8')).not.toContain(SECRET);
    });

    it('tells a password field by the focus, when text goes to no target', async () => {
      device.screen = 'login';
      const node = must(SCREENS.login?.[1], 'the password field');
      const was = must(node.f, 'its flags');
      node.f = was | 8;
      try {
        const call = callerOf(context());
        const { text } = await recorded(call, () => call('type_text', { text: 'p4ss' }));
        expect(text).not.toContain('p4ss');
        expect(text).toContain('type "${PASS}"');
      } finally {
        node.f = was;
      }
    });

    it('text matching APPDYNO_SECRETS becomes a name in any field', async () => {
      const call = callerOf(context(['kod-9911']));
      const { text } = await recorded(call, async () => {
        await call('tap_screen', { selector: { text: 'Form' } });
        await call('type_text', { text: 'kod-9911', selector: { id: 'name' } });
      });
      expect(text).not.toContain('kod-9911');
      expect(text).toContain('secret SECRET_1');
      expect(text).toContain('type "${SECRET_1}" id=name');
    });

    it('a value of APPDYNO_SECRETS or of a secret, written in a flow as it is, is in nothing a run writes or answers', async () => {
      device.screen = 'login';
      const PIN = 'fake-pin-0000';
      // a quote in it: a line holds it escaped
      const QUOTED = 'fake-left"fake-right';
      const flows = join(dir, 'flows');
      mkdirSync(flows);
      const typed = `type "${SECRET}" id=pass\n`;
      const file = (name: string, text: string) => {
        writeFileSync(join(flows, name), `app dev.app\n${text}`);
        return join(flows, name);
      };
      const passes = file(
        'a-passes.flow',
        `${typed}type ${JSON.stringify(QUOTED)} id=user\nassert id=greeting check=text equals="Merhaba ${SECRET}"\n`,
      );
      const fails = file(
        'b-fails.flow',
        `secret PIN\ntype "\${PIN}" id=user\n${typed}assert id=greeting check=text equals="${PIN} ${SECRET}" timeoutMs=200\n`,
      );
      // a line that does not parse, its error quoting it
      const broken = file('c-broken.flow', `type "${SECRET}\\q" id=pass\n`);
      const ctx = context([SECRET, QUOTED]);
      const call = callerOf(ctx);
      /** Each thing a run wrote or answered, by where it is. */
      const said: Record<string, string> = {};
      const filesIn = (folder: string) => {
        for (const f of readdirSync(folder, { recursive: true }) as string[])
          if (statSync(join(folder, f)).isFile())
            said[join(folder, f)] = readFileSync(join(folder, f), 'utf8');
      };

      // appdyno test: its record, page, JUnit, verdict, pull request text and evidence, and the lines it printed
      const artifacts = join(dir, 'artifacts', 'cli');
      const lines: string[] = [];
      const r = await flowsFor(ctx).test({
        files: flowFiles([flows]),
        devices: [],
        artifacts,
        params: { PIN },
        retries: 1,
        log: (l) => lines.push(l),
      });
      said['the run as code has it'] = JSON.stringify(r);
      said['the lines appdyno test printed'] = lines.join('\n');
      filesIn(artifacts);
      // appdyno test merge, share, share --zip and comment, from the folder alone
      mergeRuns([artifacts], join(dir, 'merged'));
      filesIn(join(dir, 'merged'));
      said['test share'] = shareLines(readRun(artifacts)).join('\n');
      const zip = join(dir, 'run.zip');
      zipRun(artifacts, zip);
      said['test share --zip'] = execFileSync('/usr/bin/unzip', ['-p', zip], { encoding: 'utf8' });
      said['test comment'] = readFileSync(commentRun(artifacts, join(dir, 'comment.md')), 'utf8');
      // run_flow: test, and run of a file that passes, one that fails and one that does not parse
      const to = join(dir, 'artifacts', 'mcp');
      said['run_flow test'] = JSON.stringify(
        await call('run_flow', { action: 'test', file: flows, to, params: [`PIN=${PIN}`] }),
      );
      filesIn(to);
      said['run_flow run'] = JSON.stringify(
        await call('run_flow', { action: 'run', file: passes }),
      );
      const refusals = {
        'run_flow run of a file that fails': () =>
          call('run_flow', { action: 'run', file: fails, params: [`PIN=${PIN}`] }),
        'run_flow run of a file that does not parse': () =>
          call('run_flow', { action: 'run', file: broken }),
        'run_flow export of it': () => call('run_flow', { action: 'export', file: broken }),
        'a replay of it from code': () => flowsFor(ctx).replay(broken),
      };
      for (const [what, refused] of Object.entries(refusals)) {
        const e = await refusal(refused());
        said[`${what}, refused`] = `${e.message}\n${e.hint ?? ''}`;
      }

      const values = [SECRET, PIN, ...QUOTED.split('"')];
      expect(Object.keys(said).filter((k) => values.some((v) => said[k]?.includes(v)))).toEqual([]);
      // it ran: the values were typed, its steps are there with them hidden, and the failure is the step's
      expect(device.typed).toEqual(expect.arrayContaining([SECRET, QUOTED, PIN]));
      expect(r.record.cases.map((c) => [c.label, c.outcome])).toEqual([
        ['a-passes.flow', 'passed'],
        ['b-fails.flow', 'failed'],
        ['c-broken.flow', 'failed'],
      ]);
      expect(r.record.cases[0]?.steps?.map((st) => st.step).slice(0, 2)).toEqual([
        'type "•••" id=pass',
        'type "•••" id=user',
      ]);
      expect(r.record.cases[1]?.attempts).toHaveLength(2);
      expect(r.record.cases[1]?.attempts[1]?.failure?.step).toBe(
        'assert id=greeting check=text equals="••• •••" timeoutMs=200',
      );
      expect(said['run_flow run of a file that does not parse, refused']).toContain(
        'not a quoted string: "•••\\q"',
      );
      expect(r.record.cases[2]?.attempts[0]?.failure?.message).toBe(
        `${broken}: line 2: not a quoted string: "•••\\q"`,
      );
    });
  });

  describe('params', () => {
    it('names a recorded value at save, which a run takes; a value no step holds is refused', async () => {
      const call = callerOf(context());
      await call('run_flow', { action: 'record' });
      await call('tap_screen', { selector: { text: 'Form' } });
      await call('type_text', { text: 'Grace', selector: { id: 'name' } });
      await call('run_flow', { action: 'stop' });
      const file = join(dir, 'state', 'named.flow');
      const none = await refusal(
        call('run_flow', { action: 'save', file, params: ['OTHER=Hopper'] }),
      );
      expect(none.message).toContain('no recorded step holds the value of OTHER');
      expect(existsSync(file)).toBe(false);
      const saved = await call('run_flow', { action: 'save', file, params: ['NAME=Grace'] });
      const text = `app dev.app
param NAME

tap role=button text="Form"
type "\${NAME}" id=name
`;
      expect(readFileSync(file, 'utf8')).toBe(text);
      expect(saved.text).toContain(text);
      expect(saved.text).toContain('param NAME: step 2');
      device.screen = 'home';
      await call('run_flow', { action: 'run', file, params: ['NAME=Hopper'] });
      expect(device.typed).toEqual(['Grace', 'Hopper']);
    });

    it('names at start what is typed later, and refuses a name a placeholder cannot have', async () => {
      const call = callerOf(context());
      const bad = await refusal(call('run_flow', { action: 'record', params: ['name=Ada'] }));
      expect(bad.message).toContain("a param's name is like MY_NAME");
      expect((await refusal(call('run_flow', { action: 'stop' }))).message).toContain(
        'no recording',
      );
      await call('run_flow', { action: 'record', params: ['NAME=Ada'] });
      await call('tap_screen', { selector: { text: 'Form' } });
      await call('type_text', { text: 'Ada', selector: { id: 'name' } });
      const stop = await call('run_flow', { action: 'stop' });
      expect(stop.text).toContain('param NAME\n');
      expect(stop.text).toContain('type "${NAME}" id=name');
      expect(stop.text).not.toContain('secret');
      writeFileSync(join(dir, 'e.flow'), 'app dev.app\nlaunch\n');
      const exported = refusal(
        call('run_flow', { action: 'export', file: join(dir, 'e.flow'), params: ['NAME=Ada'] }),
      );
      expect((await exported).message).toContain('export takes no params');
    });
  });

  it('reads NAME=value, a value with = in it included', () => {
    expect(paramsOf(['A=1', 'B=x=y', 'C='])).toEqual({ A: '1', B: 'x=y', C: '' });
    expect(() => paramsOf(['nope'])).toThrow(/NAME=value/);
  });
});
