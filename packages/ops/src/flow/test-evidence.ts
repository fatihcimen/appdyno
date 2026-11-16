import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Screen } from '@appdyno/core';
import type { Evidence } from '@appdyno/flows';
import type { ServerContext } from '../context.js';
import { paintedShot } from '../report-write.js';
import type { Session } from '../session.js';

/** As many of the app's last log messages as a failure keeps: one may run over several lines. */
const LOG_TAIL = 200;
const MAX_CRASHES = 5;

type Moment = {
  /** The screen as read at the failure: none, and no picture is kept, as nothing says what to paint over. */
  screen: Screen | undefined;
  /** When the run began: a crash before it is another run's. */
  since: number;
  clean: (s: string) => string;
};

/**
 * The failure's moment on disk: the screen's picture, painted over where an element is a password field or holds a
 * secret, its tree, the app's last log lines and its crash reports, their secrets hidden. What cannot be had is left
 * out, the failure already says enough.
 */
export async function keepEvidence(
  ctx: ServerContext,
  s: Session,
  dir: string,
  { screen, since, clean }: Moment,
) {
  mkdirSync(dir, { recursive: true });
  const out: string[] = [];
  const keep = (name: string, data: string | Buffer) => {
    const file = join(dir, name);
    writeFileSync(file, data);
    out.push(file);
  };
  const shot =
    screen &&
    (await paintedShot(ctx, s, screen, { maxPx: 1024, quality: 80 }).catch(() => undefined));
  if (shot) keep(`screen.${shot.ext}`, shot.data);
  const tree = await s.device.tree().catch(() => undefined);
  if (tree)
    keep(
      'tree.json',
      JSON.stringify(tree, (_k, v: unknown) => (typeof v === 'string' ? clean(v) : v), 1),
    );
  const app = s.appId;
  if (!app) return out;
  const logs = await s.device
    .logs({ app, level: 'info', maxLines: LOG_TAIL })
    .catch(() => undefined);
  if (logs?.lines.length) keep('log.txt', `${logs.lines.map(clean).join('\n')}\n`);
  const crashes = await s.device.crashes({ app, limit: MAX_CRASHES, since }).catch(() => undefined);
  if (crashes?.reports.length)
    keep(
      'crash.txt',
      crashes.reports
        .map((r) => clean(`${r.at} ${r.reason}${r.detail ? `\n${r.detail}` : ''}`))
        .join('\n\n'),
    );
  return out;
}

/** The files a failure left, by what each is: paths as `pathOf` gives them. */
export function evidenceOf(saved: string[] = [], pathOf: (file: string) => string): Evidence {
  const named = (name: RegExp) => saved.find((f) => name.test(basename(f)));
  const kinds = {
    shot: named(/^screen\.(jpg|png)$/),
    tree: named(/^tree\.json$/),
    log: named(/^log\.txt$/),
    crash: named(/^crash\.txt$/),
  };
  return Object.fromEntries(Object.entries(kinds).flatMap(([k, f]) => (f ? [[k, pathOf(f)]] : [])));
}
