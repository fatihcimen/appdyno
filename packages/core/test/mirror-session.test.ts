import { describe, expect, it } from 'vitest';
import { must } from '../src/must.js';
import {
  MirrorSession,
  NeedError,
  NEEDS,
  type MirrorSessionOptions,
  type MirrorStatus,
} from '../src/index.js';
import { FakeClock, FakeMirror, FakeViewer, flush } from '@appdyno/testing/mirror-fakes.js';

function setup(over: Partial<MirrorSessionOptions> = {}) {
  const clock = new FakeClock();
  const mirror = new FakeMirror();
  const viewers: FakeViewer[] = [];
  const seen: MirrorStatus[] = [];
  const session = new MirrorSession({
    mirror,
    viewer: () => {
      const v = new FakeViewer();
      viewers.push(v);
      return Promise.resolve(v);
    },
    options: { quality: 'auto' },
    title: 'a device',
    clock,
    onChange: (s) => seen.push(s),
    ...over,
  });
  const viewer = () => must(viewers.at(-1), 'a viewer');
  const live = async () => {
    await session.start();
    await flush();
    viewer().say('first', { w: 1080, h: 2400, codec: 'h264' });
  };
  return { clock, mirror, viewers, viewer, seen, session, live };
}

describe('a mirror, whatever the device', () => {
  it('is live on its first picture, with the source, title and input it was given', async () => {
    const { session, viewer, mirror } = setup();
    await session.start();
    await flush();
    expect(session.status.state).toBe('connecting');
    expect(viewer().of('attach')).toEqual([
      expect.objectContaining({
        source: mirror.source,
        title: 'a device',
        input: true,
      }),
    ]);
    viewer().say('first', { w: 1080, h: 2400, codec: 'h264' });
    expect(session.status).toMatchObject({
      state: 'live',
      picture: { w: 1080, h: 2400, codec: 'h264' },
    });
    expect(viewer().of('status').at(-1)).toMatchObject({ state: 'live' });
  });

  it('says on the window that it goes by the network, and what a person should know of it', async () => {
    const { mirror, viewer, session, live } = setup();
    mirror.checkAnswer = { ok: true, routes: ['tunnel', 'wifi'] };
    mirror.source = { kind: 'pipe', file: '/f', codec: 'hevc', note: 'On Wi-Fi: slower' };
    await live();
    expect(viewer().of('attach')[0]).toMatchObject({ title: 'a device on Wi-Fi' });
    expect(viewer().of('note')).toMatchObject([{ text: 'On Wi-Fi: slower' }]);
    expect(session.status.note).toBe('On Wi-Fi: slower');
  });

  it('gives a window how to draw its device', async () => {
    const look = { frame: { model: 'iPhone 17 Pro' }, controls: ['home'] };
    const { session, viewer } = setup({ look });
    await session.start();
    await flush();
    expect(viewer().of('attach')[0]).toMatchObject({ look });
  });

  it('lets what is more than a key take a press, and leaves the rest to the device', async () => {
    const taken: string[] = [];
    const { viewer, mirror, live } = setup({
      press: (name) => {
        taken.push(name);
        return name === 'siri';
      },
    });
    await live();
    viewer().say('button', { name: 'siri' });
    viewer().say('button', { name: 'home' });
    await flush();
    expect(taken).toEqual(['siri', 'home']);
    expect(mirror.inputs).toEqual([{ kind: 'button', name: 'home' }]);
  });

  it('tells of what a person did once it has left for the device, and of nothing that did not', async () => {
    const heard: unknown[] = [];
    const inputsThen: number[] = [];
    const { viewer, mirror, live, session } = setup({
      onInput: (e) => {
        heard.push(e);
        inputsThen.push(mirror.inputs.length);
      },
      press: (name) => name === 'rotateLeft',
    });
    await session.start();
    await flush();
    viewer().say('touch', { p: 0, x: 0.1, y: 0.2 });
    expect(heard).toEqual([]);
    await live();
    viewer().say('touch', { p: 0, x: 0.1, y: 0.2, wheel: true });
    viewer().say('button', { name: 'rotateLeft' });
    await flush();
    expect(heard).toEqual([
      { kind: 'touch', p: 0, x: 0.1, y: 0.2, wheel: true },
      { kind: 'button', name: 'rotateLeft' },
    ]);
    expect(inputsThen[0]).toBe(1);
  });

  it('lets a pair of windows take what a person does, and leaves the rest to the window', async () => {
    const seen: string[] = [];
    const { viewer, mirror, live } = setup({
      takeInput: (e) => e.kind === 'touch',
      press: (name) => {
        seen.push(name);
        return false;
      },
    });
    await live();
    viewer().say('touch', { p: 0, x: 0.5, y: 0.5 });
    viewer().say('button', { name: 'home' });
    await flush();
    expect(seen).toEqual(['home']);
    expect(mirror.inputs).toEqual([{ kind: 'button', name: 'home' }]);
  });

  it('holds a press while the stream is down, as it does a touch', async () => {
    const taken: string[] = [];
    const { viewer, session } = setup({
      press: (name) => {
        taken.push(name);
        return true;
      },
    });
    await session.start();
    await flush();
    viewer().say('button', { name: 'siri' });
    expect(taken).toEqual([]);
  });

  it("passes a window's controls on, whether or not input is on", async () => {
    const said: unknown[] = [];
    const { viewer, live } = setup({ noInput: true, onWindow: (m) => said.push(m) });
    await live();
    viewer().say('control', { name: 'screenshot' });
    viewer().say('app', { action: 'list' });
    expect(said).toEqual([
      expect.objectContaining({ op: 'control', name: 'screenshot' }),
      expect.objectContaining({ op: 'app', action: 'list' }),
    ]);
  });

  it('knows a stream records its own frames, and a surface does not', async () => {
    const { session, viewer, mirror } = setup();
    mirror.source = {
      kind: 'adb',
      encoded: true,
      serial: 's',
      socket: 'x',
      token: 't',
      codec: 'h264',
    };
    await session.start();
    await flush();
    viewer().say('first', { w: 1080, h: 2400, codec: 'h264' });
    expect(session.streamsItsOwn).toBe(true);
    const other = setup();
    await other.live();
    expect(other.session.streamsItsOwn).toBe(false);
  });

  it('asks for a new stream at a word from a person, and not once stopped', async () => {
    const { session, mirror, clock, live } = setup();
    await live();
    const opens = mirror.opens;
    session.askAgain();
    await flush();
    await clock.advance(1_000);
    expect(mirror.opens).toBe(opens + 1);
    await session.stop('done');
    session.askAgain();
    await flush();
    await clock.advance(1_000);
    expect(mirror.opens).toBe(opens + 1);
  });

  it('waits for what stands in the way, asks each second, and goes on by itself', async () => {
    const { session, mirror, clock, viewer } = setup();
    mirror.checkAnswer = { ok: false, need: 'not-connected' };
    await session.start();
    await flush();
    expect(session.status).toMatchObject({ state: 'waiting', need: 'not-connected' });
    expect(mirror.opens).toBe(0);
    expect(viewer().of('status').at(-1)).toMatchObject(NEEDS['not-connected']);
    const asked = mirror.checks;
    await clock.advance(3_000);
    expect(mirror.checks - asked).toBe(3);
    mirror.checkAnswer = { ok: false, need: 'asleep' };
    await clock.advance(1_000);
    expect(session.status).toMatchObject({ state: 'waiting', need: 'asleep' });
    mirror.checkAnswer = { ok: true, routes: ['x'] };
    await clock.advance(1_000);
    expect(mirror.opens).toBe(1);
    viewer().say('first', { w: 1, h: 2, codec: 'x' });
    expect(session.status.state).toBe('live');
  });

  it('unplugged: the last picture stays with a banner, and it comes back within 2 s', async () => {
    const { session, mirror, clock, viewer, live } = setup();
    await live();
    mirror.checkAnswer = { ok: false, need: 'not-connected' };
    viewer().say('lost', { why: 'the stream ended' });
    await flush();
    expect(session.status).toMatchObject({ state: 'waiting', need: 'not-connected' });
    expect(mirror.closes).toBe(1);
    expect(viewer().of('status').at(-1)).toMatchObject(NEEDS['not-connected']);
    mirror.checkAnswer = { ok: true, routes: ['x'] };
    await clock.advance(1_000);
    expect(viewer().of('attach')).toHaveLength(2);
    viewer().say('first', { w: 1, h: 2, codec: 'x' });
    expect(session.status.state).toBe('live');
  });

  it('agent gone, device there: reconnects with growing pauses, and counts from zero once live', async () => {
    const { session, mirror, clock, viewer, live } = setup();
    await live();
    viewer().say('lost', { why: 'the stream ended' });
    await flush();
    expect(session.status).toMatchObject({ state: 'reconnecting', attempt: 1 });
    await clock.advance(200);
    expect(viewer().of('attach')).toHaveLength(2);
    viewer().say('lost', { why: 'the stream ended' });
    await flush();
    expect(session.status).toMatchObject({ state: 'reconnecting', attempt: 2 });
    await clock.advance(399);
    expect(viewer().of('attach')).toHaveLength(2);
    await clock.advance(1);
    expect(viewer().of('attach')).toHaveLength(3);
    viewer().say('first', { w: 1, h: 2, codec: 'x' });
    viewer().say('lost', { why: 'again' });
    await flush();
    expect(session.status).toMatchObject({ state: 'reconnecting', attempt: 1 });
    expect(mirror.opens).toBe(3);
  });

  it('stops with the reason when it cannot open, rather than try for ever', async () => {
    const { session, mirror, clock } = setup();
    mirror.openFails = new Error('no agent');
    await session.start();
    await clock.advance(120_000);
    expect(session.status).toMatchObject({ state: 'stopped' });
    expect((session.status as { why: string }).why).toContain('no agent');
    expect(mirror.opens).toBe(11);
  });

  it('a refusal a person can clear is waited for', async () => {
    const { session, mirror, clock } = setup();
    mirror.openFails = new NeedError('os-too-old');
    await session.start();
    await flush();
    expect(session.status).toMatchObject({ state: 'waiting', need: 'os-too-old' });
    mirror.openFails = undefined;
    await clock.advance(1_000);
    expect(mirror.opens).toBe(2);
  });

  it('a device that cannot answer tries again; one that never will stops it, saying why', async () => {
    const tries = setup();
    tries.mirror.check = () => Promise.reject(new Error('adb is restarting'));
    await tries.session.start();
    await flush();
    expect(tries.session.status).toMatchObject({ state: 'reconnecting', attempt: 1 });
    const never = setup();
    never.mirror.check = () =>
      Promise.reject(Object.assign(new Error('another tool holds UI automation'), { fatal: true }));
    await never.session.start();
    await flush();
    expect(never.session.status).toMatchObject({
      state: 'stopped',
      why: 'another tool holds UI automation',
    });
  });

  it('says what its feeder wants a person to know of the picture', async () => {
    const { session, mirror, viewer } = setup();
    mirror.source = {
      kind: 'adb',
      serial: 'e',
      socket: 's',
      token: 't',
      codec: 'h264',
      note: 'lags by seconds',
    };
    await session.start();
    await flush();
    viewer().say('first', { w: 1, h: 2, codec: 'h264' });
    expect(session.status.note).toBe('lags by seconds');
  });

  it('a final word from the far end stops it: an encoder ladder with no step left', async () => {
    const { session, viewer, live } = setup();
    await live();
    viewer().say('lost', { why: 'no encoder took this display', fatal: true });
    await flush();
    expect(session.status).toMatchObject({ state: 'stopped', why: 'no encoder took this display' });
    expect(viewer().of('quit')).toHaveLength(1);
  });

  it('decoder: asks for a keyframe; three failures in a row, a new stream; again, it stops', async () => {
    const { session, mirror, clock, viewer, live } = setup();
    await live();
    viewer().say('needKey', { consecutive: 1 });
    await flush();
    expect(mirror.keyframes).toBe(1);
    expect(viewer().of('attach')).toHaveLength(1);
    viewer().say('needKey', { consecutive: 3 });
    await flush();
    expect(viewer().of('detach')).toHaveLength(1);
    await clock.advance(200);
    expect(viewer().of('attach')).toHaveLength(2);
    viewer().say('first', { w: 1, h: 2, codec: 'x' });
    viewer().say('needKey', { consecutive: 3 });
    await flush();
    expect(session.status.state).toBe('stopped');
  });

  it('a stream that decodes again earns its second chance back', async () => {
    const { session, clock, viewer, live } = setup();
    await live();
    viewer().say('needKey', { consecutive: 3 });
    await flush();
    await clock.advance(200);
    viewer().say('first', { w: 1, h: 2, codec: 'x' });
    viewer().say('stats', { decoded: 30 });
    viewer().say('needKey', { consecutive: 3 });
    await flush();
    expect(session.status.state).toBe('reconnecting');
  });

  it('viewer dies: restarted at once with the same zoom; twice in a minute, it stops with what it said', async () => {
    const { session, mirror, viewer, viewers, live } = setup();
    await live();
    viewer().say('zoom', { scale: 0.5 });
    viewer().die('a crash');
    await flush();
    expect(viewers).toHaveLength(2);
    expect(mirror.closes).toBe(1);
    expect(viewer().of('attach')[0]).toMatchObject({ zoom: 0.5 });
    viewer().say('first', { w: 1, h: 2, codec: 'x' });
    viewer().die('the second crash');
    await flush();
    expect(session.status).toMatchObject({ state: 'stopped' });
    expect((session.status as { why: string }).why).toContain('the second crash');
    expect(viewers).toHaveLength(2);
  });

  it('viewer deaths far apart are each forgiven', async () => {
    const { session, clock, viewer, viewers, live } = setup();
    await live();
    viewer().die();
    await flush();
    await clock.advance(61_000);
    viewer().say('first', { w: 1, h: 2, codec: 'x' });
    viewer().die();
    await flush();
    expect(session.status.state).not.toBe('stopped');
    expect(viewers).toHaveLength(3);
  });

  it('the window closed by a person ends it, with no restart', async () => {
    const { session, mirror, viewer, viewers, live } = setup();
    await live();
    viewer().say('closed');
    viewer().die();
    await flush();
    expect(session.status).toMatchObject({ state: 'stopped', why: 'the window was closed' });
    expect(viewers).toHaveLength(1);
    expect(mirror.closes).toBe(1);
  });

  it('no window server: stopped, by its need', async () => {
    const { session, viewer } = setup();
    await session.start();
    viewer().say('refused', { need: 'no-display' });
    viewer().die();
    await flush();
    expect(session.status).toMatchObject({ state: 'stopped', need: 'no-display' });
  });

  it('no compiler: stopped, by its need, before anything opens', async () => {
    const { session, mirror } = setup({
      viewer: () => Promise.reject(new NeedError('no-compiler')),
    });
    await session.start();
    expect(session.status).toMatchObject({ state: 'stopped', need: 'no-compiler' });
    expect(mirror.opens).toBe(0);
  });

  it('no first picture from a simulator: named, and a late picture clears it', async () => {
    const { session, mirror, clock, viewer } = setup();
    mirror.noFirstFrame = { ms: 3_000, need: 'presented-elsewhere' };
    await session.start();
    await flush();
    await clock.advance(3_000);
    expect(session.status).toMatchObject({ state: 'waiting', need: 'presented-elsewhere' });
    expect(viewer().of('detach')).toHaveLength(0);
    viewer().say('first', { w: 1, h: 2, codec: 'surface' });
    expect(session.status.state).toBe('live');
  });

  it('no first picture elsewhere: a new stream', async () => {
    const { session, clock, viewer } = setup();
    await session.start();
    await flush();
    await clock.advance(15_000);
    expect(viewer().of('detach')).toHaveLength(1);
    expect(session.status.state).toBe('reconnecting');
  });

  it('Mac sleeps: the stream ends; wakes: it comes back', async () => {
    const { session, mirror, clock, viewer, live } = setup();
    await live();
    viewer().say('sleep');
    await flush();
    expect(viewer().of('detach')).toHaveLength(1);
    expect(mirror.closes).toBe(1);
    await clock.advance(60_000);
    expect(mirror.opens).toBe(1);
    viewer().say('wake');
    await flush();
    expect(mirror.opens).toBe(2);
    viewer().say('first', { w: 1, h: 2, codec: 'x' });
    expect(session.status.state).toBe('live');
  });

  it('a state the device pushes is waited out; ok goes on at once', async () => {
    const { session, mirror, viewer, live } = setup();
    await live();
    mirror.checkAnswer = { ok: false, need: 'asleep' };
    must(mirror.push, 'a session that listens')('asleep');
    await flush();
    expect(session.status).toMatchObject({ state: 'waiting', need: 'asleep' });
    expect(viewer().of('detach')).toHaveLength(1);
    mirror.checkAnswer = { ok: true, routes: ['x'] };
    must(mirror.push, 'a session that listens')('ok');
    await flush();
    expect(mirror.opens).toBe(2);
  });

  it('a state its stream holds through changes what is said, and nothing else', async () => {
    const { session, mirror, viewer, live } = setup();
    await live();
    mirror.holdsThrough = 'asleep';
    must(mirror.push, 'a session that listens')('asleep');
    must(mirror.push, 'a session that listens')('asleep');
    await flush();
    expect(session.status).toMatchObject({ state: 'waiting', need: 'asleep' });
    expect(viewer().of('detach')).toHaveLength(0);
    must(mirror.push, 'a session that listens')('ok');
    await flush();
    expect(session.status.state).toBe('live');
    expect(mirror.opens).toBe(1);
    // and a device gone from under it is a loss as ever
    must(mirror.push, 'a session that listens')('asleep');
    await flush();
    mirror.checkAnswer = { ok: false, need: 'not-connected' };
    must(mirror.push, 'a session that listens')('not-connected');
    await flush();
    expect(session.status).toMatchObject({ state: 'waiting', need: 'not-connected' });
    expect(viewer().of('detach')).toHaveLength(1);
  });

  it('the keyboard goes with the first attach and no other, and only when asked for', async () => {
    const { session, mirror, viewer, live } = setup({ focus: true, inputOnClick: true });
    await live();
    expect(viewer().of('attach')[0]).toMatchObject({ focus: true, input: 'click' });
    mirror.checkAnswer = { ok: false, need: 'asleep' };
    must(mirror.push, 'a session that listens')('asleep');
    await flush();
    mirror.checkAnswer = { ok: true, routes: ['x'] };
    must(mirror.push, 'a session that listens')('ok');
    await flush();
    expect(viewer().of('attach')[1]).toMatchObject({ focus: false, input: 'click' });
    session.raise();
    expect(viewer().of('raise')).toHaveLength(1);
    const plain = setup();
    await plain.live();
    expect(plain.viewer().of('attach')[0]).toMatchObject({ focus: false, input: true });
  });

  it('a start wakes the screen, and so does a click on a dark window', async () => {
    const { session, mirror, viewer, live } = setup();
    await live();
    expect(mirror.wakes).toBe(1);
    viewer().say('touch', { p: 0, x: 0, y: 0 });
    expect(mirror.wakes).toBe(1);
    mirror.checkAnswer = { ok: false, need: 'asleep' };
    must(mirror.push, 'a session that listens')('asleep');
    await flush();
    viewer().say('touch', { p: 0, x: 0, y: 0 });
    expect(mirror.wakes).toBe(2);
    expect(session.status).toMatchObject({ state: 'waiting', need: 'asleep' });
  });

  it('Try Again on a dark screen wakes it, and starts no new stream', async () => {
    const { session, mirror, clock, live } = setup();
    await live();
    mirror.checkAnswer = { ok: false, need: 'asleep' };
    must(mirror.push, 'a session that listens')('asleep');
    await flush();
    const opens = mirror.opens;
    session.askAgain();
    await flush();
    await clock.advance(1_000);
    expect(mirror.wakes).toBe(2);
    expect(mirror.opens).toBe(opens);
  });

  it('stops whatever it was doing; twice is once', async () => {
    const { session, mirror, viewer, live } = setup();
    await live();
    await session.stop('asked to');
    await session.stop('asked again');
    expect(session.status).toMatchObject({ state: 'stopped', why: 'asked to' });
    expect(mirror.closes).toBe(1);
    expect(mirror.push).toBeUndefined();
    expect(viewer().of('quit')).toHaveLength(1);
    await expect(session.stopped).resolves.toMatchObject({ why: 'asked to' });
  });

  it('a window goes at once: what a phone takes to say goodbye keeps no card in a room', async () => {
    const { session, mirror, viewer, live } = setup();
    await live();
    let goodbye!: () => void;
    mirror.close = () => new Promise<void>((r) => (goodbye = r));
    const before = viewer().sent.length;
    const stopping = session.stop('another device was chosen');
    await flush();
    expect(
      viewer()
        .sent.slice(before)
        .map((m) => m.op),
    ).toEqual(['quit']);
    goodbye();
    await stopping;
    await expect(session.stopped).resolves.toMatchObject({ state: 'stopped' });
  });

  it('a stop during an open attaches nothing', async () => {
    let release!: () => void;
    const { session, mirror, viewer } = setup();
    const open = mirror.open.bind(mirror);
    mirror.open = async (o, s, t) => {
      await new Promise<void>((r) => (release = r));
      return open(o, s, t);
    };
    await session.start();
    await flush();
    await session.stop('asked to');
    release();
    await flush();
    expect(viewer().of('attach')).toHaveLength(0);
  });

  it('a device left waiting stops polling when stopped', async () => {
    const { session, mirror, clock } = setup();
    mirror.checkAnswer = { ok: false, need: 'not-connected' };
    await session.start();
    await flush();
    await session.stop('asked to');
    const asked = mirror.checks;
    await clock.advance(10_000);
    expect(mirror.checks).toBe(asked);
  });
});

