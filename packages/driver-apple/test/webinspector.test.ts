import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBplist, SimulatorWeb, writeBplist } from '../src/webinspector.js';
import type { Simctl } from '../src/simctl.js';

/** A plist of arrays by hand: `refs[i]` are what object `i` holds, each given as one byte. */
function bplistOf(refs: number[][]) {
  const objects = refs.map((r) => Buffer.from([0xa0 | r.length, ...r]));
  const offsets = Buffer.alloc(objects.length * 2);
  let at = 8;
  objects.forEach((o, i) => {
    offsets.writeUInt16BE(at, i * 2);
    at += o.length;
  });
  const trailer = Buffer.alloc(32);
  trailer[6] = 2;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(BigInt(at), 24);
  return Buffer.concat([Buffer.from('bplist00', 'latin1'), ...objects, offsets, trailer]);
}

describe('a plist that cannot be read to its end', () => {
  it('reads one that has no way out of itself as an error', () => {
    expect(() => readBplist(bplistOf([[0]]))).toThrow();
    expect(() => readBplist(bplistOf([[1], [0]]))).toThrow();
  });

  it('does not unfold one small file for ever: each of 40 lists holds the next one twice', () => {
    const levels = Array.from({ length: 40 }, (_, i) => [i + 1, i + 1]);
    expect(() => readBplist(bplistOf([...levels, []]))).toThrow(/more than/);
  });

  it('makes no room for a list longer than the file: this one names itself, 64 million times', () => {
    const long = Buffer.from([0xaf, 0x12, 0x03, 0xd0, 0x90, 0x00, 0x00]);
    const trailer = Buffer.alloc(32);
    trailer[6] = 2;
    trailer[7] = 1;
    trailer.writeBigUInt64BE(1n, 8);
    trailer.writeBigUInt64BE(BigInt(8 + long.length), 24);
    const offset = Buffer.from([0, 8]);
    const file = Buffer.concat([Buffer.from('bplist00', 'latin1'), long, offset, trailer]);
    expect(() => readBplist(file)).toThrow('past its end');
  });

  it('reads an object named many times, as a list of the same string', () => {
    const many = Array.from({ length: 14 }, () => 1);
    expect(readBplist(bplistOf([many, []]))).toEqual(many.map(() => []));
  });
});

describe('the Safari inspector of a simulator', () => {
  it('ends on what it cannot read, as a socket that said nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-inspector-'));
    const path = join(dir, 's');
    const server = createServer((socket) => {
      const body = Buffer.from('bplist00 and then nothing that is one');
      const head = Buffer.alloc(4);
      head.writeUInt32BE(body.length);
      socket.on('error', () => undefined);
      socket.write(Buffer.concat([head, body]));
    });
    await new Promise<void>((r) => server.listen(path, r));
    const simctl = { exec: async () => path } as unknown as Simctl;
    const udid = '00000000-0000-0000-0000-000000000000';
    await expect(new SimulatorWeb(simctl, udid).pages(undefined)).rejects.toThrow(/said nothing/);
    server.close();
  });
});

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

  it('writes back a number that is no whole one, as a token from a phone may hold', () => {
    expect(readBplist(writeBplist({ ratio: 0.5, list: [-1.25, 3] }))).toEqual({
      ratio: 0.5,
      list: [-1.25, 3],
    });
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
