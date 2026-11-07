import type { ProfileEntry } from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { ProfileOut } from './schemas.js';
import { defineOp, READ, reply } from '../tool.js';
import { perfTools, App, Dsym, symbolsOf } from './shared.js';

/** What an answer holds; the measurement keeps them all, for a diff of two runs. */
const SHOWN = 15;
const shortList = (entries: ProfileEntry[]) =>
  entries.slice(0, SHOWN).map((e) => ({ percent: e.percent, symbol: e.symbol }));

export function perfProfileOp(ctx: ServerContext) {
  const { measure, appOf, virtualNote, save, scroller } = perfTools(ctx);
  return defineOp({
    name: 'perf_profile',
    title: 'CPU profile',
    description:
      "Where the app's CPU time goes: sampled for `seconds` (a debuggable or profileable app), the top functions.",
    input: z
      .object({
        app: App,
        seconds: z.number().int().min(1).max(30).default(3),
        scroll: z.enum(['up', 'down']).optional(),
        dsym: Dsym,
      })
      .strict(),
    output: ProfileOut,
    annotations: READ,
    run: async ({ app, seconds, scroll, dsym }) => {
      const s = await ctx.session();
      s.appPid = undefined;
      const pkg = appOf(s, app);
      const profile = measure(s, 'cpuProfile');
      const during = scroll ? await scroller(s, scroll, 300) : undefined;
      const m = await profile(pkg, seconds * 1000, during, symbolsOf(s, dsym));
      if (scroll) s.acted();
      const saved = await save('cpu-profile', [m], m.value);
      return reply(
        [
          `measurement ${saved.id}${virtualNote(s)}`,
          `${m.value.samples} samples, ${m.value.durationMs} ms; the most time:`,
          ...m.value.top.slice(0, 10).map((e) => `%${e.percent} ${e.symbol}`),
          ...(m.value.appTop?.length
            ? [
                "the app's own functions (with what they call):",
                ...m.value.appTop.slice(0, 10).map((e) => `%${e.percent} ${e.symbol}`),
              ]
            : []),
          `raw output: ${saved.txt}`,
        ].join('\n'),
        {
          id: saved.id,
          raw: saved.txt,
          virtualDevice: s.device.virtual,
          samples: m.value.samples,
          top: shortList(m.value.top),
          ...(m.value.appTop && { appTop: shortList(m.value.appTop) }),
        },
      );
    },
  });
}
