import type { Words } from '../../i18n/en.ts';
import { SCALES, type Gauge } from './dials.ts';

/** One thing the console does: `landing.client.ts` plays a job's steps in order. */
export type Step =
  | { say: string }
  | { call: string; args?: string; took: string }
  | { tap: string }
  | { text: [id: string, text: string] }
  | { show: string }
  | { hide: string }
  | { reading: boolean }
  | { gauge: [id: Gauge, label: string, share: number] }
  | { wait: number }
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

/** The example session of each job, in the words of a language. */
export const jobsOf = ({ console: c }: Words): Record<string, Step[]> => {
  const ask = (line: string): Step => ({ say: `<span class="ask">${c.you}: ${line}</span>` });
  const names = c.app.products;
  return {
    checkout: [
      ask(c.checkout.ask),
      { call: 'screen', took: '84 ms' },
      { reading: true },
      {
        say: `  ${ref('@cart')} "${c.app.cart} 0"  ${names.map((n, i) => `${ref(refOf(i))} "${n}"`).join('  ')}  ${ref('@place')} "${c.app.place}"`,
      },
      { wait: 700 },
      { reading: false },
      ...PRODUCTS.flatMap((_, i): Step[] => [
        { call: 'tap', args: `{"ref":"${refOf(i)}"}`, took: '190 ms' },
        { tap: refOf(i) },
        { text: ['cart', `${c.app.cart} ${i + 1}`] },
        { hop: true },
        { say: `  ${c.checkout.tapped} · ${ok('+')} ${ref('@cart')} "${c.app.cart} ${i + 1}"` },
      ]),
      { call: 'tap', args: '{"ref":"@place"}', took: '205 ms' },
      { tap: '@place' },
      { show: 'crash' },
      { say: `  ${warn(c.checkout.ended)}` },
      { call: 'crashes', args: '{"limit":1}', took: '1.2 s' },
      {
        say: `  ${c.checkout.crashed} ${ref('Fatal error: Index out of range')}\n  CheckoutModel.total(for:) CheckoutModel.swift:58`,
      },
    ],
    push: [
      ask(c.push.ask),
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
      ask(c.link.ask),
      { call: 'open_link', args: '{"url":"beans://product/kenya-nyeri"}', took: '1.1 s' },
      { text: ['title', names[2] ?? ''] },
      { hop: true },
      { say: `  ${c.link.opened} · ${ok('+')} ${c.link.header} "${names[2] ?? ''}"` },
    ],
    perf: [
      ask(c.perf.ask),
      { call: 'perf_launch', args: '{"mode":"cold","repeats":5}', took: '6.8 s' },
      ...[455, 431, 412, 418, 409].flatMap((ms): Step[] => [
        { gauge: ['launch', `${ms} ms`, ms / SCALES.launch.max] },
        { wait: 300 },
      ]),
      { gauge: ['launch', ...READINGS.launch] },
      { hop: true },
      { say: `  ${c.perf.launch} ${ok('412 ms')}, p95 455 ms` },
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
