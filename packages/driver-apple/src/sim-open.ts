import { type DeviceQueue, must, sleep } from '@appdyno/core';
import type { ActParams } from '@appdyno/protocol';
import { HOME_SCREEN_APP, openButton } from './platform-screen.js';
import type { Simctl } from './simctl.js';
import type { DirectSim } from './simdirect.js';
import { schemesAndName } from './sim-links.js';
import type { Prompt } from './simtree.js';

const openers = new Map<string, Promise<{ schemes: string[]; name: string }>>();

/** An installed app's schemes and the name its "Open in …?" gives it, asked once a simulator. */
export function openerOf(simctl: Simctl, udid: string, app: string) {
  const key = `${udid} ${app}`;
  if (!openers.has(key))
    openers.set(
      key,
      schemesAndName(simctl, udid, app).catch(() => ({ schemes: [], name: app })),
    );
  return must(openers.get(key), "an app's schemes");
}

/** What following a link asks of a simulator: what is in front, the alert over the home screen, a touch. */
export type LinkLooks = {
  front: () => Promise<string | undefined>;
  prompt: () => Promise<Prompt | undefined>;
  tap: (at: { x: number; y: number }) => Promise<unknown>;
};

/**
 * Through the helper, each in the device's queue but the look at what is in front; a touch the helper does not send goes
 * `byRunner`, as any other touch does: a simulator whose input service it cannot find left every prompt unanswered.
 */
export const looksOf = (
  direct: DirectSim,
  queue: DeviceQueue,
  reads: { runner: () => Promise<unknown> },
  byRunner: (tap: Extract<ActParams, { kind: 'tap' }>) => Promise<unknown>,
): LinkLooks => ({
  front: () => direct.front().catch(() => undefined),
  prompt: () =>
    queue
      .run(() => direct.read(HOME_SCREEN_APP))
      .then(
        (r) => ('refused' in r ? r.prompt : undefined),
        () => undefined,
      ),
  // a touch that may have gone through is told by the next look, the prompt gone or still there
  tap: (at) =>
    queue
      .run(async () => {
        if (await direct.send({ kind: 'tap', ...at })) return true;
        // the runner touches the alert its own read had: with none, its touch went to the app under it on a turned
        // screen, and XCTest, finding the alert over that app, answered it Cancel itself (0 of 4 opened)
        await reads.runner();
        return byRunner({ kind: 'tap', ...at });
      })
      .catch(() => false),
});

/** Whether a link is in one of these schemes. */
export const ownScheme = (schemes: string[], url: string) => {
  const scheme = url.slice(0, url.indexOf(':')).toLowerCase();
  return schemes.some((s) => s.toLowerCase() === scheme);
};

const PROMPT_AGAIN_MS = 1_500;

/**
 * How long the app in front is watched for its prompt: the prompt took the front 25 to 35 ms after the link (3 of 3, at
 * load 5), after the first look had taken the app for opened and left it unanswered (4 of 4).
 */
const PROMPT_COMES_MS = 1_000;

/**
 * Until `app` is in front, up to `ms`, its "Open in …?" answered on the way if it names it (`name`). A prompt read while
 * it goes away is not answered twice: a second touch would land on the home screen. Whether the app stayed in front
 * throughout (undefined: it never came), and whether a prompt was answered.
 */
export async function untilOpened(app: string, name: string, looks: LinkLooks, ms: number) {
  const start = Date.now();
  const end = start + ms;
  let answered = 0;
  let stayed = true;
  while (Date.now() < end) {
    const front = await looks.front();
    if (front === app && (!stayed || Date.now() - start >= PROMPT_COMES_MS))
      return { stayed, answered: answered > 0 };
    if (front !== app) stayed = false;
    if (front === HOME_SCREEN_APP && Date.now() - answered > PROMPT_AGAIN_MS) {
      const open = openButton(await looks.prompt(), name);
      if (open) {
        await looks.tap(open);
        answered = Date.now();
      }
    }
    await sleep(20);
  }
  return { stayed: undefined, answered: answered > 0 };
}

const HOME_FRONT_MS = 3_000;

/**
 * Whether the helper sees `app` come in front within `ms`. During a launch no app is primary, for seconds on a loaded
 * Mac; the home screen stays so under a system alert over the app, which only the runner can tell apart.
 */
export async function helperSeesFront(direct: DirectSim, app: string, ms: number) {
  const end = Date.now() + ms;
  let homeSince: number | undefined;
  while (direct.reads && Date.now() < end) {
    const front = await direct.front().catch(() => undefined);
    if (front === app) return true;
    homeSince = front === HOME_SCREEN_APP ? (homeSince ?? Date.now()) : undefined;
    if (homeSince !== undefined && Date.now() - homeSince > HOME_FRONT_MS) return false;
    await sleep(20);
  }
  return false;
}
