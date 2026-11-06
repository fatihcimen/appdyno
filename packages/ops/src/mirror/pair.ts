import { pause, type InputEvent, type MirrorSession, type ViewerMessage } from '@appdyno/core';
import { MIN_SAMPLES, pairedChange } from '@appdyno/perf';
import { NODE_FLAGS, type Tree, type WireNode } from '@appdyno/protocol';
import type { JourneyAnswer } from '../flow/journey.js';

/** One of two windows side by side. */
export type PairSide = {
  serial: string;
  name: string;
  /** What is on its screen. */
  read(): Promise<Tree>;
  session: Pick<MirrorSession, 'send' | 'tell' | 'status'>;
  /** What a window's press does; `false` leaves it to the device. */
  press(name: string): boolean;
  /** A journey through the window's own measures; nothing, and a reason on its window, when it fails. */
  journey(file: string): Promise<JourneyAnswer | undefined>;
};

type Touch = Extract<InputEvent, { kind: 'touch' }>;
type Point = { x: number; y: number };

/** A finger that came down, and what it means on the other device. */
type Gesture = {
  down: Point;
  since: number;
  /** Where it lands there, when it does. */
  place?: Point;
  /** How far from the finger it lands there. */
  way?: Point;
  /** Why it does not. */
  why?: string;
  /** A thing the other has not is no tap there, but a drag goes on from the same place. */
  strays?: boolean;
};

/** A tap sent in the instant it lands is no tap to a device. */
const TAP_MS = 80;
/** As long as a touch may wait for what is on the screens; an agent still starting is not waited for. */
const READ_MS = 1_500;
/** What became of a touch is known once the device's queue is through. */
const LAND_MS = 250;
/** A finger this far, as a share of the screen, is a drag and no tap. */
const DRAG = 0.02;

/** What one device calls a thing and another may too: an id with no package, and its words. */
const namesOf = (n: WireNode) =>
  [n.id?.split('/').pop(), n.t, n.d].flatMap((name) => name?.trim().toLowerCase() || []);

/** What a finger means: a thing a person reads or presses, and no layout that happens to have an id. */
const meant = (n: WireNode) =>
  n.t || n.d || (n.id && n.f & (NODE_FLAGS.clickable | NODE_FLAGS.editable));

const sizeOf = ({ windows }: Tree) => ({
  w: Math.max(...windows.map((w) => w.b[2])),
  h: Math.max(...windows.map((w) => w.b[3])),
});

/** The smallest thing under a point. */
function under(tree: Tree, { x, y }: Point) {
  const { w, h } = sizeOf(tree);
  const [px, py] = [x * w, y * h];
  const inside = tree.nodes.filter(
    (n) => meant(n) && px >= n.b[0] && px <= n.b[2] && py >= n.b[1] && py <= n.b[3],
  );
  const area = (n: WireNode) => (n.b[2] - n.b[0]) * (n.b[3] - n.b[1]);
  return inside.reduce<WireNode | undefined>(
    (a, n) => (!a || area(n) < area(a) ? n : a),
    undefined,
  );
}

/** Where the other device has it: the same thing, the same one among those called that. */
function placeOf(from: Tree, node: WireNode, to: Tree): Point | undefined {
  const names = namesOf(node);
  const like = ({ nodes }: Tree) =>
    nodes.filter((n) => meant(n) && namesOf(n).some((name) => names.includes(name)));
  const there = like(to)[like(from).indexOf(node)];
  if (!there) return undefined;
  const { w, h } = sizeOf(to);
  return { x: (there.b[0] + there.b[2]) / 2 / w, y: (there.b[1] + there.b[3]) / 2 / h };
}

const within = (read: Promise<Tree>) =>
  Promise.race([read.catch(() => undefined), pause(READ_MS).then(() => undefined)]);

/** The same event, from another place. */
const shifted = (e: Touch, way: Point): Touch => ({
  ...e,
  x: e.x + way.x,
  y: e.y + way.y,
  ...(e.x2 !== undefined && { x2: e.x2 + way.x, y2: e.y2! + way.y }),
});

