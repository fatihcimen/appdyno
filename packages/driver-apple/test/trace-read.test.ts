import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { DeviceError } from '@appdyno/protocol';
import { queryTraceFile, recordTrace, traceTable } from '../src/trace.js';
import { againHint, stoppedLate } from '../src/trace-read.js';

const TABLE =
  '<trace-query-result><node><schema name="t"><col><mnemonic>a</mnemonic></col></schema></node></trace-query-result>';

describe('reading a trace', () => {
  const path = process.env.PATH;
  afterEach(() => {
    process.env.PATH = path;
  });

  /** An `xcrun` that writes a line for each read and runs `script`, which sees the read's number in `$n`. */
  const fakeTool = (script: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-xcrun-'));
    const reads = join(dir, 'reads');
    writeFileSync(reads, '');
    const bin = join(dir, 'xcrun');
    writeFileSync(
      bin,
      `#!/bin/sh\necho read >> '${reads}'\nn=$(wc -l < '${reads}' | tr -d ' ')\n${script}\n`,
    );
    chmodSync(bin, 0o755);
    process.env.PATH = `${dir}:${String(path)}`;
    return () => readFileSync(reads, 'utf8').split('\n').length - 1;
  };

  // a plain signal: a real abort would leave a crash report of `sh` for each run of this test
  const dies = `echo "*** Terminating app" >&2\nkill -TERM $$`;

  it('reads again when the tool dies by itself, as it does at times on loading a trace', async () => {
    const reads = fakeTool(`[ "$n" = 3 ] || { ${dies}; }\necho '${TABLE}'`);
    await expect(traceTable('a.trace', 't')).resolves.toContain('trace-query-result');
    expect(reads()).toBe(3);
  });

  it('says what the tool said when it dies on every read', async () => {
    const reads = fakeTool(dies);
    const failure = await traceTable('a.trace', 't').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(DeviceError);
    expect((failure as DeviceError).message).toContain('*** Terminating app');
    expect(reads()).toBe(3);
  });

  it('takes a refusal at its word: one read', async () => {
    const reads = fakeTool(`echo 'Document Missing Template Error' >&2\nexit 1`);
    await expect(traceTable('a.trace', 't')).rejects.toThrow(/Document Missing/);
    expect(reads()).toBe(1);
  });

  it('says the tool did not finish a recording it had to be stopped in', async () => {
    fakeTool(`echo 'Export failed: Document Missing Template Error' >&2\nexit 1`);
    stoppedLate('hung.trace', 'did not finish a 3 s recording by itself: it was stopped 213 s in');
    await expect(traceTable('hung.trace', 't')).rejects.toThrow(
      'the trace tool did not finish a 3 s recording by itself: it was stopped 213 s in, and cannot read what it left: Export failed: Document Missing Template Error',
    );
  });

  it('asks for a quieter Mac only where its load is high', () => {
    expect(againHint(6, 10)).toBe('nothing is wrong with the device: measure again');
    expect(againHint(40, 10)).toBe(
      'nothing is wrong with the device: measure again when this Mac is quieter, at load 40 on 10 cores',
    );
  });

  it('refuses a process the recording tool keeps not finding, saying why and what to do', async () => {
    const tries = fakeTool(`echo 'Cannot find process for provided pid: 42' >&2\nexit 1`);
    vi.useFakeTimers({ toFake: ['Date'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const failure = await recordTrace({
      template: 'Power Profiler',
      instrument: true,
      device: 'phone',
      // the wait for the process has run out by the first look's answer
      attach: () => {
        vi.setSystemTime(Date.now() + 241_000);
        return Promise.resolve(42);
      },
      attachedOnly: true,
      seconds: 1,
      dir: mkdtempSync(join(tmpdir(), 'appdyno-record-')),
    }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(DeviceError);
    expect(failure).toMatchObject({
      code: 'TIMEOUT',
      message: 'the trace tool did not find process 42 for 240 s, though it runs',
      hint: "a phone's trace tool does not find a process for minutes after a recording attached to it: measure again in a few minutes",
    });
    expect(tries()).toBe(1);
  });

  it('reads the list of tables again too', async () => {
    const reads = fakeTool(`[ "$n" = 2 ] || { ${dies}; }\necho '<table schema="hitches"/>'`);
    const list = await queryTraceFile('a.trace', { limit: 5 });
    expect(list?.rows).toEqual([['hitches']]);
    expect(reads()).toBe(2);
  });
});
