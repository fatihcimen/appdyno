import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISPLAY, HID_INDIGO, HID_UNIVERSAL } from '../services.js';
import { PhoneStream, type StreamSink, type StreamWire } from '../stream.js';
import { ownSessions, rememberOwn, StreamRefusal } from '../stream-state.js';
import type { DecodedDict } from '../xpc-codec.js';

const FEATURE = 'com.apple.coredevice.feature.';
const short = (feature: string) => feature.replace(FEATURE, '');

/** A session as a phone's status lists it. */
const session = (id: string) => ({
  connection: { options: { avcMediaStreamOptionClientSessionID: { uuid: id } } },
});

/** What a phone says of a stream it started. */
const STARTED = () => ({
  connection: {
    sender: { port: 9000 },
    streamConfig: { CustomWidth: 1284, CustomHeight: 2778 },
  },
});

/** A phone that answers as it is told, and keeps what it was asked. */
function phone(answers: Partial<Record<string, () => DecodedDict>> = {}) {
  const asked: string[] = [];
  const closed: string[] = [];
  const closes = (name: string) => () => void closed.push(name);
  const sent = { video: 0, audio: 0 };
  let ended: ((why: string) => void) | undefined;
  const udp = (name: 'video' | 'audio', localPort: number) => ({
    localPort,
    message: undefined,
    send: () => void sent[name]++,
    close: closes(name),
  });
  let ports = 0;
  const stack = {
    localAddress: 'fd00::2',
    remoteAddress: 'fd00::1',
    onEnded: (f: (why: string) => void) => void (ended = f),
    connect: async (port: number) => ({ port }),
    // the audio socket is made first
    createUdp: () => (ports++ % 2 ? udp('video', 7000 + ports) : udp('audio', 7000 + ports)),
    close: closes('stack'),
  };
  const defaults: Record<string, () => DecodedDict> = {
    getmediasupportinfo: () => ({}),
    getmediastreamserverstatus: () => ({ running: false, sessions: [] }),
    stopmediastream: () => ({}),
    startmediastream: STARTED,
  };
  const wire = {
    openTunnel: async () => ({ stack, rsdPort: 1 }),
    readServices: async () => ({
      ports: { [DISPLAY]: 2, [HID_INDIGO]: 3, [HID_UNIVERSAL]: 4 },
      properties: {},
      close: closes('services'),
    }),
    invoke: async (_x: unknown, feature: string) => {
      const name = short(feature);
      asked.push(name);
      return (answers[name] ?? defaults[name]!)();
    },
    takeScreenshot: async () => {
      // a PNG's header, all a size needs
      const png = Buffer.alloc(24);
      png[0] = 0x89;
      png.writeUInt32BE(1179, 16);
      png.writeUInt32BE(2556, 20);
      return png;
    },
    orientationReader: async () => ({ read: async () => 1, close: closes('orientation') }),
    thisMac: () => ({ model: 'Mac17,1', avc: '1', build: '26A' }),
    xpc: () => ({ close: closes('xpc') }),
  } as unknown as StreamWire;
  return { wire, asked, closed, sent, end: (why: string) => ended?.(why) };
}

function sink() {
  const lost: string[] = [];
  const live: { w: number; h: number; mode: string; crop: boolean }[] = [];
  const out: StreamSink = {
    live: (info) => void live.push(info),
    picture: () => undefined,
    state: () => undefined,
    counters: () => undefined,
    turns: () => undefined,
    lost: (why) => void lost.push(why),
  };
  return { out, lost, live };
}

const ALIVE_MS = 1_000;
let udid: string;

beforeEach(() => {
  udid = randomUUID();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});
afterEach(() => {
  vi.useRealTimers();
  rememberOwn(udid, []);
});