/** This window's journey against the other's, by the test the gate makes of two conditions measured in turns. */
function against(name: string, mine: JourneyAnswer, theirs: JourneyAnswer) {
  const fewest = Math.min(mine.samples.length, theirs.samples.length);
  // an iteration with a step that never settled has no whole, and too few of them are no difference found
  if (fewest < MIN_SAMPLES)
    return [
      {
        ok: true,
        why: `${mine.samples.length} whole runs here, ${theirs.samples.length} there`,
        flagged: true,
        title: `Against ${name}`,
        detail: `Could not judge: ${fewest} of ${MIN_SAMPLES} samples`,
      },
    ];
  const { moved, before, called } = pairedChange(theirs.samples, mine.samples, 'ms');
  const percent = Math.round((Math.abs(moved) / before) * 100);
  const shown = (ms: number) => `${Math.round(ms)} ms`;
  const steps = mine.steps.flatMap((s, i) => {
    const there = theirs.steps[i]?.ms ?? s.ms;
    return s.ms === undefined || there === undefined ? [] : [{ ...s, ms: s.ms, there }];
  });
  const apart = (s: (typeof steps)[number]) => Math.abs(s.ms - s.there);
  const most = steps.reduce((a, b) => (apart(b) > apart(a) ? b : a), steps[0]!);
  const why = [
    `${mine.samples.length} runs here, ${theirs.samples.length} there, one device after the other`,
    ...steps.map((s) => `${s.step}: ${shown(s.ms)} here, ${shown(s.there)} there`),
  ].join('\n');
  const row = { ok: true, why, flagged: false };
  const verdict = called
    ? `${percent} % ${moved > 0 ? 'slower' : 'faster'}`
    : 'No clear difference';
  return [
    { ...row, title: `Against ${name}`, detail: `${verdict}, ${shown(before)} there` },
    ...(called
      ? [
          {
            ...row,
            title: `Most in ${most.step}`,
            detail: `${shown(most.ms)} here, ${shown(most.there)} there`,
          },
        ]
      : []),
  ];
}

/**
 * Two windows as one hand. A touch waits for both screens to be read, so that it is read as it was when it came down,
 * then goes to both at once, thing for thing, as two devices rarely have a thing in the same place. Each window says
 * what became of it: where it landed, or why it did not.
 */
