import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBplist, writeBplist } from '../src/webinspector.js';

describe('binary plists', () => {
  const value = {
    __selector: '_rpc_forwardSocketData:',
    __argument: {
      WIRConnectionIdentifierKey: 'ABC',
      Turkish: 'İstanbul',
      WIRPageIdentifierKey: 7,
      big: 70_000,
      negative: -5,
      yes: true,
      no: false,
      list: ['a', 1],
      WIRSocketDataKey: Buffer.from('{"id":1}'),
      long: 'x'.repeat(40),
    },
  };

  it('reads back what it writes', () => {
    expect(readBplist(writeBplist(value))).toEqual(value);
  });

  it('writes what Apple reads, and reads what Apple writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-plist-'));
    const file = join(dir, 'x.plist');
    writeFileSync(file, writeBplist(value));
    const xml = execFileSync('plutil', ['-convert', 'xml1', '-o', '-', file], { encoding: 'utf8' });
    expect(xml).toContain('<string>İstanbul</string>');
    expect(xml).toContain('<integer>70000</integer>');
    expect(xml).toContain('<integer>-5</integer>');
    expect(xml).toContain(Buffer.from('{"id":1}').toString('base64'));
    writeFileSync(file, JSON.stringify({ a: 'İstanbul', b: [1, 2.5, true], c: { d: 300 } }));
    execFileSync('plutil', ['-convert', 'binary1', file]);
    expect(readBplist(readFileSync(file))).toEqual({
      a: 'İstanbul',
      b: [1, 2.5, true],
      c: { d: 300 },
    });
  });

  it('calls anything else what it is', () => {
    expect(() => readBplist(Buffer.from('not a plist at all, not at all, not at all'))).toThrow(
      /not a binary plist/,
    );
  });
});
