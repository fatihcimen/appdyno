import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
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
  doctor: () => ['doctor'],
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

type Run = { child: ChildProcess; file?: string; stopped: boolean };
type Say = (said: Record<string, unknown>) => void;

/** The commands under way: one of a name at a time, each ending with the hub. */
export class HubRuns {
  private readonly runs = new Map<string, Run>();

  constructor(
    private readonly self: string[],
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  start(name: string, asked: Asked, say: Say) {
    const words = Object.hasOwn(HUB_RUNS, name) ? HUB_RUNS[name]!(asked) : undefined;
    if (!words)
      return say({ run: { name, code: 2, line: `${name}: something it needs is missing` } });
    if (this.runs.has(name)) return undefined;
    const child = spawn(this.self[0]!, [...this.self.slice(1), ...words], {
      env: this.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const run: Run = { child, stopped: false };
    this.runs.set(name, run);
    say({ run: { name, started: true, command: `appdyno ${words.join(' ')}` } });
    const heard = (chunk: Buffer) => {
      const text = chunk.toString();
      run.file = [...text.matchAll(MADE)].at(-1)?.[1] ?? run.file;
      say({ run: { name, text } });
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
    run.child.kill('SIGINT');
    setTimeout(() => run.child.exitCode === null && run.child.kill('SIGTERM'), STOP_MS).unref();
  }

  async end() {
    const left = [...this.runs.values()].map(
      ({ child }) => new Promise((done) => child.once('close', done)),
    );
    for (const name of this.runs.keys()) this.stop(name);
    await Promise.all(left);
  }
}