export function pairWindows(sides: [PairSide, PairSide]) {
  let both = true;
  let journeying = false;
  let turn: Promise<unknown> = Promise.resolve();
  let gesture: Gesture | undefined;
  let look: NodeJS.Timeout | undefined;
  const heard = new Map<PairSide, number>();

  const otherOf = (side: PairSide) => (side === sides[0] ? sides[1] : sides[0]);
  const say = (side: PairSide, failing?: string) =>
    side.session.tell({ op: 'pair', both, with: otherOf(side).name, ...(failing && { failing }) });

  /** What a finger on one means on the other, read before either has been touched. */
  const aim = async (from: PairSide, to: PairSide, at: Point): Promise<Partial<Gesture>> => {
    if (to.session.status.state !== 'live') return { why: `${to.name} is not live` };
    const [mine, theirs] = await Promise.all([within(from.read()), within(to.read())]);
    if (!mine?.windows.length || !theirs?.windows.length) {
      to.session.tell({ op: 'note', text: 'Its screen was not read: sent to the same place' });
      return { place: at };
    }
    const node = under(mine, at);
    if (!node) return { place: at };
    const place = placeOf(mine, node, theirs);
    return place
      ? { place }
      : { why: `No ${node.t || node.d || namesOf(node)[0]} here`, strays: true };
  };

  const land = (to: PairSide, g: Gesture, e: Touch, place: Point) => {
    g.way = { x: place.x - g.down.x, y: place.y - g.down.y };
    to.session.tell({ op: 'touchAt', ...place });
    to.session.send(shifted({ ...e, p: 0, ...g.down }, g.way));
  };

  /** Clears a window's red, or puts it there, once what was sent is known to have gone. */
  const lookBack = () => {
    clearTimeout(look);
    look = setTimeout(() => {
      for (const side of sides) {
        const failed = side.session.status.inputFailed ?? 0;
        say(side, failed > (heard.get(side) ?? 0) ? 'That did not land' : undefined);
        heard.set(side, failed);
      }
    }, LAND_MS);
  };

  const touch = async (from: PairSide, to: PairSide, e: Touch) => {
    if (e.p === 0) {
      clearTimeout(look);
      const aimed = await aim(from, to, e);
      gesture = { down: e, since: Date.now(), ...aimed };
      from.session.send(e);
      from.session.tell({ op: 'touchAt', x: e.x, y: e.y });
      if (aimed.place) land(to, gesture, e, aimed.place);
      return;
    }
    const g = gesture;
    if (!g) return;
    if (g.strays && e.p === 1 && Math.hypot(e.x - g.down.x, e.y - g.down.y) > DRAG) {
      g.strays = false;
      g.why = undefined;
      land(to, g, e, g.down);
    }
    const held = Date.now() - g.since;
    if (e.p === 2 && held < TAP_MS) await pause(TAP_MS - held);
    from.session.send(e);
    if (g.way) to.session.send(shifted(e, g.way));
    if (e.p !== 2) return;
    gesture = undefined;
    if (g.why) say(to, g.why);
    else lookBack();
  };

  const carry = async (from: PairSide, to: PairSide, e: InputEvent) => {
    if (e.kind === 'touch') return touch(from, to, e);
    for (const side of sides) if (e.kind !== 'button' || !side.press(e.name)) side.session.send(e);
    return lookBack();
  };

  /** One journey on each in turn, as two at once would load each other, and each told how it stands to the other. */
  const journey = async (file: string) => {
    journeying = true;
    const runs: (JourneyAnswer | undefined)[] = [];
    for (const side of sides) {
      otherOf(side).session.tell({ op: 'measuring', line: `Waiting for ${side.name}` });
      runs.push(await side.journey(file));
    }
    journeying = false;
    sides.forEach((side, i) => {
      const [mine, theirs] = [runs[i], runs[1 - i]];
      const other = otherOf(side).name;
      if (!mine) say(side, 'The journey failed here');
      const rows =
        mine && theirs
          ? against(other, mine, theirs)
          : [
              {
                title: 'Nothing to compare',
                detail: `The journey failed ${mine ? `on ${other}` : 'here'}`,
              },
            ];
      for (const row of rows) side.session.tell({ op: 'measured', ...row });
    });
  };

  return {
    /** The two windows say what they are to each other, and each device agent starts before a first touch needs it. */
    begin() {
      for (const side of sides) {
        say(side);
        void side.read().catch(() => undefined);
      }
    },

    /** A window has come up again, with nothing of what it was told. */
    again(serial: string) {
      const side = sides.find((s) => s.serial === serial);
      if (side) say(side);
    },

    /** What a person did on `serial`'s window; `false` leaves it to that window alone. */
    input(serial: string, e: InputEvent) {
      const from = sides.find((s) => s.serial === serial);
      if (!both || journeying || !from) return false;
      turn = turn.then(() => carry(from, otherOf(from), e)).catch(() => undefined);
      return true;
    },

    /** What is the pair's of a window's controls; `false` leaves it to the window. */
    control(m: ViewerMessage) {
      if (m.name === 'both') {
        both = !both;
        sides.forEach((side) => say(side));
      } else if (m.name === 'journey') {
        if (!journeying) void journey(String(m.file));
      } else return false;
      return true;
    },

    /** One window closed, and the other stands alone. */
    end(serial: string) {
      for (const side of sides)
        if (side.serial !== serial) side.session.tell({ op: 'pair', ended: true });
    },
  };
}

export type WindowPair = ReturnType<typeof pairWindows>;
