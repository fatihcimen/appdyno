import { tmpdir } from 'node:os';
import { assert, describe, expect, it, vi } from 'vitest';
import { HUB_RUNS, HubRuns } from '../src/hub-run.js';
import { COMMANDS } from '../src/usage.js';

type Said = { run: Record<string, unknown> };

const script = (body: string) => new HubRuns([process.execPath, '-e', body], process.env, tmpdir());

/** All a run said as it went. */
const textOf = (said: Said[]) =>
  said.map((s) => (typeof s.run.text === 'string' ? s.run.text : '')).join('');

/** Runs a named command of a stand-in, and answers with what it said. */
const ran = (runs: HubRuns, name: string, asked = {}) =>
  new Promise<Said[]>((done) => {
    const said: Said[] = [];
    runs.start(name, asked, (s) => {
      said.push(s as Said);
      if (s.run && typeof (s.run as Said['run']).code === 'number') done(said);
    });
  });

describe('what a person can run from the hub', () => {
  it('is each a command of this tool, with flags it has', () => {
    const asked = { app: 'com.a', device: 'S', folder: '/f', seconds: '5' };
    for (const [name, words] of Object.entries(HUB_RUNS)) {
      const argv = words(asked);
      assert(argv, name);
      const said = argv.filter((w) => !w.startsWith('-') && !['com.a', 'S', '/f', '5'].includes(w));
      const command = Object.keys(COMMANDS).find((c) =>
        c.split('|').some((one) => {
          const [first, second] = one.split(' ');
          return first === said[0] && (second === undefined || second === said[1]);
        }),
      );
      const known = command ?? (said[0] === 'perf' ? `perf ${String(said[1])}` : undefined);
      expect(known, name).toBeDefined();
    }
  });

  it('pairs a phone by its name or by what it shows, and takes nothing else', () => {
    const { pair, forget } = HUB_RUNS;
    assert(pair && forget);
    expect(pair({ device: 'U' })).toEqual(['pair', '--device', 'U']);
    expect(pair({ address: '10.0.0.2:37000', code: '123456' })).toEqual([
      'pair',
      '10.0.0.2:37000',
      '123456',
    ]);
    expect(pair({ address: '--help', code: '123456' })).toBeUndefined();
    expect(pair({ address: '10.0.0.2:37000', code: '12345; rm' })).toBeUndefined();
    expect(pair({})).toBeUndefined();
    expect(forget({ device: 'U' })).toEqual(['pair', '--forget', '--device', 'U']);
    expect(forget({})).toBeUndefined();
  });

  it('takes nothing that would read as a flag, from a window or anywhere else', () => {
    const { baseline, flows, timeline } = HUB_RUNS;
    assert(baseline && flows && timeline);
    expect(baseline({ app: '--replace' })).toBeUndefined();
    expect(flows({ folder: '-x', device: 'S' })).toBeUndefined();
    expect(timeline({ app: 'a', device: 'S', seconds: '5; rm' })).toEqual([
      'timeline',
      '--app',
      'a',
      '--device',
      'S',
    ]);
  });

  it('runs nothing that is not in its table, and says what was missing', async () => {
    for (const name of ['rm', 'constructor', 'toString']) {
      const said = await ran(script('process.exit(0)'), name);
      expect(said).toHaveLength(1);
      expect(said[0]?.run.code).toBe(2);
    }
    expect((await ran(script('process.exit(0)'), 'baseline'))[0]?.run.code).toBe(2);
  });
});