describe('a person on the window', () => {
  it('reaches the device in order, and says when', async () => {
    const { session, mirror, clock, viewer, live } = setup();
    await live();
    viewer().say('touch', { p: 0, x: 0.5, y: 0.25 });
    viewer().say('touch', { p: 2, x: 0.5, y: 0.25 });
    viewer().say('key', { page: 7, usage: 0x28, state: 1 });
    viewer().say('text', { s: 'ş' });
    await flush();
    expect(mirror.inputs).toEqual([
      { kind: 'touch', p: 0, x: 0.5, y: 0.25 },
      { kind: 'touch', p: 2, x: 0.5, y: 0.25 },
      { kind: 'key', page: 7, usage: 0x28, state: 1 },
      { kind: 'text', s: 'ş' },
    ]);
    expect(session.status.touchedAt).toBe(clock.now());
  });

  it('on a slow device a drag follows the finger, and no finger down or up is lost', async () => {
    const { mirror, viewer, live, session } = setup();
    await live();
    let go!: () => void;
    mirror.inputWait = new Promise((r) => (go = r));
    viewer().say('touch', { p: 0, x: 0, y: 0 });
    for (let i = 1; i <= 100; i++) viewer().say('touch', { p: 1, x: i / 100, y: 0 });
    viewer().say('touch', { p: 2, x: 1, y: 0 });
    await flush();
    mirror.inputWait = undefined;
    go();
    await flush();
    expect(mirror.inputs.map((e) => (e as { p: number }).p)).toEqual([0, 1, 2]);
    expect(mirror.inputs[1]).toMatchObject({ x: 1 });
    expect(session.status.inputDropped).toBe(99);
  });

  it('a failed input is counted and the next goes through', async () => {
    const { mirror, viewer, live, session } = setup();
    await live();
    const real = mirror.input.bind(mirror);
    let first = true;
    mirror.input = async (e) => {
      if (first) {
        first = false;
        throw new Error('gone');
      }
      await real(e);
    };
    viewer().say('touch', { p: 0, x: 0, y: 0 });
    viewer().say('touch', { p: 2, x: 0, y: 0 });
    await flush();
    expect(session.status.inputFailed).toBe(1);
    expect(mirror.inputs).toHaveLength(1);
  });

  it('with --no-input, or while no picture is live, nothing reaches the device', async () => {
    const watch = setup({ noInput: true });
    await watch.live();
    expect(watch.viewer().of('attach')[0]).toMatchObject({ input: false });
    watch.viewer().say('touch', { p: 0, x: 0, y: 0 });
    await flush();
    expect(watch.mirror.inputs).toEqual([]);
    const down = setup();
    await down.session.start();
    await flush();
    down.viewer().say('touch', { p: 0, x: 0, y: 0 });
    await flush();
    expect(down.mirror.inputs).toEqual([]);
    expect(down.session.status.inputDropped).toBe(1);
  });
});

