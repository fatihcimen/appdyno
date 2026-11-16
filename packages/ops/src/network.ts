import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { must, reportProgress, type NetworkPath } from '@appdyno/core';
import { STATUS } from '@appdyno/flows';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { detailLines, line, networkAnswers } from './network-answer.js';
import {
  captures,
  endCapture,
  readCapture,
  setRules,
  setStrict,
  setThrottle,
  startOwn,
  VIA,
} from './network-capture.js';
import { awaitRequest } from './network-check.js';
import { harEntries } from './network-har.js';
import { MAX_RULES } from './network-rules.js';
import { NetworkOut } from './network-schemas.js';
import { checkApp } from './policy.js';
import type { Session } from './session.js';
import { setCondition } from './settings.js';
import { defineOp, DESTRUCTIVE, reply, ToolError } from './tool.js';

const MAX_ENTRIES = 200;
const DEFAULT_ENTRIES = 50;
const ACTIONS = ['paths', 'start', 'read', 'stop', 'mock', 'throttle', 'check'] as const;

const SEES_PROXY =
  "every HTTP request of an app that keeps the system proxy, through a proxy you run; HTTPS shows only its host unless the proxy decrypts it, with its own CA on the device (this tool installs none). Bodies: only in the proxy's export, only where it decrypted. Pinned apps and apps that set no proxy do not show";
/** What a rule that fails a request, or a throttle, does not reach: said with each. */
const APP_ONLY =
  "only the app's URLSession requests: the system still reads the Mac's network as it is";

/** The actions that take `strict`: each starts the probe's capture, or changes what it does. */
const SETS: readonly string[] = ['start', 'mock', 'throttle'];
const STRICT_ON =
  'strict on: an action fails when a request of the app got a 5xx or failed on its way, unless a rule made it';

const listening = (hostPort: string) =>
  new Promise<boolean>((resolve) => {
    const [host, port] = hostPort.split(':');
    const c = connect({ host: must(host, 'a host'), port: Number(port), timeout: 2_000 });
    const done = (v: boolean) => {
      c.destroy();
      resolve(v);
    };
    c.once('connect', () => done(true));
    c.once('error', () => done(false));
    c.once('timeout', () => done(false));
  });

