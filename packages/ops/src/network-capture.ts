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
