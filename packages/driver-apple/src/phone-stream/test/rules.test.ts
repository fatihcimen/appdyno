import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  openSync,
  closeSync,
  constants,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { NOTIFICATIONS, type Notification } from '@appdyno/protocol';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { writeBplist } from '../../webinspector.js';
import { FrameWriter } from '../frame-writer.js';
import { PhoneRefusal, readPairRecord } from '../tunnel.js';

const here = join(import.meta.dirname, '..');
const sources = () =>
  readdirSync(here)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: f, text: readFileSync(join(here, f), 'utf8') }));

describe('what this folder must never do', () => {
  it("connects to nothing but through usbmuxd, its own tunnel and a phone's pairing port", () => {
    // Apple's tunnel is reached by a socket or its address: its discovery port takes one client, and a second throws it off
    for (const { file, text } of sources()) {
      for (const banned of [
        'node:dgram',
        'net.connect',
        'createConnection',
        'remotectl',
        'tunnelIPAddress',
        'devicectl',
        'coredevice-',
        // what that port is advertised as
        '_remoted',
      ]) {
        expect(text.includes(banned), `${file}: ${banned}`).toBe(false);
      }
      expect(
        text.includes("from 'node:net'") && !/import \{ (type )?Socket \}/.test(text),
        file,
      ).toBe(false);
      // the one place that opens a socket of this Mac, to what a phone advertises for pairing and the port it then names
      expect(text.includes('new Socket()') && file !== 'wifi.ts', file).toBe(false);
    }
  });

  it('keeps the pairing of the network apart from the pair record', () => {
    for (const { file, text } of sources()) {
      if (!['pairing.ts', 'pairing-wire.ts', 'wifi.ts'].includes(file)) continue;
      expect(/readPairRecord|PairRecord|HostPrivateKey|startService/.test(text), file).toBe(false);
    }
  });

  it('reads the pair record and never writes it, and never asks to pair', () => {
    const asked = new Set<string>();
    for (const { file, text } of sources()) {
      for (const [, request] of text.matchAll(/Request: '(\w+)'/g)) if (request) asked.add(request);
      for (const banned of [
        'SavePairRecord',
        'DeletePairRecord',
        'SetValue',
        "'Pair'",
        'Unpair',
        'RemoveValue',
      ]) {
        expect(text.includes(banned), `${file}: ${banned}`).toBe(false);
      }
    }
    // RSDCheckin says who calls a service on our own tunnel: it asks lockdown nothing
    expect([...asked].sort()).toEqual(['QueryType', 'RSDCheckin', 'StartService', 'StartSession']);
    // and the one thing it asks SpringBoard
    const springboard = sources().flatMap((s) => [...s.text.matchAll(/command: '(\w+)'/g)]);
    expect(springboard.map((m) => m[1])).toEqual(['getInterfaceOrientation']);
    const usbmuxd = sources().flatMap((s) =>
      [...s.text.matchAll(/MessageType: '(\w+)'/g)].map((m) => m[1]),
    );
    expect(usbmuxd.sort()).toEqual(['Handshake', 'ReadPairRecord']);
  });

  it('asks for no prompt: nothing here touches the camera or the Mac capture path', () => {
    for (const { file, text } of sources()) {
      expect(/CoreMediaIO|AVCapture/.test(text), file).toBe(false);
      // the phone's one question, which a person asks for by a command of their own
      expect(text.includes('_remotepairing') && file !== 'wifi.ts', file).toBe(false);
    }
  });
});