describe('a stream starting', () => {
  it('takes a mode, says what it took, and keeps its session as its own', async () => {
    const p = phone();
    const s = sink();
    const stream = await PhoneStream.open(udid, 'auto', s.out, p.wire);
    expect(s.live).toEqual([{ w: 1284, h: 2778, mode: 'mode 7', crop: false }]);
    expect(p.asked.filter((a) => a === 'startmediastream')).toHaveLength(2);
    expect(ownSessions(udid)).toHaveLength(1);
    await stream.stop();
  });

  it('asks standard for the lower mode alone, with the screen at the top left of its picture', async () => {
    const p = phone();
    const s = sink();
    const stream = await PhoneStream.open(udid, 'standard', s.out, p.wire);
    expect(s.live).toEqual([{ w: 1179, h: 2556, mode: 'mode 5', crop: true }]);
    await stream.stop();
  });

  it('refuses a phone another app is streaming from, and touches nothing of it', async () => {
    const p = phone({
      getmediastreamserverstatus: () => ({ sessions: [session('someone-else')] }),
    });
    await expect(PhoneStream.open(udid, 'auto', sink().out, p.wire)).rejects.toMatchObject({
      need: 'taken-over',
    });
    expect(p.asked).not.toContain('stopmediastream');
    expect(p.asked).not.toContain('startmediastream');
  });

  it('names every session a retried start tried, as one left on the phone reads as a stranger', async () => {
    let starts = 0;
    const p = phone({
      startmediastream: () => {
        if (starts++ === 0) throw new Error('no such mode');
        return STARTED();
      },
    });
    const s = sink();
    const stream = await PhoneStream.open(udid, 'auto', s.out, p.wire);
    expect(s.live[0]!.mode).toBe('mode 5');
    expect(ownSessions(udid)).toHaveLength(2);
    await stream.stop();
  });

  it('ends what a process of ours left behind, and only then starts', async () => {
    rememberOwn(udid, ['AAAA-BBBB']);
    const p = phone({
      getmediastreamserverstatus: () => ({ sessions: [session('aaaabbbb')] }),
    });
    const stream = await PhoneStream.open(udid, 'auto', sink().out, p.wire);
    const [stop, start] = [p.asked.indexOf('stopmediastream'), p.asked.indexOf('startmediastream')];
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(start);
    await stream.stop().catch(() => undefined);
  });

  it('says a phone with no display service as the disk image it lacks', async () => {
    const p = phone();
    p.wire.readServices = async () => ({ ports: {}, properties: {}, close: () => undefined });
    await expect(PhoneStream.open(udid, 'auto', sink().out, p.wire)).rejects.toMatchObject({
      need: 'disk-image-missing',
    });
  });

  it('takes the lower mode where the higher one fails', async () => {
    let starts = 0;
    const p = phone({
      startmediastream: () => {
        if (++starts === 1) throw new Error('no such mode');
        return {
          connection: {
            sender: { port: 9000 },
            streamConfig: { CustomWidth: 1284, CustomHeight: 2778 },
          },
        };
      },
    });
    const s = sink();
    const stream = await PhoneStream.open(udid, 'auto', s.out, p.wire);
    expect(s.live[0]?.mode).toBe('mode 5');
    await stream.stop();
  });

  it('stops at a reason a person can act on, with no second try', async () => {
    let starts = 0;
    const p = phone({
      startmediastream: () => {
        starts++;
        throw new Error('The device microphone or camera is in use');
      },
    });
    await expect(PhoneStream.open(udid, 'auto', sink().out, p.wire)).rejects.toBeInstanceOf(
      StreamRefusal,
    );
    expect(starts).toBe(1);
  });

  it('lets go of all it opened when it cannot go on, and says nothing of that end', async () => {
    const p = phone({
      startmediastream: () => {
        throw new Error('refused');
      },
    });
    const s = sink();
    await expect(PhoneStream.open(udid, 'auto', s.out, p.wire)).rejects.toThrow('refused');
    expect(p.closed).toEqual(expect.arrayContaining(['stack', 'services', 'xpc']));
    p.end('the tunnel ended');
    expect(s.lost).toEqual([]);
    vi.advanceTimersByTime(ALIVE_MS * 3);
    expect(p.sent.video).toBe(0);
  });
});

describe('a stream that runs', () => {
  it('keeps telling the phone it is there, which is what keeps the stream up', async () => {
    const p = phone();
    const stream = await PhoneStream.open(udid, 'auto', sink().out, p.wire);
    const before = p.sent.audio;
    vi.advanceTimersByTime(ALIVE_MS * 3);
    expect(p.sent.audio - before).toBe(3);
    await stream.stop();
  });

  it('says the end of its tunnel once, and lets go of all it opened', async () => {
    const p = phone();
    const s = sink();
    await PhoneStream.open(udid, 'auto', s.out, p.wire);
    p.end('the tunnel ended');
    p.end('the tunnel ended');
    expect(s.lost).toEqual(['the tunnel ended']);
    expect(p.closed).toContain('stack');
    const sent = p.sent.audio;
    vi.advanceTimersByTime(ALIVE_MS * 3);
    expect(p.sent.audio).toBe(sent);
  });
});

describe('a stream stopping', () => {
  const stopped = async (after: () => DecodedDict) => {
    const started = { done: false };
    const p = phone({
      getmediastreamserverstatus: () => {
        const answer = started.done ? after() : { sessions: [] };
        return answer;
      },
    });
    const stream = await PhoneStream.open(udid, 'auto', sink().out, p.wire);
    started.done = true;
    return { p, stream, proved: await stream.stop() };
  };

  it('is proved by a phone that says nothing runs, and forgets its session', async () => {
    const { proved } = await stopped(() => ({ running: false, sessions: [session('x')] }));
    expect(proved).toBe(true);
    expect(ownSessions(udid)).toEqual([]);
  });

  it('is proved by a phone with no session left', async () => {
    expect((await stopped(() => ({ running: true, sessions: [] }))).proved).toBe(true);
  });

  it('is not proved by a phone that still lists one, and keeps it to end next time', async () => {
    const { proved } = await stopped(() => ({ running: true, sessions: [session('x')] }));
    expect(proved).toBe(false);
    expect(ownSessions(udid)).toHaveLength(1);
  });

  it('is not proved by a phone that does not answer, and lets go all the same', async () => {
    const { proved, p } = await stopped(() => {
      throw new Error('no answer');
    });
    expect(proved).toBe(false);
    expect(p.closed).toEqual(expect.arrayContaining(['stack', 'services', 'video', 'audio']));
  });

  it('tells the phone nothing more, so that its own timeout ends what it did not hear', async () => {
    const { p } = await stopped(() => ({ running: false }));
    const sent = p.sent.audio;
    vi.advanceTimersByTime(ALIVE_MS * 3);
    expect(p.sent.audio).toBe(sent);
  });

  it('claims no proof the second time, or of a stream already lost', async () => {
    const { stream } = await stopped(() => ({ running: false }));
    await expect(stream.stop()).resolves.toBe(false);
    const p = phone();
    const lost = await PhoneStream.open(udid, 'auto', sink().out, p.wire);
    p.end('the tunnel ended');
    await expect(lost.stop()).resolves.toBe(false);
  });
});
