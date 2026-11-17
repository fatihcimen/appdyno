import { NODE_FLAGS, type Tree } from '@appdyno/protocol';

/** An alert or a sheet is on the screen, as an iPhone's read names them. */
export const hasAlert = (nodes: Tree['nodes']) =>
  nodes.some((n) => (n.c === 'Alert' || n.c === 'Sheet') && (n.f & NODE_FLAGS.visible) !== 0);

const F = NODE_FLAGS;
const shown = (n: Tree['nodes'][number]) =>
  (n.f & F.visible) !== 0 && n.b[2] > n.b[0] && n.b[3] > n.b[1];

/** Can a tap at (x, y) start a reaction the screen does not show yet (RunnerCore's `actionable`)? */
export function actionable(nodes: Tree['nodes'] | undefined, x: number, y: number): boolean {
  if (!nodes) return true;
  let hit = false;
  for (const n of nodes) {
    if (!shown(n) || x < n.b[0] || x >= n.b[2] || y < n.b[1] || y >= n.b[3]) continue;
    hit = true;
    for (let a: Tree['nodes'][number] | undefined = n; a; a = a.p >= 0 ? nodes[a.p] : undefined) {
      if ((a.f & (F.clickable | F.longClickable | F.editable | F.checkable)) !== 0) return true;
      if (a.c.includes('WebView') || a.c.includes('Map')) return true;
    }
  }
  return !hit;
}

/** A window's type for what the system shows over an app. */
const SYSTEM = 3;

/** What is in front on a read: the app, the system's windows over it, and whether an alert or a sheet is up. */
export type Front = { app?: string; over: string[]; alert: boolean };

export function frontOf(tree: Tree): Front {
  const app = tree.windows.find((w) => w.type === 1 && w.active)?.pkg;
  return {
    ...(app && { app }),
    over: tree.windows.flatMap((w) => (w.type === SYSTEM ? [w.pkg ?? ''] : [])),
    alert: hasAlert(tree.nodes),
  };
}

/**
 * Whether what is in front on a second read is another than on the first, so that a touch aimed on the first would
 * land elsewhere: another app, a window of the system's that came or went, an alert or a sheet that came up or went
 * away. As Android's agent compares the app windows of two reads. A read that names no app proves nothing of the app.
 */
export const frontChanged = (then: Front, now: Front) =>
  (then.app !== undefined && now.app !== undefined && then.app !== now.app) ||
  then.over.join() !== now.over.join() ||
  then.alert !== now.alert;
