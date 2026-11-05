import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceError } from '@appdyno/protocol';
import { queryTraceFile, traceTable } from '../src/trace.js';

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
    process.env.PATH = `${dir}:${path}`;
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

  it('reads the list of tables again too', async () => {
    const reads = fakeTool(`[ "$n" = 2 ] || { ${dies}; }\necho '<table schema="hitches"/>'`);
    const list = await queryTraceFile('a.trace', { limit: 5 });
    expect(list?.rows).toEqual([['hitches']]);
    expect(reads()).toBe(2);
  });
});
