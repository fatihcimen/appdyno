import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deviceState,
  must,
  Owner,
  reportProgress,
  run,
  type NetworkAnswer,
  type NetworkVia,
} from '@appdyno/core';
import { z } from 'zod';
import { harEntries } from './network-har.js';
import { checkSentTo, ruleLine, rulesOf, throttleOf } from './network-rules.js';
import type { Policy } from './policy.js';
import { Handle } from './schemas.js';
import type { Session } from './session.js';
import { restoreCondition } from './settings.js';
import { ToolError } from './tool.js';

export const VIA = ['proxy', 'probe', 'packets', 'bytes'] as const;

const Capture = z.object({
  via: z.enum(VIA),
  since: z.number(),
  handle: Handle.optional(),
  proxy: z.string().optional(),
  /** The probe keeps each request's headers and bodies. */
  bodies: z.boolean().optional(),
  /** The probe's rules, each as its line, and how slow it makes the network, as its word. */
  rules: z.array(z.string()).optional(),
  throttle: z.string().optional(),
  owner: Owner.optional(),
});
export type Capture = z.infer<typeof Capture>;

/** The device's capture. */
export const captures = deviceState('network', Capture);

/** The app whose network probe a running capture reads: a restore and a session's end leave that probe held. */
export const capturingApp = (serial: string) => {
  const app = captures.read(serial)?.handle?.app;
  return typeof app === 'string' ? app : undefined;
};

const PROXYMAN_CLI = [
  '/Applications/Proxyman.app/Contents/MacOS/proxyman-cli',
  '/Applications/Setapp/Proxyman.app/Contents/MacOS/proxyman-cli',
];

/** What a running Proxyman listening on `proxy`'s port has seen, if that is what `proxy` is. */
async function proxymanEntries(proxy: string | undefined, since: number) {
  const cli = PROXYMAN_CLI.find((p) => existsSync(p));
  if (!cli) return undefined;
  const host = await run(cli, ['proxy-host'], { timeout: 10_000 }).catch(() => undefined);
  const port = host && /"port"\s*:\s*(\d+)/.exec(host.stdout)?.[1];
  if (!port || !proxy?.endsWith(`:${port}`)) return undefined;
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-har-'));
  try {
    const file = join(dir, 'export.har');
    await run(cli, ['export-log', '-m', 'all', '-f', 'har', '-o', file], { timeout: 300_000 });
    return await harEntries(file, since);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What a running capture has seen so far; none from a proxy whose list this tool cannot read. */
export async function readCapture(s: Session, c: Capture): Promise<NetworkAnswer | undefined> {
  if (c.via !== 'proxy')
    return must(s.device.network, "the device's capture").read(
      must(c.handle, "the capture's handle"),
    );
  const entries = await proxymanEntries(c.proxy, c.since);
  return entries && { entries };
}

/** Ends a device's capture, its proxy put back; what the way saw to the end. */
export async function endCapture(s: Session): Promise<NetworkAnswer | undefined> {
  const serial = s.device.serial;
  const c = captures.read(serial);
  if (!c) return undefined;
  let answer: NetworkAnswer = { entries: [] };
  try {
    if (c.handle && s.device.network) answer = await s.device.network.stop(c.handle);
  } finally {
    if (c.via === 'proxy') await restoreCondition(s, 'proxy');
    captures.remove(serial);
  }
  return answer;
}

/** A capture by a way of the device's own; the probe restarts `app` with it. */
export async function startOwn(
  s: Session,
  via: NetworkVia,
  app: string | undefined,
  bodies: boolean,
) {
  const network = s.device.network;
  if (!network) throw new ToolError(`this device has no ${via} way: use proxy`, 'UNSUPPORTED');
  const way = (await network.paths()).find((p) => p.via === via);
  if (way?.refused) throw new ToolError(way.refused, 'UNSUPPORTED');
  if (bodies && via !== 'probe')
    throw new ToolError(`${via} keeps no bodies: only the probe does`, 'UNSUPPORTED');
  reportProgress(`starting ${via}`);
  const handle = await network.start(via, app, bodies);
  const capture: Capture = {
    via,
    since: Date.now(),
    handle,
    ...(bodies && { bodies }),
    owner: s.owner,
  };
  captures.write(s.device.serial, capture);
  if (via === 'probe') s.acted();
  return { capture, sees: way?.sees };
}

const NO_PROBE_HINT =
  'a simulator has the probe; an Android device is slowed by device_setting network';

/**
 * The probe's capture, which its rules and its throttle live in: the one that runs, or one started for `app`, which
 * restarts it.
 */
async function probeCapture(s: Session, app: string | undefined, what: string) {
  const serial = s.device.serial;
  const now = captures.read(serial);
  if (now && now.via !== 'probe')
    throw new ToolError(
      `${what} goes by the probe, and ${now.via} is capturing on ${serial}: stop it first`,
      'INVALID_ARGUMENT',
    );
  if (!s.device.network?.control)
    throw new ToolError(
      `${what} goes by the probe, which this device has not`,
      'UNSUPPORTED',
      NO_PROBE_HINT,
    );
  if (now) return { capture: now, started: false };
  if (!app) throw new ToolError(`${what} goes into one app: give app`, 'INVALID_ARGUMENT');
  return { capture: (await startOwn(s, 'probe', app, false)).capture, started: true };
}

/** What the capture's probe does from now on, as the capture has it. */
function tellProbe(s: Session, c: Capture) {
  const throttle = c.throttle === undefined ? undefined : throttleOf(c.throttle);
  const network = must(s.device.network, 'a capture');
  if (!network.control)
    throw new ToolError('this device has no probe', 'UNSUPPORTED', NO_PROBE_HINT);
  network.control(must(c.handle, 'its handle'), {
    bodies: c.bodies === true,
    rules: rulesOf(c.rules ?? []),
    ...(throttle && { throttle }),
  });
  captures.write(s.device.serial, c);
}

/** The capture's rules replaced by `lines`, or with `add` those after the ones there; `started`: the app restarted. */
export async function setRules(
  s: Session,
  policy: Policy,
  app: string | undefined,
  lines: string[],
  add = false,
) {
  // refused before anything starts, where a line is no rule or sends requests where it may not
  rulesOf(lines);
  checkSentTo(policy, lines);
  const given = lines.map(ruleLine);
  const { capture, started } = await probeCapture(s, app, 'a rule');
  const kept = add ? (capture.rules ?? []).filter((l) => !given.includes(l)) : [];
  const next: Capture = { ...capture, rules: [...kept, ...given] };
  tellProbe(s, next);
  return { capture: next, started };
}

/** Takes out the rules of those lines, as a flow's end takes out what its steps added; the rest stay. */
export function dropRules(s: Session, lines: string[]) {
  const now = captures.read(s.device.serial);
  if (lines.length === 0 || !now?.rules || now.via !== 'probe' || !s.device.network?.control)
    return;
  const gone = lines.map(ruleLine);
  const next = { ...now, rules: now.rules.filter((l) => !gone.includes(l)) };
  try {
    tellProbe(s, next);
  } catch {
    // a rule that stays has lost the file it answers with: the list is kept, and the next change says so
    captures.write(s.device.serial, next);
  }
}

/** How slow the capture's probe makes the app's network, by its word; `full` is no slower. */
export async function setThrottle(s: Session, app: string | undefined, word: string) {
  const full = throttleOf(word) === undefined;
  const { capture, started } = await probeCapture(s, app, 'a throttle');
  const { throttle: _, ...rest } = capture;
  const next: Capture = full ? rest : { ...rest, throttle: word.trim() };
  tellProbe(s, next);
  return { capture: next, started };
}
