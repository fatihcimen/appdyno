import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { HUB_RUNS, HubRuns } from '../src/hub-run.js';
import { COMMANDS } from '../src/usage.js';

type Said = { run: Record<string, unknown> };

const script = (body: string) => new HubRuns([process.execPath, '-e', body], process.env, tmpdir());

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
      const argv = words(asked)!;
      const said = argv.filter((w) => !w.startsWith('-') && !['com.a', 'S', '/f', '5'].includes(w));
      const command = Object.keys(COMMANDS).find((c) =>
        c.split('|').some((one) => {
          const [first, second] = one.split(' ');
          return first === said[0] && (second === undefined || second === said[1]);
        }),
      );
      const known = command ?? (said[0] === 'perf' ? `perf ${said[1]}` : undefined);
      expect(known, name).toBeDefined();
    }
  });

  it('takes nothing that would read as a flag, from a window or anywhere else', () => {
    expect(HUB_RUNS.baseline!({ app: '--replace' })).toBeUndefined();
    expect(HUB_RUNS.flows!({ folder: '-x', device: 'S' })).toBeUndefined();
    expect(HUB_RUNS.timeline!({ app: 'a', device: 'S', seconds: '5; rm' })).toEqual([
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
      expect(said[0]!.run.code).toBe(2);
    }
    expect((await ran(script('process.exit(0)'), 'baseline'))[0]!.run.code).toBe(2);
  });
});

describe('a run under way', () => {
  it('tells what it says as it comes, what the command was, and how it ended', async () => {
    const said = await ran(
      script('console.log("a"); console.error("b"); process.exit(3)'),
      'tools',
    );
    expect(said[0]!.run.command).toBe('appdyno tools install');
    const text = said.map((s) => s.run.text ?? '').join('');
    expect(text).toContain('a');
    expect(text).toContain('b');
    expect(said.at(-1)!.run.code).toBe(3);
  });

  it('names the page a command wrote', async () => {
    const said = await ran(script('console.log("wrote /tmp/x/index.html")'), 'dashboard');
    expect(said.at(-1)!.run.file).toBe('/tmp/x/index.html');
  });

  it('takes no second click, and a second run comes only after the first', async () => {
    const runs = script('setTimeout(() => process.exit(0), 300)');
    const first = ran(runs, 'tools');
    let second = 0;
    runs.start('tools', {}, () => second++);
    expect(second).toBe(0);
    await first;
    expect((await ran(runs, 'tools')).at(-1)!.run.code).toBe(0);
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
    expect(said.map((s) => s.run.text ?? '').join('')).toContain('saved');
    expect(said.at(-1)!.run).toMatchObject({ code: 0, stopped: true });
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