export function networkOps(ctx: ServerContext) {
  const { clean, shownOf, detailOf, exportHar, answer, controlAnswer } = networkAnswers(ctx);

  const paths = async (s: Session): Promise<NetworkPath[]> => {
    const own = (await s.device.network?.paths()) ?? [];
    const proxy = await s.device.settings.get('proxy').then(
      (now) => ({ via: 'proxy' as const, sees: `${SEES_PROXY}. Now: ${now}` }),
      (e: unknown) => ({
        via: 'proxy' as const,
        refused: e instanceof Error ? e.message : String(e),
      }),
    );
    return [proxy, ...own];
  };

  return [
    defineOp({
      name: 'network',
      title: 'Network',
      description:
        "An app's network traffic (HTTP), bounded; mock and throttle by the probe, until stop. paths: what each way sees here, or why not; start (via proxy: at proxy host:port; probe: restarts the app; bodies: keeps headers and text bodies); read (har: a proxy's export; id: one request whole; save: a .har); check: waits for a request that fits, or refuses with the nearest; stop. Installs no certificate.",
      input: z
        .object({
          action: z.enum(ACTIONS),
          via: z.enum(VIA).optional(),
          proxy: z.string().max(100).optional(),
          app: z.string().max(200).optional(),
          bodies: z.boolean().optional(),
          har: z.string().max(1_000).optional(),
          id: z.number().int().min(0).optional(),
          after: z.number().int().min(0).optional().describe('only requests after this id'),
          contains: z.string().max(200).optional(),
          method: z.string().max(10).optional(),
          status: z.string().max(6).optional().describe('404, 4xx, failed'),
          limit: z.number().int().min(1).max(MAX_ENTRIES).default(DEFAULT_ENTRIES),
          save: z.string().max(1_000).optional(),
          overwrite: z.boolean().optional(),
          rules: z
            .array(z.string().max(4_000))
            .max(MAX_RULES)
            .optional()
            .describe(
              'Each "host/path* [method=] [query=] [regex=] [has=] [when=]" then "status= body= (@file) type= header=", "fail=offline|timeout|reset" or "to=host", and delayMs= times= off. Replaces; [] clears; none lists',
            ),
          add: z.boolean().optional(),
          has: z.string().max(1_000).optional().describe('in its body: path=value or text'),
          timeoutMs: z.number().int().min(0).max(60_000).optional(),
          strict: z.boolean().optional().describe('a 5xx or a failed request fails the action'),
          throttle: z
            .string()
            .max(100)
            .optional()
            .describe(
              'full, slow, edge, 3g, lte, offline, bytes/s down, or "delayMs= down= up= loss="',
            ),
        })
        .strict(),
      output: NetworkOut,
      annotations: DESTRUCTIVE,
      run: async ({ action, via, proxy, app, bodies, har, id, rules, add, throttle, ...given }) => {
        const { strict, has, timeoutMs, ...asked } = given;
        const s = await ctx.session();
        const serial = s.device.serial;
        const now = captures.read(serial);
        const target = app ?? s.appId;
        if (asked.status && !STATUS.test(asked.status))
          throw new ToolError(
            `status: 404, 4xx or failed, not ${asked.status}`,
            'INVALID_ARGUMENT',
          );
        if (action === 'paths') {
          const ways = await paths(s);
          const t = ways.map((p) => `${p.via}: ${p.sees ?? `no: ${String(p.refused)}`}`).join('\n');
          return reply(clean(t), { done: clean(t), paths: ways });
        }
        if (strict !== undefined && !SETS.includes(action))
          throw new ToolError('strict goes with start, mock or throttle', 'INVALID_ARGUMENT');
        if (action === 'mock' || action === 'throttle') {
          const sets = action === 'mock' ? rules : throttle;
          if (sets === undefined && strict === undefined) return controlAnswer(s, now, []);
          if (target) checkApp(ctx.policy, target);
          const set =
            sets === undefined
              ? undefined
              : action === 'mock'
                ? await setRules(s, ctx.policy, target, rules ?? [], add)
                : await setThrottle(s, target, throttle ?? 'full');
          const judged = strict === undefined ? undefined : await setStrict(s, target, strict);
          const capture = must(judged?.capture ?? set?.capture, 'the capture');
          return controlAnswer(s, capture, [
            ...((set ?? judged)?.started
              ? [`started a capture by the probe: ${String(target)} was restarted with it`]
              : []),
            ...(set
              ? [
                  `${action === 'mock' ? 'rules set' : `throttle ${capture.throttle ?? 'full'}`}: for ${APP_ONLY}; ended by network stop`,
                ]
              : []),
            ...(strict === undefined ? [] : [strict ? STRICT_ON : 'strict off']),
          ]);
        }
        if (action === 'start') {
          if (!via) {
            const here = (await paths(s)).filter((p) => p.sees).map((p) => p.via);
            throw new ToolError(
              `start needs via: ${here.length ? `this device has ${here.join(', ')}` : `none of ${VIA.join(', ')} works on this device`}`,
              'INVALID_ARGUMENT',
              'network paths says what each sees, and what it costs',
            );
          }
          if (strict !== undefined && via !== 'probe')
            throw new ToolError(`strict goes by the probe, not by ${via}`, 'INVALID_ARGUMENT');
          if (now)
            throw new ToolError(
              `${now.via} has been capturing on ${serial} since ${new Date(now.since).toISOString()}: stop it first`,
              'INVALID_ARGUMENT',
            );
          if (target) checkApp(ctx.policy, target);
          if (via === 'proxy') {
            const was = await s.device.settings.get('proxy');
            const want = proxy ?? was;
            if (want === 'none')
              throw new ToolError(
                `give proxy: host:port (this device has none set)`,
                'INVALID_ARGUMENT',
              );
            if (!/^[\w.-]+:\d+$/.test(want))
              throw new ToolError(`proxy: host:port, not ${want}`, 'INVALID_ARGUMENT');
            // a device left on a dead proxy has no network at all
            if (/^(127\.0\.0\.1|localhost):/.test(want) && !(await listening(want)))
              throw new ToolError(
                `nothing listens on ${want}: start your proxy first`,
                'NOT_FOUND',
              );
            if (was !== want) await setCondition(s, 'proxy', want);
            captures.write(serial, { via, since: Date.now(), proxy: want, owner: s.owner });
            const t = `traffic goes through ${want}${was === want ? ' (it already did)' : `, ${was} before`}. ${SEES_PROXY}`;
            return reply(t, { done: t });
          }
          const { sees } = await startOwn(s, via, target, bodies === true);
          if (strict !== undefined) await setStrict(s, target, strict);
          const t = `capturing by ${via}${via === 'probe' ? `: ${target ?? 'the app'} was restarted with it` : ''}${sees ? `; it sees ${sees}` : ''}${strict ? `; ${STRICT_ON}` : ''}`;
          return reply(t, { done: t });
        }
        if (action === 'stop') {
          if (!now) throw new ToolError(`no capture runs on ${serial}`, 'NOT_FOUND');
          // written before it ends: its bodies go with it
          const last = asked.save ? await readCapture(s, now) : undefined;
          const saved = await exportHar(s, now, last?.entries ?? [], asked);
          const end = await endCapture(s);
          const { save: _, ...rest } = asked;
          return answer(s, now, end ?? { entries: [] }, rest, now.via, saved);
        }
        // read
        if (har) {
          if (!existsSync(har)) throw new ToolError(`no such file: ${har}`, 'NOT_FOUND');
          const entries = await harEntries(har, now?.since);
          return answer(s, undefined, { entries }, asked, har);
        }
        if (!now)
          throw new ToolError(
            `no capture runs on ${serial}: start one, or give har (a proxy's export)`,
            'NOT_FOUND',
          );
        if (now.via === 'proxy') reportProgress('exporting from the proxy');
        const read = await readCapture(s, now);
        if (!read)
          throw new ToolError(
            `the traffic went through ${String(now.proxy)}, whose list this tool cannot read: export the proxy's session as HAR and give har`,
            'UNSUPPORTED',
          );
        if (action === 'check') {
          if (has !== undefined && !now.bodies)
            throw new ToolError(
              'has reads a body, and this capture keeps none: start with bodies: true',
              'INVALID_ARGUMENT',
            );
          const again = async () => ((await readCapture(s, now, true)) ?? read).entries;
          const found = shownOf(
            await awaitRequest(again, detailOf(s, now), { ...asked, has, timeoutMs }, clean),
          );
          const t = `found: ${line(found, true)}`;
          return reply(t, { done: t, entries: [found], source: now.via });
        }
        if (id === undefined)
          return answer(s, now, read, asked, now.via === 'proxy' ? 'the proxy' : now.via);
        const one = read.entries.find((e) => e.id === id);
        if (!one)
          throw new ToolError(
            `no request ${id}: this capture has ${read.entries.length}`,
            'NOT_FOUND',
          );
        const shown = shownOf(one);
        const lines = detailLines(shown, await detailOf(s, now)(id), clean);
        return reply(lines.join('\n'), { entries: [shown], source: now.via, detail: lines });
      },
    }),
  ];
}
