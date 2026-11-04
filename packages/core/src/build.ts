import { spawn } from 'node:child_process';
import { DeviceError } from '@appdyno/protocol';
import { callSignal, cancelled, reportProgress } from './call.js';

const BUILD_MS = 30 * 60_000;
const ERRORS_KEPT = 8;

export type BuildWords = {
  /** A line that says what the build is at; what it matches goes out as progress. */
  step: RegExp;
  /** A line a failed build's reason is in. */
  error: RegExp;
};

/** Runs a project's own build tool, which takes minutes: progress as it goes, and on failure what it said was wrong. */
export function runBuild(
  tool: string,
  args: string[],
  words: BuildWords,
  cwd?: string,
): Promise<void> {
  const signal = callSignal();
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = () => child.kill();
    const timer = setTimeout(stop, BUILD_MS);
    signal?.addEventListener('abort', stop, { once: true });
    const errors: string[] = [];
    let tail = '';
    let said = '';
    const read = (chunk: Buffer) => {
      const lines = (tail + chunk.toString()).split('\n');
      tail = lines.pop() ?? '';
      for (const line of lines) {
        const step = words.step.exec(line)?.[0];
        if (step && step !== said) reportProgress((said = step));
        if (words.error.test(line)) errors.push(line.trim());
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (e) =>
      reject(new DeviceError('UNSUPPORTED', `cannot run ${tool}: ${e.message}`)),
    );
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      if (signal?.aborted) reject(cancelled('the build'));
      else if (code === 0) resolve();
      else {
        const why = errors.slice(-ERRORS_KEPT).join('\n') || `${tool} ended with ${code}`;
        reject(new DeviceError('BUILD_FAILED', `the build failed:\n${why}`));
      }
    });
  });
}
