import type { InputEvent } from '@appdyno/core';
import type { Tree } from '@appdyno/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { JourneyAnswer } from '../src/flow/journey.js';
import { pairWindows, type PairSide } from '../src/mirror/pair.js';

const WINDOW = (w: number, h: number) => ({
  type: 1,
  layer: 0,
  b: [0, 0, w, h] as [number, number, number, number],
  active: true,
  focused: true,
});

const CLICKABLE = 2;

const node = (name: string, b: [number, number, number, number]) => ({
  p: -1,
  w: 0,
  c: 'Button',
  t: name,
  b,
  f: CLICKABLE,
});

const tree = (w: number, h: number, nodes: { b: number[] }[]) =>
  ({ windows: [WINDOW(w, h)], nodes, truncated: false, elapsedMs: 1, hash: '' }) as unknown as Tree;

function side(serial: string, read: Tree, ran?: JourneyAnswer) {
  const sent: InputEvent[] = [];
  const told: Record<string, unknown>[] = [];
  const session = {
    send: (e: InputEvent) => sent.push(e),
    tell: (m: Record<string, unknown>) => told.push(m),
    status: { state: 'live', inputFailed: 0 },
  };
  const press = vi.fn(() => false);
  const it: PairSide = {
    serial,
    name: `the ${serial}`,
    read: async () => read,
    session: session as unknown as PairSide['session'],
    press,
    journey: async () => ran,
  };
  return { it, sent, told, session, press };
}

const IPHONE = tree(400, 800, [
  node('List', [40, 80, 160, 120]),
  node('Add', [300, 300, 380, 340]),
]);
const ANDROID = tree(1080, 2400, [
  node('list', [100, 1000, 500, 1100]),
  node('add', [900, 200, 1040, 260]),
]);
const touch = (p: 0 | 1 | 2, x: number, y: number): InputEvent => ({ kind: 'touch', p, x, y });
const settled = () => new Promise((r) => setTimeout(r, 400));

const run = (totalMs: number, samples: number[], steps: [string, number][]): JourneyAnswer =>
  ({
    id: 'x',
    raw: 'x',
    scenario: 'journey-x',
    iterations: samples.length,
    totalMs,
    samples,
    steps: steps.map(([step, ms]) => ({ step, ms })),
    noise: [],
  }) as JourneyAnswer;

