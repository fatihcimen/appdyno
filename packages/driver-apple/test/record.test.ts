import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulatorRecorder } from '../src/record.js';

/** Whether a simulator's recording has ended, by its process alone: nothing here starts a recording. */
describe('a recording that may have ended by itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-record-'));
  const file = join(dir, 'a.mov');
  const log = join(dir, 'a.log');
  const recorder = simulatorRecorder('00000000-0000-0000-0000-000000000000');

  it('ended when the movie was last written, once its process has gone', async () => {
    writeFileSync(file, 'frames');
    writeFileSync(log, 'Recording started');
    utimesSync(file, new Date('2026-11-18T22:40:00Z'), new Date('2026-11-18T22:40:00Z'));
    utimesSync(log, new Date('2026-11-18T22:25:00Z'), new Date('2026-11-18T22:25:00Z'));
    // a pid no process has: the recorder's, long gone
    const ended = await recorder.endedAt?.({ pid: 99_999_999, file, log });
    expect(ended).toBe(Date.parse('2026-11-18T22:40:00Z'));
  });

  it('at no time it can say where it left nothing', async () => {
    const gone = join(dir, 'none');
    await expect(
      recorder.endedAt?.({ pid: 99_999_999, file: `${gone}.mov`, log: `${gone}.log` }),
    ).resolves.toBe(0);
  });

  it('runs while its own process does, told from another by its command', async () => {
    // asked once it is up, as a recorder is once it has said it started: /bin/sh hands itself over to bash first, an
    // exec in which ps need not read the command line
    const child = spawn('sh', ['-c', 'echo up; sleep 30; : simctl io recordVideo'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    try {
      await once(child.stdout, 'data');
      await expect(recorder.endedAt?.({ pid: Number(child.pid), file, log })).resolves.toBe(
        undefined,
      );
    } finally {
      child.kill();
    }
  });
});