describe('what the session reports', () => {
  it('keeps no reading the viewer has none of, which it sends as -1', async () => {
    const { session, viewer, live } = setup();
    await live();
    viewer().say('stats', { arrived: 0, captureP50: -1, decodeP95: -1, shown: 0 });
    expect(session.status.stats).toMatchObject({ arrived: 0, shown: 0 });
    expect(session.status.stats).not.toHaveProperty('captureP50');
    expect(session.status.stats).not.toHaveProperty('decodeP95');
  });

  it('keeps the viewer numbers for whoever asks, and tells each change', async () => {
    const { session, viewer, seen, live } = setup();
    await live();
    viewer().say('stats', { arrived: 60, shown: 60 });
    expect(session.status.stats).toMatchObject({ arrived: 60 });
    expect(seen.at(-1)?.stats).toMatchObject({ shown: 60 });
  });

  it('times the next frame for the bench', async () => {
    const { session, viewer, live } = setup();
    await live();
    const marked = session.mark();
    expect(viewer().of('mark')).toHaveLength(1);
    viewer().say('marked', { ms: 72.5 });
    await expect(marked).resolves.toBe(72.5);
  });

  it('answers what it asked a viewer that died, as nothing else will', async () => {
    const { session, viewer, live } = setup();
    await live();
    const watching = session.watch(1_000, false);
    const marked = session.mark();
    viewer().die('a crash');
    await expect(watching).resolves.toEqual({ why: 'its window went' });
    await expect(marked).resolves.toBeNaN();
  });

  it('answers what it asked when it stops, and leaves no wait with no viewer', async () => {
    const { session, live } = setup();
    await live();
    const watching = session.watch(1_000, false);
    await session.stop('done');
    await expect(watching).resolves.toEqual({ why: 'its window went' });
    await expect(session.watch(1_000, false)).resolves.toEqual({ why: 'its window went' });
    await expect(session.mark()).resolves.toBeNaN();
  });
});

describe('the table of needs', () => {
  it('holds each with its words and its fix', () => {
    expect(Object.keys(NEEDS).sort()).toEqual(
      [
        'locked',
        'asleep',
        'not-paired',
        'not-trusted',
        'developer-mode-off',
        'ui-automation-off',
        'disk-image-missing',
        'os-too-old',
        'camera-or-mic',
        'call',
        'siri',
        'taken-over',
        'presented-elsewhere',
        'no-compiler',
        'no-hardware-decoder',
        'camera-permission',
        'no-phone-stream',
        'not-connected',
        'simulator-off',
        'no-grpc',
        'no-display',
      ].sort(),
    );
    for (const words of Object.values(NEEDS)) {
      expect(words.title.length).toBeGreaterThan(5);
      expect(words.fix.length).toBeGreaterThan(5);
    }
    expect(new NeedError('asleep', 'seen at 3').message).toContain('seen at 3');
  });
});
