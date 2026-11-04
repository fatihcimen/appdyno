import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Tree } from '@appdyno/protocol';
import { ALERT_APPEAR_MS, ALERT_WATCH_MS, INERT_QUIET_MS } from '../src/simsettle.js';
import {
  CHECKABLE,
  CLICKABLE,
  EDITABLE,
  SCROLLABLE,
  SCROLLERS,
  TOLERANCE,
  TYPES,
  actionable,
  containerBars,
  hasAlert,
  layoutHash,
  sameLayout,
  scrollIndicators,
} from '../src/simtree.js';

type Node = Tree['nodes'][number];
type Why = { why: string };

/** The rules the host's direct read shares with the runner: RunnerCore's tests read this file too. */
const rules = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/runner-rules.json'), 'utf8'),
) as {
  times: { tolerance: number; inertQuietMs: number; alertAppearMs: number; alertWatchMs: number };
  digest: { nodes: Node[]; hash: string };
  sameDigest: (Why & { a: Node[]; b: Node[] })[];
  sameLayout: (Why & { a: Node[]; b: Node[]; same: boolean })[];
  actionable: { nodes: Node[]; points: (Why & { x: number; y: number; actionable: boolean })[] }[];
  scrollBars: (Why & { nodes: Node[]; bars: number[] })[];
  containerBars: { nodes: Node[]; screen: { w: number; h: number }; bars: number[] };
  hasAlert: (Why & { nodes: Node[]; has: boolean })[];
};

describe('the rules the direct read shares with the runner', () => {
  it('has the runner’s times', () => {
    expect({
      tolerance: TOLERANCE,
      inertQuietMs: INERT_QUIET_MS,
      alertAppearMs: ALERT_APPEAR_MS,
      alertWatchMs: ALERT_WATCH_MS,
    }).toEqual(rules.times);
  });

  it('computes the digest the runner computes', () => {
    expect(layoutHash(rules.digest.nodes)).toBe(rules.digest.hash);
    for (const c of rules.sameDigest) expect(layoutHash(c.a), c.why).toBe(layoutHash(c.b));
  });

  it('calls the same layouts the same', () => {
    for (const c of rules.sameLayout) expect(sameLayout(c.a, c.b), c.why).toBe(c.same);
  });

  it('knows what a tap can reach', () => {
    for (const { nodes, points } of rules.actionable)
      for (const p of points) expect(actionable(nodes, p.x, p.y), p.why).toBe(p.actionable);
    expect(actionable(undefined, 0, 0)).toBe(true);
  });

  it('finds the bars', () => {
    for (const c of rules.scrollBars) expect(scrollIndicators(c.nodes), c.why).toEqual(c.bars);
    const { nodes, screen, bars } = rules.containerBars;
    expect(containerBars(nodes, screen)).toEqual(bars);
  });

  it('knows an alert', () => {
    for (const c of rules.hasAlert) expect(hasAlert(c.nodes), c.why).toBe(c.has);
  });
});

describe('the type tables', () => {
  const swift = readFileSync(join(import.meta.dirname, '../../../ios/Runner/Device.swift'), 'utf8');
  const inside = (open: string, close: string) => {
    const start = swift.indexOf(open);
    expect(start, open).toBeGreaterThanOrEqual(0);
    return swift.slice(start + open.length, swift.indexOf(close, start));
  };
  const names = new Map(
    [
      ...inside('names: [XCUIElement.ElementType: String] = [', '\n    ]').matchAll(
        /\.(\w+): "(\w+)"/g,
      ),
    ].map((m) => [m[1]!, m[2]!]),
  );
  const table = (name: string) =>
    new Set(
      [...inside(`${name}: Set<XCUIElement.ElementType> = [`, ']').matchAll(/\.(\w+)/g)].map((m) =>
        names.get(m[1]!),
      ),
    );

  it('names the types by raw value as the runner does', () => {
    expect([...names.values()]).toEqual(TYPES);
  });

  it('gives each type the flags the runner gives it', () => {
    expect(table('clickableTypes')).toEqual(CLICKABLE);
    expect(table('editableTypes')).toEqual(EDITABLE);
    expect(table('scrollableTypes')).toEqual(SCROLLABLE);
    expect(table('checkableTypes')).toEqual(CHECKABLE);
  });

  it('looks for bars in the containers the runner looks in', () => {
    const core = readFileSync(
      join(import.meta.dirname, '../../../ios/RunnerCore/Sources/RunnerCore/Layout.swift'),
      'utf8',
    );
    const list = /scrollers: Set<String> = \[(.*)\]/.exec(core)![1]!;
    expect(new Set([...list.matchAll(/"(\w+)"/g)].map((m) => m[1]))).toEqual(SCROLLERS);
  });
});
