import { NODE_FLAGS, type Tree } from '@appdyno/protocol';

/** An alert or a sheet is on the screen, as an iPhone's read names them. */
export const hasAlert = (nodes: Tree['nodes']) =>
  nodes.some((n) => (n.c === 'Alert' || n.c === 'Sheet') && (n.f & NODE_FLAGS.visible) !== 0);

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