describe('two windows as one hand', () => {
  it('sends a touch to the same thing on the other, wherever it stands there', async () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    const pair = pairWindows([a.it, b.it]);
    expect(pair.input('a', touch(0, 0.25, 0.125))).toBe(true);
    pair.input('a', touch(2, 0.25, 0.125));
    await settled();
    expect(b.sent[0]).toMatchObject({ p: 0 });
    const down = b.sent[0] as { x: number; y: number };
    expect(down.x).toBeCloseTo(300 / 1080);
    expect(down.y).toBeCloseTo(1050 / 2400);
    expect(b.told).toContainEqual(expect.objectContaining({ op: 'touchAt' }));
    expect(a.told).toContainEqual(expect.objectContaining({ op: 'touchAt', x: 0.25 }));
  });

  it('holds the touch of the window it fell on until the screens are read, and keeps it a tap', async () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    let answer: (t: Tree) => void = () => undefined;
    a.it.read = () => new Promise((done) => (answer = done));
    const pair = pairWindows([a.it, b.it]);
    pair.input('a', touch(0, 0.25, 0.125));
    pair.input('a', touch(2, 0.25, 0.125));
    await new Promise((r) => setTimeout(r, 20));
    expect(a.sent).toEqual([]);
    const at = Date.now();
    answer(IPHONE);
    await settled();
    expect(a.sent.map((e) => (e as { p: number }).p)).toEqual([0, 2]);
    expect(Date.now() - at).toBeGreaterThanOrEqual(80);
  });

  it('touches nothing where the other device has no such thing, and says so on its window', async () => {
    const [a, b] = [side('a', IPHONE), side('b', tree(400, 800, [node('List', [0, 0, 10, 10])]))];
    const pair = pairWindows([a.it, b.it]);
    pair.input('a', touch(0, 0.85, 0.4));
    pair.input('a', touch(2, 0.85, 0.4));
    await settled();
    expect(b.sent).toEqual([]);
    expect(a.sent).toHaveLength(2);
    expect(b.told).toContainEqual(expect.objectContaining({ op: 'pair', failing: 'No Add here' }));
  });

  it('lets a drag go on from the same place where the other has no such thing', async () => {
    const [a, b] = [side('a', IPHONE), side('b', tree(400, 800, [node('List', [0, 0, 10, 10])]))];
    const pair = pairWindows([a.it, b.it]);
    pair.input('a', touch(0, 0.85, 0.4));
    pair.input('a', touch(1, 0.85, 0.5));
    pair.input('a', touch(2, 0.85, 0.6));
    await settled();
    expect(b.sent).toMatchObject([
      { p: 0, x: 0.85, y: 0.4 },
      { p: 1, x: 0.85, y: 0.5 },
      { p: 2, x: 0.85, y: 0.6 },
    ]);
    expect(b.told).not.toContainEqual(expect.objectContaining({ failing: expect.anything() }));
  });

  it('keeps a drag the same length, from where it landed', async () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    const pair = pairWindows([a.it, b.it]);
    pair.input('a', touch(0, 0.25, 0.125));
    pair.input('a', touch(1, 0.25, 0.225));
    pair.input('a', touch(2, 0.25, 0.325));
    await settled();
    const [down, moved] = b.sent as { y: number }[];
    expect(moved!.y - down!.y).toBeCloseTo(0.1);
  });

  it('knows a thing by its id on one and its words on the other', async () => {
    const send = { ...node('Send', [0, 0, 100, 100]), id: 'x:id/submit' };
    const named = { ...node('', [50, 50, 100, 100]), id: 'submit' };
    const [a, b] = [side('a', tree(100, 100, [send])), side('b', tree(100, 100, [named]))];
    const pair = pairWindows([a.it, b.it]);
    pair.input('a', touch(0, 0.2, 0.2));
    pair.input('a', touch(2, 0.2, 0.2));
    await settled();
    expect(b.sent[0]).toMatchObject({ x: 0.75, y: 0.75 });
  });

  it('takes the same one among those called alike', async () => {
    const rows = (x: number) => [
      node('Add', [x, 10, x + 10, 20]),
      node('Add', [x, 30, x + 10, 40]),
    ];
    const [a, b] = [side('a', tree(100, 100, rows(0))), side('b', tree(100, 100, rows(50)))];
    const pair = pairWindows([a.it, b.it]);
    pair.input('a', touch(0, 0.05, 0.35));
    pair.input('a', touch(2, 0.05, 0.35));
    await settled();
    expect(b.sent[0]).toMatchObject({ x: 0.55, y: 0.35 });
  });

  it('sends a finger on nothing named to the same place', async () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    const pair = pairWindows([a.it, b.it]);
    pair.input('a', touch(0, 0.5, 0.9));
    pair.input('a', touch(2, 0.5, 0.9));
    await settled();
    expect(b.sent[0]).toMatchObject({ x: 0.5, y: 0.9 });
  });

  it('does not take a layout with an id for something a person meant', async () => {
    const layout = { p: -1, w: 0, c: 'Frame', id: 'x:id/content', b: [0, 0, 400, 800], f: 0 };
    const [a, b] = [side('a', tree(400, 800, [layout])), side('b', ANDROID)];
    const pair = pairWindows([a.it, b.it]);
    pair.input('a', touch(0, 0.5, 0.5));
    pair.input('a', touch(2, 0.5, 0.5));
    await settled();
    expect(b.sent[0]).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it('knows a field with nothing in it by its id', async () => {
    const editable = 128;
    const field = { p: -1, w: 0, c: 'TextField', id: 'name', b: [0, 100, 400, 200], f: editable };
    const bar = { ...node('Toolbar', [0, 0, 400, 800]), f: 0 };
    const there = { ...field, b: [0, 200, 400, 400] };
    const [a, b] = [side('a', tree(400, 800, [bar, field])), side('b', tree(400, 800, [there]))];
    const pair = pairWindows([a.it, b.it]);
    pair.input('a', touch(0, 0.5, 0.2));
    pair.input('a', touch(2, 0.5, 0.2));
    await settled();
    expect(b.sent[0]).toMatchObject({ x: 0.5, y: 0.375 });
  });

  it('sends a touch on where a screen cannot be read, and says so', async () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    b.it.read = async () => {
      throw new Error('no agent');
    };
    const pair = pairWindows([a.it, b.it]);
    pair.input('a', touch(0, 0.25, 0.125));
    pair.input('a', touch(2, 0.25, 0.125));
    await settled();
    expect(b.sent[0]).toMatchObject({ x: 0.25, y: 0.125 });
    expect(b.told).toContainEqual(expect.objectContaining({ op: 'note' }));
  });

  it('says so when the other window is not live, and the touch stands on this one', async () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    b.session.status.state = 'reconnecting';
    const pair = pairWindows([a.it, b.it]);
    pair.input('a', touch(0, 0.25, 0.125));
    pair.input('a', touch(2, 0.25, 0.125));
    await settled();
    expect(b.sent).toEqual([]);
    expect(a.sent).toHaveLength(2);
    expect(b.told).toContainEqual(expect.objectContaining({ failing: 'the b is not live' }));
  });

  it('says a touch that did not land, on the window it did not land on, and clears it on one that did', async () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    const pair = pairWindows([a.it, b.it]);
    b.session.status.inputFailed = 1;
    pair.input('a', touch(0, 0.25, 0.125));
    pair.input('a', touch(2, 0.25, 0.125));
    await settled();
    expect(b.told).toContainEqual(expect.objectContaining({ failing: 'That did not land' }));
    expect(a.told).not.toContainEqual(expect.objectContaining({ failing: expect.anything() }));
    pair.input('a', touch(0, 0.25, 0.125));
    pair.input('a', touch(2, 0.25, 0.125));
    await settled();
    expect(b.told.at(-1)).toMatchObject({ op: 'pair', both: true });
    expect(b.told.at(-1)).not.toHaveProperty('failing');
  });

  it('leaves a touch to its window when told to, and goes to both again', () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    const pair = pairWindows([a.it, b.it]);
    expect(pair.control({ op: 'control', name: 'both' })).toBe(true);
    expect(pair.input('a', touch(0, 0.5, 0.9))).toBe(false);
    expect(a.told).toContainEqual(expect.objectContaining({ both: false }));
    pair.control({ op: 'control', name: 'both' });
    expect(pair.input('a', touch(0, 0.5, 0.9))).toBe(true);
  });

  it('leaves other controls to the window', () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    expect(pairWindows([a.it, b.it]).control({ op: 'control', name: 'record' })).toBe(false);
  });

  it('gives a press to what each window does with it, and words to both', async () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    const pair = pairWindows([a.it, b.it]);
    a.press.mockReturnValue(true);
    pair.input('a', { kind: 'button', name: 'home' });
    pair.input('a', { kind: 'text', s: 'hi' });
    await settled();
    expect(a.sent).toEqual([{ kind: 'text', s: 'hi' }]);
    expect(b.press).toHaveBeenCalledWith('home');
    expect(b.sent).toEqual([
      { kind: 'button', name: 'home' },
      { kind: 'text', s: 'hi' },
    ]);
  });

  it('says a press that did not land, on the window it did not land on', async () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    const pair = pairWindows([a.it, b.it]);
    b.session.status.inputFailed = 1;
    pair.input('a', { kind: 'button', name: 'back' });
    await settled();
    expect(b.told).toContainEqual(expect.objectContaining({ failing: 'That did not land' }));
  });

  it('runs a journey on each in turn, and tells each how it stands to the other', async () => {
    const steps = (send: number): [string, number][] => [
      ['launch', 400],
      ['tap Send', send],
    ];
    const a = side('a', IPHONE, run(1000, [990, 995, 1000, 1005, 1010], steps(600)));
    const b = side('b', ANDROID, run(1500, [1490, 1495, 1500, 1505, 1510], steps(1100)));
    pairWindows([a.it, b.it]).control({ op: 'control', name: 'journey', file: 'x.flow' });
    await settled();
    expect(b.told).toContainEqual(
      expect.objectContaining({
        op: 'measured',
        title: 'Against the a',
        detail: '50 % slower, 1000 ms there',
      }),
    );
    expect(a.told).toContainEqual(
      expect.objectContaining({
        title: 'Against the b',
        detail: '33 % faster, 1500 ms there',
      }),
    );
    expect(b.told).toContainEqual(
      expect.objectContaining({ title: 'Most in tap Send', detail: '1100 ms here, 600 ms there' }),
    );
    expect(a.told).toContainEqual({ op: 'measuring', line: 'Waiting for the b' });
  });

  it('calls no difference the test does not', async () => {
    const steps: [string, number][] = [['launch', 1000]];
    const a = side('a', IPHONE, run(1000, [990, 995, 1000, 1005, 1010], steps));
    const b = side('b', ANDROID, run(1010, [1000, 1005, 1010, 1015, 1020], steps));
    pairWindows([a.it, b.it]).control({ op: 'control', name: 'journey', file: 'x.flow' });
    await settled();
    expect(a.told).toContainEqual(
      expect.objectContaining({ detail: 'No clear difference, 1010 ms there' }),
    );
  });

  it('calls no difference of a side with too few whole runs, and could not judge is what it says', async () => {
    const steps: [string, number][] = [['launch', 1000]];
    const a = side('a', IPHONE, run(1000, [990, 995, 1000, 1005, 1010], steps));
    const b = side('b', ANDROID, run(5000, [4990, 5010], steps));
    pairWindows([a.it, b.it]).control({ op: 'control', name: 'journey', file: 'x.flow' });
    await settled();
    expect(a.told).toContainEqual(
      expect.objectContaining({
        title: 'Against the b',
        detail: 'Could not judge: 2 of 5 samples',
        flagged: true,
      }),
    );
  });

  it('says a journey with no whole on either side as one it could not judge', async () => {
    const none = () => ({ ...run(0, [], []), totalMs: undefined, steps: [{ step: 'launch' }] });
    const a = side('a', IPHONE, none());
    const b = side('b', ANDROID, none());
    pairWindows([a.it, b.it]).control({ op: 'control', name: 'journey', file: 'x.flow' });
    await settled();
    expect(b.told).toContainEqual(
      expect.objectContaining({ detail: 'Could not judge: 0 of 5 samples' }),
    );
  });

  it('marks the window a journey failed on, and leaves the other nothing to compare', async () => {
    const a = side('a', IPHONE, run(1000, [1000], [['launch', 1000]]));
    const b = side('b', ANDROID);
    pairWindows([a.it, b.it]).control({ op: 'control', name: 'journey', file: 'x.flow' });
    await settled();
    expect(b.told).toContainEqual(expect.objectContaining({ failing: 'The journey failed here' }));
    expect(a.told).toContainEqual(
      expect.objectContaining({
        title: 'Nothing to compare',
        detail: 'The journey failed on the b',
      }),
    );
  });

  it('leaves no window waiting when the journey failed on it first', async () => {
    const a = side('a', IPHONE);
    const b = side('b', ANDROID, run(1000, [1000], [['launch', 1000]]));
    pairWindows([a.it, b.it]).control({ op: 'control', name: 'journey', file: 'x.flow' });
    await settled();
    expect(a.told.at(-1)).toMatchObject({ op: 'measured', title: 'Nothing to compare' });
  });

  it('carries no touch while a journey runs', () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    a.it.journey = () => new Promise(() => undefined);
    const pair = pairWindows([a.it, b.it]);
    pair.control({ op: 'control', name: 'journey', file: 'x.flow' });
    expect(pair.input('a', touch(0, 0.5, 0.5))).toBe(false);
  });

  it('tells the window left that it stands alone', () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    pairWindows([a.it, b.it]).end('a');
    expect(b.told).toEqual([{ op: 'pair', ended: true }]);
    expect(a.told).toEqual([]);
  });

  it('starts each device agent before a first touch needs it', () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    const read = vi.spyOn(b.it, 'read');
    pairWindows([a.it, b.it]).begin();
    expect(read).toHaveBeenCalled();
    expect(a.told).toContainEqual({ op: 'pair', both: true, with: 'the b' });
  });

  it('says it again to a window that came up again', () => {
    const [a, b] = [side('a', IPHONE), side('b', ANDROID)];
    pairWindows([a.it, b.it]).again('b');
    expect(b.told).toEqual([{ op: 'pair', both: true, with: 'the a' }]);
  });
});
