import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { jsonLines } from '../json-lines.js';
import { nativeBinary, nativeFile } from '../native.js';
import { NeedError } from './need.js';

export const VIEWER_FLAGS = [
  'clang',
  '-fobjc-arc',
  '-O2',
  '-framework',
  'AppKit',
  '-framework',
  'AVFoundation',
  '-framework',
  'CoreMedia',
  '-framework',
  'CoreVideo',
  '-framework',
  'VideoToolbox',
  '-framework',
  'IOSurface',
  '-framework',
  'QuartzCore',
  '-framework',
  'Accelerate',
  '-framework',
  'Carbon',
];

/** What tests the viewer: in no build a person runs, and not in the published package. */
export const VIEWER_TEST_FILES = /^(SelfTest|Fixtures|fixtures)/;

function compiled(o: {
  name: string;
  withTest: boolean;
  flags: string[];
  env?: NodeJS.ProcessEnv;
}) {
  const dir = dirname(nativeFile('viewer', 'main.m'));
  const inDir = (ext: string) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(ext) && (o.withTest || !VIEWER_TEST_FILES.test(f)))
      .sort()
      .map((f) => join(dir, f));
  return nativeBinary({
    name: o.name,
    sources: inDir('.m'),
    headers: inDir('.h'),
    flags: o.flags,
    ...(o.env && { env: o.env }),
  }).catch((e: Error) => {
    if (e instanceof NeedError) throw e;
    throw new Error(`the viewer did not compile: ${e.message.slice(0, 500)}`, { cause: e });
  });
}

/** Compiled on first use; a Mac with no compiler has no viewer, and is told so. */
export const viewerBinary = (env?: NodeJS.ProcessEnv) =>
  compiled({ name: 'appdyno-viewer', withTest: false, flags: VIEWER_FLAGS, ...(env && { env }) });

/** The viewer with its self test in, for what tests it. */
export const viewerTestBinary = () =>
  compiled({
    name: 'appdyno-viewer-test',
    withTest: true,
    flags: [...VIEWER_FLAGS, '-DMV_SELFTEST'],
  });

/**
 * The viewer's wire, by name: what it takes and what it says. Both sides pass over a name they do not know, so one
 * changed on one side only would fail in silence: a test holds this list to the viewer's sources.
 */
export const VIEWER_OPS = {
  takes: [
    'activity',
    'agent',
    'apps',
    'attach',
    'banner',
    'clients',
    'copied',
    'copyText',
    'detach',
    'element',
    'flow',
    'hub',
    'mark',
    'measured',
    'measuring',
    'note',
    'pair',
    'perf',
    'poke',
    'quit',
    'raise',
    'record',
    'recording',
    'recordStop',
    'results',
    'snapshot',
    'status',
    'tick',
    'touchAt',
    'turns',
    'watch',
  ],
  says: [
    'app',
    'board',
    'button',
    'clicked',
    'closed',
    'control',
    'done',
    'fired',
    'first',
    'hover',
    'hub',
    'inspect',
    'key',
    'lost',
    'marked',
    'needKey',
    'perfWatch',
    'pick',
    'ready',
    'recorded',
    'refused',
    'sleep',
    'snapped',
    'stats',
    'text',
    'touch',
    'wake',
    'watched',
    'zoom',
  ],
} as const;

/** What a viewer says. */
export type ViewerMessage = { op: (typeof VIEWER_OPS.says)[number] } & Record<string, unknown>;
/** What a viewer is told. */
export type ViewerOrder = { op: (typeof VIEWER_OPS.takes)[number] } & Record<string, unknown>;

/** The viewer as a session sees it, a process or a test's stand-in. */
export interface ViewerLink {
  send(message: ViewerOrder): void;
  onMessage(listener: (m: ViewerMessage) => void): void;
  /** Once, however it ended; what it last said on stderr. */
  onExit(listener: (tail: string) => void): void;
  kill(): void;
}

/** What is kept of what a viewer says on stderr, for a stop's reason. */
const STDERR_TAIL = 2_000;

/** One viewer process: JSON lines each way, and it ends with its stdin. */
export class ViewerProcess implements ViewerLink {
  private readonly listeners: ((m: ViewerMessage) => void)[] = [];
  private readonly exits: ((tail: string) => void)[] = [];
  private tail = '';
  private ended = false;
  private readonly child;

  constructor(binary: string, args: string[], env?: NodeJS.ProcessEnv) {
    this.child = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(env && { env }),
    });
    this.child.stdin.on('error', () => undefined);
    this.child.stdout.on(
      'data',
      jsonLines((m) => {
        if (m && typeof (m as ViewerMessage).op === 'string')
          for (const l of this.listeners) l(m as ViewerMessage);
      }),
    );
    this.child.stderr.setEncoding('utf8').on('data', (s: string) => {
      this.tail = (this.tail + s).slice(-STDERR_TAIL);
    });
    this.child.on('error', (e) => this.end(e.message));
    this.child.on('close', () => this.end());
  }

  get pid() {
    return this.child.pid;
  }

  private end(extra?: string) {
    if (this.ended) return;
    this.ended = true;
    for (const l of this.exits) l([this.tail, extra].filter(Boolean).join('\n').trim());
  }

  send(message: ViewerOrder) {
    if (!this.ended) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onMessage(listener: (m: ViewerMessage) => void) {
    this.listeners.push(listener);
  }

  onExit(listener: (tail: string) => void) {
    if (this.ended) listener(this.tail);
    else this.exits.push(listener);
  }

  kill() {
    this.child.stdin.end();
    this.child.kill('SIGTERM');
  }
}

export type ViewerStart = () => Promise<ViewerLink>;

/** Starts viewers for a session. */
export const startViewer =
  (headless: boolean, env?: NodeJS.ProcessEnv, behind = false): ViewerStart =>
  async () =>
    new ViewerProcess(
      await viewerBinary(env),
      [
        ...(headless ? ['--headless'] : behind ? ['--behind'] : []),
        '--tile',
        nativeFile('viewer', 'tile.png'),
      ],
      env,
    );
