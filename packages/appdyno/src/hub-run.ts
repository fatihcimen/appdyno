import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { gateSaid } from '@appdyno/perf';
import type { COMMANDS } from './usage.js';

/** What a person chose in the window, for a command to take. */
type Asked = { app?: string; device?: string; folder?: string; seconds?: string };

/** A command of the table by its name, which cannot be renamed under this. */
const RUNNER = 'ios build' satisfies keyof typeof COMMANDS;

/** A word that would read as a flag is no app, device or folder: what comes from a window is checked at the door. */
const plain = (v: unknown): v is string => typeof v === 'string' && v !== '' && !v.startsWith('-');

const app = (a: Asked) => (plain(a.app) ? ['--app', a.app] : []);
const device = (a: Asked) => (plain(a.device) ? ['--device', a.device] : []);
const seconds = (a: Asked) => (/^\d+$/.test(a.seconds ?? '') ? ['--seconds', a.seconds!] : []);
/** What a command cannot run without: nothing, where one is missing. */
const needs = (ok: boolean, words: string[]) => (ok ? words : undefined);

/**
 * All a person can run from the hub, each the command they could type: there is no second way to do any of it. Only
 * these run: nothing a window sends becomes a command by itself.
 */
export const HUB_RUNS: Record<string, (a: Asked) => string[] | undefined> = {
  baseline: (a) => needs(plain(a.app), ['perf', 'baseline', ...app(a)]),
  compare: (a) => needs(plain(a.app), ['perf', 'compare', ...app(a)]),
  why: (a) => needs(plain(a.app), ['perf', 'why', ...app(a), ...device(a)]),
  survey: (a) =>
    needs(plain(a.app) && plain(a.device), ['perf', 'survey', ...app(a), ...device(a)]),
  flows: (a) =>
    needs(plain(a.folder) && plain(a.device), [
      'test',
      a.folder!,
      ...device(a),
      '--artifacts',
      join(a.folder!, 'appdyno-artifacts'),
    ]),
  timeline: (a) =>
    needs(plain(a.app) && plain(a.device), ['timeline', ...app(a), ...device(a), ...seconds(a)]),
  flight: (a) => needs(plain(a.app) && plain(a.device), ['flight', ...app(a), ...device(a)]),
  dashboard: (a) => ['perf', 'dashboard', ...app(a)],
  tools: () => ['tools', 'install'],
  adb: () => ['tools', 'install', 'adb', '--accept-license'],
  runner: () => RUNNER.split(' '),
  'path-on': () => ['path'],
  'path-off': () => ['path', '--remove'],
  'clients-preview': () => ['install', '--dry-run'],
  clients: () => ['install', '--yes'],
  'update-check': () => ['update', '--check'],
  update: () => ['update'],
};

/** How long a command has to end its own way after Stop, as a flight recorder saves on its way out. */
const STOP_MS = 5_000;
/** The last page, or report, a command wrote and named. */
const MADE = /(\/[^\s'"]+\.html)\b/g;

/** What the gate says by its words, as its exit code cannot. */
const GATE = new Set(['compare', 'why']);

/** A runner's progress comes as JSON for a machine, with a line in it for a person: only that line is shown. */
const forPerson = (text: string) => text.replace(/^\{"runner":.*"line":"([^"]*)"\}$/gm, '$1');

/** What a sentence needs of what a command printed, so that no one has to read it. */
function countOf(name: string, said: string) {
  const tally = name === 'flows' ? /(\d+) passed, (\d+) flaky, (\d+) failed/.exec(said) : null;
  if (tally) {
    const [passed, flaky, failed] = tally.slice(1).map(Number) as [number, number, number];
    return { passed: passed + flaky, failed, all: passed + flaky + failed };
  }
  const frames = name === 'timeline' ? /\b(\d+) frames\b/.exec(said) : null;
  return frames ? { frames: Number(frames[1]) } : undefined;
}

type Run = { child: ChildProcess; file?: string; stopped: boolean; said: string };
type Say = (said: Record<string, unknown>) => void;

/** The commands under way: one of a name at a time, each ending with the hub. */
export class HubRuns {
  private readonly runs = new Map<string, Run>();

  constructor(
    private readonly self: string[],
    private readonly env: NodeJS.ProcessEnv,
    /** Where a command runs: an app opened from the Dock stands in `/`, where nothing can be written. */
    private readonly home: string,
  ) {}

  start(name: string, asked: Asked, say: Say) {
    const words = Object.hasOwn(HUB_RUNS, name) ? HUB_RUNS[name]!(asked) : undefined;
    if (!words)
      return say({ run: { name, code: 2, line: `${name}: something it needs is missing` } });
    if (this.runs.has(name)) return undefined;
    const child = spawn(this.self[0]!, [...this.self.slice(1), ...words], {
      env: this.env,
      cwd: this.home,
      // a group of its own: Ctrl-C at a terminal reaches all a command started, and so must Stop
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const run: Run = { child, stopped: false, said: '' };
    this.runs.set(name, run);
    say({ run: { name, started: true, command: `appdyno ${words.join(' ')}` } });
    const heard = (chunk: Buffer) => {
      const text = chunk.toString();
      run.said += text;
      run.file = [...text.matchAll(MADE)].at(-1)?.[1] ?? run.file;
      say({ run: { name, text: forPerson(text) } });
    };
    child.stdout!.on('data', heard);
    child.stderr!.on('data', heard);
    child.on('error', (e) => say({ run: { name, text: `${e.message}\n` } }));
    child.on('close', (code) => {
      this.runs.delete(name);
      say({
        run: {
          name,
          code: code ?? 1,
          ...(run.stopped && { stopped: true }),
          ...(run.file && { file: run.file }),
          ...(GATE.has(name) && { verdict: gateSaid(run.said) }),
          ...(countOf(name, run.said) && { count: countOf(name, run.said) }),
        },
      });
    });
    return undefined;
  }

  /** A person's Stop: Ctrl-C, as at a terminal, and only then an end it cannot refuse. */
  stop(name: string) {
    const run = this.runs.get(name);
    if (!run) return;
    run.stopped = true;
    const group = (signal: NodeJS.Signals) => {
      try {
        process.kill(-run.child.pid!, signal);
      } catch {
        // nothing of it is left
      }
    };
    group('SIGINT');
    setTimeout(() => group('SIGTERM'), STOP_MS).unref();
  }

  async end() {
    const left = [...this.runs.values()].map(
      ({ child }) => new Promise((done) => child.once('close', done)),
    );
    for (const name of this.runs.keys()) this.stop(name);
    await Promise.all(left);
  }
}