describe('a run under way', () => {
  it('tells what it says as it comes, what the command was, and how it ended', async () => {
    const said = await ran(
      script('console.log("a"); console.error("b"); process.exit(3)'),
      'tools',
    );
    expect(said[0]?.run.command).toBe('appdyno tools install');
    const text = textOf(said);
    expect(text).toContain('a');
    expect(text).toContain('b');
    expect(said.at(-1)?.run.code).toBe(3);
  });

  it('takes the gate at its word, as its exit code cannot say what it found', async () => {
    const gate = async (out: string, code: number) => {
      const said = await ran(
        script(`console.log(${JSON.stringify(out)}); process.exit(${code})`),
        'compare',
        { app: 'a' },
      );
      return said.at(-1)?.run.verdict;
    };
    const line = 'a launch-cold on c (run 1, now)\n  ';
    expect(await gate(`${line}regression  launch: 900 ms against 300 ms`, 1)).toBe('regression');
    expect(await gate(`${line}over budget launch: 900 (500)`, 1)).toBe('regression');
    const cannot = `${line}noisy       launch: 9 ms\nthe gate could not judge 1 of these: no pass`;
    expect(await gate(cannot, 1)).toBe('unjudged');
    const few = `${line}few-samples launch: 9 ms\nthe gate could not judge 1 of these: no pass`;
    expect(await gate(few, 0)).toBe('unjudged');
    expect(await gate(`${line}ok          launch: 300 ms against 300 ms`, 0)).toBe('clear');
  });

  it('shows a person the words in a runner progress, not its JSON', async () => {
    const progress = JSON.stringify({
      runner: 'U',
      startingMs: 0,
      line: 'starting the iOS runner',
    });
    const said = await ran(script(`console.log(${JSON.stringify(progress)})`), 'tools');
    const text = textOf(said);
    expect(text).toContain('starting the iOS runner');
    expect(text).not.toContain('startingMs');
  });

  it('counts what a sentence needs, so that a person need not read the log', async () => {
    const flows = await ran(
      script('console.log("3 passed, 1 flaky, 2 failed"); process.exit(1)'),
      'flows',
      {
        folder: '/f',
        device: 'S',
      },
    );
    expect(flows.at(-1)?.run.count).toEqual({ passed: 4, failed: 2, all: 6 });
    const timeline = await ran(
      script('console.log("(0.2 MB; 1800 frames, 30 log lines)")'),
      'timeline',
      {
        app: 'a',
        device: 'S',
      },
    );
    expect(timeline.at(-1)?.run.count).toEqual({ frames: 1800 });
  });

  it('names the page a command wrote', async () => {
    const said = await ran(script('console.log("wrote /tmp/x/index.html")'), 'dashboard');
    expect(said.at(-1)?.run.file).toBe('/tmp/x/index.html');
  });

  it('takes no second click, and a second run comes only after the first', async () => {
    const runs = script('setTimeout(() => process.exit(0), 300)');
    const first = ran(runs, 'tools');
    let second = 0;
    runs.start('tools', {}, () => second++);
    expect(second).toBe(0);
    await first;
    expect((await ran(runs, 'tools')).at(-1)?.run.code).toBe(0);
  });

  it('stops by Ctrl-C, so a flight recorder saves what it holds', async () => {
    const body = `process.on('SIGINT', () => { console.log('saved'); process.exit(0); }); console.log('up'); setInterval(() => {}, 1000);`;
    const runs = script(body);
    const said: Said[] = [];
    const end = new Promise<void>((done) =>
      runs.start('flight', { app: 'a', device: 'S' }, (s) => {
        said.push(s as Said);
        const { run } = s as Said;
        if (String(run.text).includes('up')) runs.stop('flight');
        if (typeof run.code === 'number') done();
      }),
    );
    await end;
    expect(textOf(said)).toContain('saved');
    expect(said.at(-1)?.run).toMatchObject({ code: 0, stopped: true });
  });

  it('stops all a command started, as Ctrl-C at a terminal does', async () => {
    const body = `const { spawn } = require('node:child_process');
      const under = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      console.log('under ' + under.pid);
      setInterval(() => {}, 1000);`;
    const runs = script(body);
    let under = 0;
    await new Promise<void>((done) =>
      runs.start('tools', {}, (s) => {
        const { run } = s as Said;
        const heard = /under (\d+)/.exec(String(run.text));
        if (heard) {
          under = Number(heard[1]);
          runs.stop('tools');
        }
        if (typeof run.code === 'number') done();
      }),
    );
    const alive = () => {
      try {
        process.kill(under, 0);
        return true;
      } catch {
        return false;
      }
    };
    await vi.waitFor(() => expect(alive()).toBe(false));
  });

  it('ends with the hub', async () => {
    const runs = script('setInterval(() => {}, 1000)');
    let code: unknown;
    runs.start('tools', {}, (s) => {
      const { run } = s as Said;
      if ('code' in run) code = run.code;
    });
    await runs.end();
    expect(code).toBeDefined();
  });
});
