import type { PlatformScreen, Screen } from '@appdyno/core';
import { NODE_FLAGS, type Point, type Tree } from '@appdyno/protocol';
import { ALLOW_POWER, approvePower } from './approval.js';
import { byPerson, type Policy } from './policy.js';
import { LEAVES, SIDE_KEYS } from './keys.js';
import { inAlert, overTheApp, powerGuard, windowAt, type Input, type InputGuard } from './power.js';
import type { Session } from './session.js';
import { ToolError } from './tool.js';

const APPLICATION_WINDOW = 1;

/** The app in front on a read: the top window of an app's own, not one a person uses over it. */
export const appInFront = (tree: Tree, port: PlatformScreen) =>
  tree.windows
    .map((w, i) => ({ w, i }))
    .filter(({ w, i }) => w.type === APPLICATION_WINDOW && !port.overApp(tree, i))
    .sort((a, b) => b.w.layer - a.w.layer)[0]?.w.pkg;

/**
 * Under `--allow-apps`, why an input lands outside the allowed apps, or undefined where it does not: in an allowed app's
 * window, or in one a person uses over an allowed app in front (its keyboard, a permission or system alert, the share
 * sheet). A touch goes by the window under it; a key or typing by the window with the focus. Android lists no window
 * under a permission prompt or a share sheet, which take the whole list: the app in front is then `before`, the one an
 * earlier read saw there.
 */
export function outsideApps(
  apps: string[],
  tree: Tree,
  port: PlatformScreen,
  input: Input,
  before?: string,
): { what: string; allow: string | undefined } | undefined {
  const allowed = (pkg: string | undefined) => !!pkg && apps.includes(pkg);
  const over = (i: number) => port.overApp(tree, i);
  const front = appInFront(tree, port) ?? before;
  const judge = (i: number) => {
    const pkg = tree.windows[i]?.pkg;
    if (allowed(pkg) || (pkg && over(i) && allowed(front))) return undefined;
    if (!pkg) return { where: "no app's window", allow: undefined };
    return over(i)
      ? { where: `${pkg} over ${front ?? "no app's window"}`, allow: front }
      : { where: pkg, allow: pkg };
  };
  const how = input.types ? 'typing' : input.key ? `the ${input.key} key` : 'a touch';
  const focused = tree.windows.findIndex((w) => w.focused);
  const windows = input.points.length
    ? input.points.map((p) => windowAt(tree, p) ?? -1)
    : [focused >= 0 ? focused : tree.windows.findIndex((w) => w.pkg === front)];
  for (const i of windows) {
    const out = judge(i);
    if (out) return { what: `${how} lands in ${out.where}`, allow: out.allow };
  }
  return undefined;
}

/**
 * A touch on what iOS's home screen app shows over the app and no read of the screen holds, Notification Center, or
 * Control Center under an alert: a control of the home screen app's read there that is no alert's.
 */
async function homeTouched(s: Session, screen: Screen, input: Input, front: string | undefined) {
  const over = input.points.length ? await overTheApp(s, screen) : undefined;
  if (!over) return undefined;
  const control = (p: Point) =>
    over.nodes.some(
      (n, i) =>
        (n.f & NODE_FLAGS.clickable) !== 0 &&
        (n.f & NODE_FLAGS.visible) !== 0 &&
        p.x >= n.b[0] &&
        p.x <= n.b[2] &&
        p.y >= n.b[1] &&
        p.y <= n.b[3] &&
        !inAlert(over, i),
    );
  const pkg = over.windows[0]?.pkg ?? 'the home screen app';
  return input.points.some(control)
    ? { what: `a touch lands in ${pkg} over ${front ?? "no app's window"}`, allow: pkg }
    : undefined;
}

/** The guard of every input of a session, under `--allow-apps`: one that lands outside the allowed apps is refused. */
export const appsGuard =
  (policy: Policy): InputGuard =>
  async (s, input) => {
    if (policy.apps.length === 0) return;
    // what leaves a screen, and the side keys, are the home key's flag's and the power guard's
    if (input.key && (LEAVES.has(input.key) || SIDE_KEYS.has(input.key))) return;
    // the read the power guard judges by too: one read for both
    // shortcut: the read a touch was aimed by, up to 20 s old where no client of this server acted since
    // (Session.beforeTouch, Session.fresh): an app that opens another by itself
    // after it lets one touch by x,y reach that one; read justNow here if that must be closed, at a read per touch
    const screen = s.fresh ?? (await s.current());
    const before = s.shownApp ?? s.appId;
    const out =
      outsideApps(policy.apps, screen.tree, s.device.platformScreen, input, before) ??
      (await homeTouched(s, screen, input, before));
    if (out)
      throw new ToolError(
        `${out.what}, not an allowed app (${policy.apps.join(', ')})`,
        'POLICY_DENIED',
        `press_key back, or launch_app an allowed app, leaves this screen; ${byPerson(
          out.allow
            ? `by adding ${out.allow} to --allow-apps`
            : 'by starting it without --allow-apps',
        )}`,
      );
  };

/** What a person can do in place of a press by name, which no look at the screen can judge. */
const BY_NAME_AHEAD = `a press by name has no place on the screen to tell a power, emergency, erase or call control by, so each one asks; a person allows them ahead in this server's own command line: ${ALLOW_POWER}`;

/**
 * An element pressed by its words or id alone, as an iPhone's inspector does, may be any app's and any control: refused
 * where the server holds to an app, else asked of the person.
 */
async function pressedByName(policy: Policy, s: Session, name: string) {
  const [why, flag] =
    policy.apps.length > 0
      ? [`it may land outside the allowed apps (${policy.apps.join(', ')})`, '--allow-apps']
      : [policy.allowHome ? undefined : 'it may leave the app', '--no-home'];
  if (why)
    throw new ToolError(
      `a press by name is off on this server: ${why}`,
      'POLICY_DENIED',
      byPerson(`by starting it without ${flag}`),
    );
  await approvePower(
    policy,
    s,
    `the element ${JSON.stringify(name)}, pressed by name with no look at what it is`,
    BY_NAME_AHEAD,
  );
}

/** Every input of a session passes the allowed apps first, then the power guard, both by one read. */
export const inputGuard = (policy: Policy): InputGuard => {
  const apps = appsGuard(policy);
  const power = powerGuard(policy);
  return async (s, input) => {
    if (input.named !== undefined) return pressedByName(policy, s, input.named);
    await apps(s, input);
    await power(s, input);
  };
};
