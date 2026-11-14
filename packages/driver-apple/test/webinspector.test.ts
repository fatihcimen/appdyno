import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inCall, must } from '@appdyno/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBplist, SimulatorWeb, writeBplist, type Plist } from '../src/webinspector.js';
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

/** What the code sends, by the keys a fake inspector reads. */
type Asked = {
  __selector: string;
  __argument: {
    WIRApplicationIdentifierKey: string;
    WIRPageIdentifierKey: number;
    WIRSenderKey: string;
    WIRSocketDataKey: Buffer;
  };
};

describe('the Safari inspector of a simulator', () => {
  const ends: (() => void)[] = [];
  afterEach(() => {
    vi.useRealTimers();
    for (const end of ends.splice(0)) end();
  });

  const webOn = (path: string) => {
    const simctl = { exec: () => Promise.resolve(path) } as unknown as Simctl;
    const web = new SimulatorWeb(simctl, '00000000-0000-0000-0000-000000000000');
    ends.push(() => web.close());
    return web;
  };

  /**
   * `webinspectord_sim` as it answers: apps, a page in each, and a script's value as `ran <script>`. A connection in
   * `quiet` is not answered when it names itself, as one opened within 10 s of another's close; one in `shut` is closed
   * at once, as one opened right at that close; `late` answers each script after a late answer to the one before.
   * `tabs`: the app holds that many pages, as Safari its tabs, and only page `tabs` is the one its document says shows.
   */
  async function fakeInspector({
    quiet = [] as number[],
    shut = [] as number[],
    late = false,
    tabs = 1,
  } = {}) {
    const path = join(mkdtempSync(join(tmpdir(), 'appdyno-inspector-')), 's');
    const apps: Record<string, Plist> = {
      'PID:1': {
        WIRApplicationIdentifierKey: 'PID:1',
        WIRApplicationBundleIdentifierKey: 'com.apple.mobilesafari',
        WIRIsApplicationActiveKey: 2,
      },
    };
    const sockets: Socket[] = [];
    const lists: (() => void)[] = [];
    const naming: (() => void)[] = [];
    const named = [0, 1, 2, 3].map((n) => new Promise<void>((r) => (naming[n] = r)));
    let before: string | undefined;
    const server = createServer((socket) => {
      const n = sockets.push(socket);
      socket.on('error', () => undefined);
      if (shut.includes(n)) socket.destroy();
      const say = (selector: string, argument: Record<string, Plist>) => {
        const body = writeBplist({ __selector: selector, __argument: argument });
        const head = Buffer.alloc(4);
        head.writeUInt32BE(body.length);
        socket.write(Buffer.concat([head, body]));
      };
      const list = () =>
        say('_rpc_reportConnectedApplicationList:', { WIRApplicationDictionaryKey: apps });
      lists[n] = list;
      const toPage = (sender: string, data: object) =>
        say('_rpc_applicationSentData:', {
          WIRDestinationKey: sender,
          WIRMessageDataKey: Buffer.from(JSON.stringify(data)),
        });
      const ran = (sender: string, script: string, page = 1) =>
        toPage(sender, {
          method: 'Target.dispatchMessageFromTarget',
          params: {
            targetId: 'page-1',
            message: JSON.stringify({
              id: 2,
              result: {
                result: {
                  value:
                    script === 'document.visibilityState'
                      ? page === tabs
                        ? 'visible'
                        : 'hidden'
                      : `ran ${script}`,
                },
              },
            }),
          },
        });
      let rest = Buffer.alloc(0);
      socket.on('data', (d) => {
        rest = Buffer.concat([rest, d]);
        while (rest.length >= 4 && rest.length >= 4 + rest.readUInt32BE(0)) {
          const size = rest.readUInt32BE(0);
          const { __selector, __argument: a } = readBplist(rest.subarray(4, 4 + size)) as Asked;
          rest = rest.subarray(4 + size);
          if (__selector === '_rpc_reportIdentifier:') {
            naming[n]?.();
            if (!quiet.includes(n)) list();
          } else if (__selector === '_rpc_getConnectedApplications:') list();
          else if (__selector === '_rpc_forwardGetListing:')
            say('_rpc_applicationSentListing:', {
              WIRApplicationIdentifierKey: a.WIRApplicationIdentifierKey,
              WIRListingKey: Object.fromEntries(
                Array.from({ length: tabs }, (_, i) => [
                  i + 1,
                  {
                    WIRPageIdentifierKey: i + 1,
                    WIRTypeKey: 'WIRTypeWebPage',
                    WIRTitleKey: `${i ? `page ${i + 1}` : 'a page'} of ${a.WIRApplicationIdentifierKey}`,
                    WIRURLKey: 'https://example.com/',
                  },
                ]),
              ),
            });
          else if (__selector === '_rpc_forwardSocketSetup:')
            toPage(a.WIRSenderKey, {
              method: 'Target.targetCreated',
              params: { targetInfo: { targetId: 'page-1', type: 'page' } },
            });
          else if (__selector === '_rpc_forwardSocketData:') {
            const { params } = JSON.parse(a.WIRSocketDataKey.toString()) as {
              params: { message: string };
            };
            const script = (JSON.parse(params.message) as { params: { expression: string } }).params
              .expression;
            if (late && before) ran(before, 'an earlier script');
            ran(a.WIRSenderKey, script, a.WIRPageIdentifierKey);
            before = a.WIRSenderKey;
          }
        }
      });
    });
    await new Promise<void>((r) => server.listen(path, r));
    ends.push(() => server.close());
    return { path, apps, sockets, named, listOn: (n: number) => lists[n]?.() };
  }

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
    const failed = (await webOn(path)
      .pages(undefined)
      .catch((e: unknown) => e)) as { message: string; hint?: string };
    expect(failed.message).toBe('the Safari inspector said nothing');
    // the inspector is what failed, not the device
    expect(failed.hint).toMatch(/^ask again: the simulator's inspector/);
    server.close();
  });

  it('lists the pages and runs scripts on them over one connection, as a second is served only seconds after the first closed', async () => {
    const inspector = await fakeInspector({ quiet: [2, 3] });
    const web = webOn(inspector.path);
    const page = must((await web.pages('com.apple.mobilesafari'))[0], 'a page');
    expect(page).toEqual({
      id: 'PID:1/1',
      title: 'a page of PID:1',
      url: 'https://example.com/',
      app: 'com.apple.mobilesafari',
      visible: true,
    });
    // a read may run beside an action: each waits its turn on the one connection
    const both = [web.evaluate(page, 'document.title'), web.evaluate(page, '1 + 1')];
    expect(await Promise.all(both)).toEqual(['ran document.title', 'ran 1 + 1']);
    expect(inspector.sockets).toHaveLength(1);
    web.close();
    await new Promise((r) => must(inspector.sockets[0], 'the connection').once('close', r));
  });

  it('waits for an app list that comes late, and says what it waits for', async () => {
    const inspector = await fakeInspector({ quiet: [1] });
    const web = webOn(inspector.path);
    const said: string[] = [];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const pages = inCall({ progress: (m) => said.push(m) }, () => web.pages(undefined));
    await inspector.named[1];
    await vi.advanceTimersByTimeAsync(10_000);
    inspector.listOn(1);
    expect((await pages).map((p) => p.id)).toEqual(['PID:1/1']);
    expect(said.at(-1)).toMatch(/^the Safari inspector has said nothing for 9 s/);
  });

  it('opens one more connection when the first is never answered', async () => {
    const inspector = await fakeInspector({ quiet: [1] });
    const web = webOn(inspector.path);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const pages = web.pages(undefined);
    await inspector.named[1];
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await pages).map((p) => p.id)).toEqual(['PID:1/1']);
    expect(inspector.sockets).toHaveLength(2);
  });

  it('ends a connection the inspector has not answered yet when it is closed, and opens no other', async () => {
    const inspector = await fakeInspector({ quiet: [1, 2] });
    const web = webOn(inspector.path);
    const pages = web.pages(undefined).then(
      () => 'listed',
      () => 'ended',
    );
    await inspector.named[1];
    // a one-shot command's close: a wait left running would hold its process for the inspector's 10 s
    web.close();
    expect(await pages).toBe('ended');
    expect(inspector.sockets).toHaveLength(1);
  });

  it('opens one more connection when the inspector closes the first at once', async () => {
    const inspector = await fakeInspector({ shut: [1] });
    expect((await webOn(inspector.path).pages(undefined)).map((p) => p.id)).toEqual(['PID:1/1']);
    expect(inspector.sockets).toHaveLength(2);
  });

  it('says only the tab its document shows is showing, where the app in front holds several', async () => {
    const inspector = await fakeInspector({ tabs: 2 });
    const pages = await webOn(inspector.path).pages('com.apple.mobilesafari');
    expect(pages.map((p) => [p.title, p.visible])).toEqual([
      ['a page of PID:1', undefined],
      ['page 2 of PID:1', true],
    ]);
    expect(inspector.sockets).toHaveLength(1);
  });

  it('lists an app that came after its connection opened', async () => {
    const inspector = await fakeInspector();
    const web = webOn(inspector.path);
    expect(await web.pages('dev.app')).toEqual([]);
    inspector.apps['PID:2'] = {
      WIRApplicationIdentifierKey: 'PID:2',
      WIRApplicationBundleIdentifierKey: 'dev.app',
    };
    expect((await web.pages('dev.app')).map((p) => p.id)).toEqual(['PID:2/1']);
  });

  it("takes a script's answer from its own page, not a late one for the script before", async () => {
    const inspector = await fakeInspector({ late: true });
    const web = webOn(inspector.path);
    const page = must((await web.pages(undefined))[0], 'a page');
    await web.evaluate(page, 'first');
    expect(await web.evaluate(page, 'second')).toBe('ran second');
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
