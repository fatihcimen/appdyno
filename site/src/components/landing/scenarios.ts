import type { Words } from '../../i18n/en.ts';
import { SCALES, type Gauge } from './dials.ts';

/** One thing a phone of the page does: `player.ts` plays a job's or a scene's steps in order. */
export type Step =
  | { say: string }
  | { call: string; args?: string; took: string }
  | { tap: string }
  | { text: [part: string, text: string] }
  | { show: string }
  | { hide: string }
  | { reading: boolean }
  | { gauge: [id: Gauge, label: string, share: number] }
  | { wait: number }
  /** the steps after it go to the stage's next phone */
  | { next: true }
  | { hop: true };

const span = (kind: string) => (text: string) => `<span class="${kind}">${text}</span>`;
const ref = span('r');
const ok = span('ok');
const warn = span('t');

/** The dials at rest and in the launch job, as [label, share of the dial]. */
// shortcut: these are the example session's numbers, swap in a real run of the shop example before the launch
export const READINGS = {
  launch: ['412 ms', 412 / SCALES.launch.max],
  frames: ['59 fps', 59 / SCALES.frames.max],
  memory: ['182 MB', 182 / SCALES.memory.max],
  story: ['412 ms', 412 / SCALES.story.max],
} as const satisfies Record<Gauge, readonly [string, number]>;

const PRODUCTS = ['guji', 'huila', 'kenya'] as const;
export const refOf = (i: number) => `@${PRODUCTS[i] ?? ''}`;

/** The line a step writes in a log: what it says, or its call with the time the call took. */
export const lineOf = (step: Step) =>
  'say' in step
    ? step.say
    : 'call' in step
      ? `<span class="k">→ ${step.call}</span>${step.args ? ` ${step.args}` : ''}  <span class="t">${step.took}</span>`
      : undefined;

const FATAL = ref('Fatal error: Index out of range');
const STACK = 'CheckoutModel.total(for:) CheckoutModel.swift:58';
const FLOW = 'flows/checkout.flow';

/** What the jobs and the story's scenes are both made of, in the words of a language. */
const movesOf = ({ console: c }: Words) => {
  const names = c.app.products;
  const cart = (count: number): Step => ({ text: ['cart', `${c.app.cart} ${count}`] });
  return {
    cart,
    read: [
      { call: 'screen', took: '84 ms' },
      { reading: true },
      {
        say: `  ${ref('@cart')} "${c.app.cart} 0"  ${names.map((n, i) => `${ref(refOf(i))} "${n}"`).join('  ')}  ${ref('@place')} "${c.app.place}"`,
      },
    ],
    add: PRODUCTS.flatMap((_, i): Step[] => [
      { call: 'tap', args: `{"ref":"${refOf(i)}"}`, took: '190 ms' },
      { tap: refOf(i) },
      cart(i + 1),
      { hop: true },
      { say: `  ${c.checkout.tapped} · ${ok('+')} ${ref('@cart')} "${c.app.cart} ${i + 1}"` },
    ]),
    place: [
      { call: 'tap', args: '{"ref":"@place"}', took: '205 ms' },
      { tap: '@place' },
      { show: 'crash' },
    ],
    push: [
      {
        call: 'push',
        args: JSON.stringify({ type: 'alert', title: c.app.name, body: c.app.pushBody }),
        took: '640 ms',
      },
      { show: 'banner' },
      { hop: true },
      { say: `  ${c.push.sent}` },
      { wait: 2200 },
      { hide: 'banner' },
    ],
    link: [
      { call: 'open_link', args: '{"url":"beans://product/kenya-nyeri"}', took: '1.1 s' },
      { text: ['title', names[2] ?? ''] },
      { hop: true },
      { say: `  ${c.link.opened} · ${ok('+')} ${c.link.header} "${names[2] ?? ''}"` },
    ],
    /** Five cold launches, read on a dial. */
    launches: (dial: Gauge): Step[] => [
      { call: 'perf_launch', args: '{"mode":"cold","repeats":5}', took: '6.8 s' },
      ...[455, 431, 412, 418, 409].flatMap((ms): Step[] => [
        { gauge: [dial, `${ms} ms`, ms / SCALES.launch.max] },
        { wait: 300 },
      ]),
      { gauge: [dial, ...READINGS.launch] },
      { hop: true },
      { say: `  ${c.perf.launch} ${ok('412 ms')}, p95 455 ms` },
    ],
    crashes: { call: 'crashes', args: '{"limit":1}', took: '1.2 s' },
  } satisfies Record<string, Step | Step[] | ((of: never) => Step | Step[])>;
};

/** The example session of each job, in the words of a language. */
export const jobsOf = (t: Words): Record<string, Step[]> => {
  const c = t.console;
  const moves = movesOf(t);
  const ask = (line: string): Step => ({ say: `<span class="ask">${c.you}: ${line}</span>` });
  return {
    checkout: [
      ask(c.checkout.ask),
      ...moves.read,
      { wait: 700 },
      { reading: false },
      ...moves.add,
      ...moves.place,
      { say: `  ${warn(c.checkout.ended)}` },
      moves.crashes,
      { say: `  ${c.checkout.crashed} ${FATAL}\n  ${STACK}` },
    ],
    push: [ask(c.push.ask), ...moves.push],
    link: [ask(c.link.ask), ...moves.link],
    perf: [
      ask(c.perf.ask),
      ...moves.launches('launch'),
      { call: 'perf_scroll', args: '{"swipes":5}', took: '9.4 s' },
      { gauge: ['frames', ...READINGS.frames] },
      { gauge: ['memory', ...READINGS.memory] },
      { say: `  ${c.perf.scroll}` },
    ],
    views: [
      ask(c.views.ask),
      { call: 'screen', args: '{"views":true}', took: '12 ms' },
      {
        say: `  ${c.views.framework} ${ok('SwiftUI')}\n  UIWindow > UIHostingController 0,0 402x874\n   UIKitNavigationBar 0,62 402x54\n   UICollectionView #products 0,116 402x620`,
      },
    ],
  };
};

/** The story's scenes, in the order the page tells them. */
export const SCENES = ['read', 'tap', 'push', 'measure', 'crash', 'replay'] as const;

/** What the phones do in each scene of the story: the jobs' own moves, from one request to its replay. */
export const storyOf = (t: Words): Record<(typeof SCENES)[number], Step[]> => {
  const s = t.story;
  const moves = movesOf(t);
  const flow = (action: string, took: string): Step => ({
    call: 'flow',
    args: JSON.stringify({ action, file: FLOW }),
    took,
  });
  return {
    read: moves.read,
    tap: moves.add,
    push: [...moves.push, ...moves.link],
    measure: moves.launches('story'),
    crash: [
      moves.cart(PRODUCTS.length),
      ...moves.place,
      { say: `  ${warn('APP_NOT_RUNNING')}: ${s.died}\n  ${s.lastLog}: ${FATAL}` },
      moves.crashes,
      { say: `  ${STACK}` },
    ],
    replay: [
      moves.cart(PRODUCTS.length),
      { show: 'crash' },
      flow('save', '20 ms'),
      { say: `  ${s.saved}` },
      flow('run', '4.1 s'),
      { next: true },
      ...PRODUCTS.flatMap((_, i): Step[] => [{ tap: refOf(i) }, moves.cart(i + 1)]),
      { tap: '@place' },
      { show: 'crash' },
      { say: `  ${s.replayed}` },
    ],
  };
};
