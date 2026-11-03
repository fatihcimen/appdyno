import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUdid, xcodeEnv } from './simctl.js';
import { run } from '@appdyno/core';

const SDK_FLAGS = {
  // SimHID runs on the Mac, SimAX inside the simulator
  SimHID: ['clang', '-fobjc-arc', '-framework', 'Foundation'],
  SimAX: [
    '--sdk',
    'iphonesimulator',
    'clang',
    '-fobjc-arc',
    '-arch',
    'arm64',
    '-mios-simulator-version-min=17.0',
    '-framework',
    'Foundation',
    '-framework',
    'CoreGraphics',
  ],
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
};

/** The helper's binary, compiled once per source (a Mac without Xcode's tools has no simulator either). */
export async function helperBinary(name: keyof typeof SDK_FLAGS): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = [
    join(here, `../../../ios/SimHelper/${name}.m`),
    join(here, `../agents/ios-src/SimHelper/${name}.m`),
  ].find((p) => existsSync(p));
  if (!source) throw new Error(`the source of ${name} is missing`);
  const id = createHash('sha256')
    .update(await readFile(source))
    .update(SDK_FLAGS[name].join(' '))
    .digest('hex')
    .slice(0, 16);
  const dir = join(homedir(), 'Library/Caches/appdyno/ios-helper', id);
  const binary = join(dir, name);
  if (existsSync(binary)) return binary;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${binary}.${randomBytes(4).toString('hex')}`;
  await run('xcrun', [...SDK_FLAGS[name], '-o', tmp, source], {
    env: xcodeEnv(),
    timeout: 120_000,
  });
  await chmod(tmp, 0o700);
  await rename(tmp, binary);
  return binary;
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
  private buffered: Buffer[] = [];
  closed = false;

  constructor(command: string, args: string[]) {
    this.child = spawn(command, args, { env: xcodeEnv() });
    this.child.stdout.on('data', (b: Buffer) => this.onData(b));
    this.child.stderr.resume();
    this.child.stdin.on('error', () => undefined);
    this.child.on('error', () => this.end());
    this.child.on('exit', () => this.end());
    // a helper must not keep the host alive
    this.child.unref();
    (this.child.stdout as unknown as { unref?: () => void }).unref?.();
    (this.child.stderr as unknown as { unref?: () => void }).unref?.();
    (this.child.stdin as unknown as { unref?: () => void }).unref?.();
  }

  private onData(b: Buffer) {
    let start = 0;
    for (let i = b.indexOf(10); i >= 0; i = b.indexOf(10, start)) {
      const line = Buffer.concat([...this.buffered, b.subarray(start, i)]);
      this.buffered = [];
      start = i + 1;
      try {
        const a = JSON.parse(line.toString('utf8')) as HelperAnswer & { id?: number };
        this.waiting.get(a.id ?? 0)?.(a);
        this.waiting.delete(a.id ?? 0);
      } catch {
        // anything else on its stdout is no answer
      }
    }
    if (start < b.length) this.buffered.push(b.subarray(start));
  }

  private end() {
    this.closed = true;
    for (const w of this.waiting.values()) w({ ok: false, refused: 'helper-gone' });
    this.waiting.clear();
  }

  call(request: Record<string, unknown>, timeoutMs: number): Promise<HelperAnswer> {
    if (this.closed) return Promise.resolve({ ok: false, refused: 'helper-gone' });
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
