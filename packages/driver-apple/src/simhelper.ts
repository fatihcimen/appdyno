import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { assertUdid, xcodeEnv } from './simctl.js';
import { jsonLines, nativeBinary, nativeFile } from '@appdyno/core';

const IN_A_SIMULATOR = [
  '--sdk',
  'iphonesimulator',
  'clang',
  '-fobjc-arc',
  '-arch',
  'arm64',
  '-mios-simulator-version-min=17.0',
  '-framework',
  'Foundation',
];

const SDK_FLAGS = {
  // SimHID and SimEnergy run on the Mac, SimAX and SimOpen inside the simulator
  SimHID: ['clang', '-fobjc-arc', '-framework', 'Foundation', '-framework', 'IOKit'],
  SimEnergy: ['clang'],
  SimAX: [...IN_A_SIMULATOR, '-framework', 'CoreGraphics'],
  SimOpen: IN_A_SIMULATOR,
  // libraries, injected into a simulator app when it is launched
  SimProbe: [
    '--sdk',
    'iphonesimulator',
    'clang',
    '-fobjc-arc',
    '-arch',
    'arm64',
    '-mios-simulator-version-min=17.0',
    '-dynamiclib',
    '-framework',
    'Foundation',
    '-framework',
    'QuartzCore',
    '-framework',
    'UIKit',
  ],
  NetProbe: [
    '--sdk',
    'iphonesimulator',
    'clang',
    '-fobjc-arc',
    '-dynamiclib',
    '-arch',
    'arm64',
    '-mios-simulator-version-min=17.0',
    '-framework',
    'Foundation',
  ],
  ViewProbe: [...IN_A_SIMULATOR, '-dynamiclib', '-framework', 'UIKit'],
};

/** The helper's binary, compiled once per source (a Mac without Xcode's tools has no simulator either). */
export async function helperBinary(name: keyof typeof SDK_FLAGS): Promise<string> {
  const source = nativeFile('ios', `SimHelper/${name}.m`);
  // what SimOpen may do, in the section a simulator reads
  const allowed = source.replace(/\.m$/, '.plist');
  const linked = existsSync(allowed);
  // what a helper reads into itself, where it is too long for one file
  const parts = source.replace(/\.m$/, 'Parts.h');
  const headers = [...(linked ? [allowed] : []), ...(existsSync(parts) ? [parts] : [])];
  return nativeBinary({
    name,
    sources: [source],
    ...(headers.length > 0 && { headers }),
    flags: [
      ...SDK_FLAGS[name],
      ...(linked ? [`-Wl,-sectcreate,__TEXT,__entitlements,${allowed}`] : []),
    ],
    env: xcodeEnv(),
  });
}

export type HelperAnswer = { ok: boolean; refused?: string; error?: string; ms?: number } & Record<
  string,
  unknown
>;

/** One helper process: JSON lines each way, one answer per request, in order; ends with its stdin. */
export class HelperProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting = new Map<number, (a: HelperAnswer) => void>();
  private next = 1;
  closed = false;
  /** What it wrote of itself last, which says why it ended: nothing else does. */
  private said = '';

  constructor(command: string, args: string[]) {
    this.child = spawn(command, args, { env: xcodeEnv() });
    this.child.stdout.on(
      'data',
      jsonLines((m) => {
        const a = m as (HelperAnswer & { id?: number }) | null;
        if (!a) return;
        this.waiting.get(a.id ?? 0)?.(a);
        this.waiting.delete(a.id ?? 0);
      }),
    );
    this.child.stderr.on('data', (d: Buffer) => (this.said = (this.said + String(d)).slice(-500)));
    this.child.stdin.on('error', () => undefined);
    this.child.on('error', () => this.end());
    // not at its exit: its last words may still be on their way
    this.child.on('close', () => this.end());
    // a helper must not keep the host alive
    this.child.unref();
    (this.child.stdout as unknown as { unref?: () => void }).unref?.();
    (this.child.stderr as unknown as { unref?: () => void }).unref?.();
    (this.child.stdin as unknown as { unref?: () => void }).unref?.();
  }

  /** The answer of a helper that has ended, with its own reason where it gave one. */
  private gone(): HelperAnswer {
    const error = this.said.trim().split('\n').at(-1);
    return { ok: false, refused: 'helper-gone', ...(error && { error }) };
  }

  private end() {
    this.closed = true;
    for (const w of this.waiting.values()) w(this.gone());
    this.waiting.clear();
  }

  call(request: Record<string, unknown>, timeoutMs: number): Promise<HelperAnswer> {
    if (this.closed) return Promise.resolve(this.gone());
    const id = this.next++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // a late answer would belong to no request: this helper is done
        this.close();
        resolve({ ok: false, refused: 'timeout' });
      }, timeoutMs);
      this.waiting.set(id, (a) => {
        clearTimeout(timer);
        resolve(a);
      });
      this.child.stdin.write(`${JSON.stringify({ ...request, id })}\n`);
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin.end();
    this.child.kill('SIGTERM');
  }
}

/** The helper that sends a simulator's touches and keys from the Mac. */
export const startSimHid = async (udid: string) =>
  new HelperProcess(await helperBinary('SimHID'), [assertUdid(udid)]);

/** The helper that reads a simulator's screen from inside it. */
export const startSimAx = async (udid: string) =>
  new HelperProcess('xcrun', ['simctl', 'spawn', assertUdid(udid), await helperBinary('SimAX')]);