const dir = mkdtempSync(join(tmpdir(), 'appdyno-phone-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Answers one usbmuxd request with this plist. */
async function usbmuxd(body: string) {
  const path = join(dir, `mux-${Math.random()}.sock`);
  const server = createServer((s) => {
    s.once('data', () => {
      const b = Buffer.from(body);
      const h = Buffer.alloc(16);
      h.writeUInt32LE(16 + b.length, 0);
      h.writeUInt32LE(1, 4);
      h.writeUInt32LE(8, 8);
      s.write(Buffer.concat([h, b]));
    });
  });
  await new Promise<void>((r) => server.listen(path, r));
  return { path, close: () => server.close() };
}

const plist = (inner: string) =>
  `<?xml version="1.0"?><plist version="1.0"><dict>${inner}</dict></plist>`;

describe('the pair record', () => {
  it("none on this Mac is a person's to make, and asked for no further", async () => {
    const mux = await usbmuxd(plist('<key>Number</key><integer>2</integer>'));
    const read = readPairRecord('X', mux.path);
    await expect(read).rejects.toBeInstanceOf(PhoneRefusal);
    await expect(read).rejects.toMatchObject({ need: 'not-trusted' });
    mux.close();
  });

  it('is read as it comes, and what it holds is kept as bytes', async () => {
    const record = writeBplist({
      HostID: 'H',
      SystemBUID: 'B',
      HostCertificate: Buffer.from('cert'),
      HostPrivateKey: Buffer.from('key'),
    });
    const mux = await usbmuxd(
      plist(`<key>PairRecordData</key><data>${record.toString('base64')}</data>`),
    );
    await expect(readPairRecord('X', mux.path)).resolves.toEqual({
      hostId: 'H',
      buid: 'B',
      cert: Buffer.from('cert'),
      key: Buffer.from('key'),
    });
    mux.close();
  });
});

describe('frames to a viewer', () => {
  const pipe = () => {
    const file = join(dir, `frames-${Math.random()}`);
    execFileSync('/usr/bin/mkfifo', ['-m', '600', file]);
    return file;
  };

  const until = async (test: () => boolean) => {
    const end = Date.now() + 5_000;
    while (!test()) {
      if (Date.now() > end) throw new Error('never');
      await new Promise((r) => setTimeout(r, 5));
    }
  };

  /** What the viewer's end holds right now. */
  const drain = (fd: number) => {
    const out: Buffer[] = [];
    const b = Buffer.alloc(1 << 20);
    for (;;) {
      try {
        const n = readSync(fd, b);
        if (n <= 0) break;
        out.push(Buffer.from(b.subarray(0, n)));
      } catch {
        break;
      }
    }
    return Buffer.concat(out);
  };

  it('waits for the viewer, takes the file off the disk, and asks for a key for it', async () => {
    const file = pipe();
    const key = vi.fn();
    const w = new FrameWriter(key, () => undefined);
    const info = { w: 10, h: 20, codec: 'hevc', mode: 'mode 5' } as const;
    w.setInfo(info);
    w.attach(file);
    await new Promise((r) => setTimeout(r, 60));
    expect(key).not.toHaveBeenCalled();
    const fd = openSync(file, constants.O_RDWR | constants.O_NONBLOCK);
    await until(() => key.mock.calls.length > 0);
    expect(existsSync(file)).toBe(false);
    w.picture(Buffer.from('frame'));
    let got = Buffer.alloc(0);
    await until(() => {
      got = Buffer.concat([got, drain(fd)]);
      return got.includes(Buffer.from('frame'));
    });
    // its size first, as a new viewer always needs it, then the picture in an agent's framing
    const n = got.readUInt32BE(0);
    expect(got[4]).toBe(0);
    expect(JSON.parse(got.toString('utf8', 5, 5 + n))).toEqual({
      method: 'stream.info',
      params: info,
    });
    const video = got.subarray(5 + n);
    expect(video.readUInt32BE(0)).toBe(20 + 5);
    expect(video[4]).toBe(2);
    expect(video.toString('latin1', 25)).toBe('frame');
    w.close();
    closeSync(fd);
  });

  it('says only what the protocol holds a viewer to', async () => {
    const file = pipe();
    const key = vi.fn();
    const w = new FrameWriter(key, () => undefined);
    const fd = openSync(file, constants.O_RDWR | constants.O_NONBLOCK);
    w.attach(file);
    await until(() => key.mock.calls.length > 0);
    w.setInfo({ w: 1284, h: 2778, codec: 'hevc', mode: 'mode 5', crop: true });
    w.setTurns(1);
    w.setCounters({ packets: 2400, lostPackets: 3 });
    let got = Buffer.alloc(0);
    await until(() => {
      got = Buffer.concat([got, drain(fd)]);
      return got.includes(Buffer.from('stream.counters'));
    });
    const said: { method: Notification; params: unknown }[] = [];
    for (let at = 0; at < got.length; at += 5 + got.readUInt32BE(at))
      said.push(
        JSON.parse(
          got.toString('utf8', at + 5, at + 5 + got.readUInt32BE(at)),
        ) as (typeof said)[number],
      );
    expect(said.map((m) => m.method)).toEqual(['stream.info', 'stream.turns', 'stream.counters']);
    for (const m of said) expect(() => NOTIFICATIONS[m.method].parse(m.params)).not.toThrow();
    expect(said[2]?.params).toEqual({ packets: 2400, lostPackets: 3, droppedPictures: 0 });
    w.close();
    closeSync(fd);
  });

  it('three pictures wait at most: past them one is dropped, and a key is asked for', async () => {
    const file = pipe();
    const key = vi.fn();
    const w = new FrameWriter(key, () => undefined);
    const fd = openSync(file, constants.O_RDWR | constants.O_NONBLOCK);
    w.attach(file);
    await until(() => key.mock.calls.length > 0);
    key.mockClear();
    const big = Buffer.alloc(1 << 20);
    for (let i = 0; i < 6; i++) w.picture(big);
    expect(w.dropped).toBe(3);
    expect(key).toHaveBeenCalledTimes(3);
    w.close();
    closeSync(fd);
  });

  it('a file that is gone, or a viewer that never comes, is said once', () => {
    const said: string[] = [];
    const w = new FrameWriter(
      () => undefined,
      (why) => said.push(why),
    );
    w.attach(join(dir, 'nothing'));
    expect(said[0]).toContain('ENOENT');
    w.close();
  });

  it('a picture with no viewer costs nothing', () => {
    const w = new FrameWriter(
      () => undefined,
      () => undefined,
    );
    w.picture(Buffer.alloc(10));
    expect(w.dropped).toBe(0);
  });
});
