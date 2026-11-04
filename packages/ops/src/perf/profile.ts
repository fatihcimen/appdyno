import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { ProfileOut } from '../schemas.js';
import { type Op, defineOp, READ, reply } from '../tool.js';
import { perfTools, App, virtual } from './shared.js';

export function perfProfileOp(ctx: ServerContext): Op {
  const { measure, appOf, virtualNote, save, scroller } = perfTools(ctx);
  return defineOp({
    name: 'perf_profile',
    title: 'CPU profile',
    description:
      "Where the app's CPU time goes: sampled for `seconds` (a debuggable or profileable app), the top functions. `scroll` scrolls meanwhile.",
    input: z
      .object({
        app: App,
        seconds: z.number().int().min(1).max(30).default(3),
        scroll: z.enum(['up', 'down']).optional(),
      })
      .strict(),
    output: ProfileOut,
    annotations: READ,
    needs: 'cpuProfile',
    run: async ({ app, seconds, scroll }) => {
      const s = await ctx.session();
      s.appPid = undefined;
      const pkg = appOf(s, app);
      const profile = measure(s, 'cpuProfile');
      const during = scroll ? await scroller(s, scroll, 300) : undefined;
      const m = await profile(pkg, seconds * 1000, during);
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
          virtualDevice: virtual(s),
          samples: m.value.samples,
          top: m.value.top.map((e) => ({ percent: e.percent, symbol: e.symbol })),
          ...(m.value.appTop && {
            appTop: m.value.appTop.map((e) => ({ percent: e.percent, symbol: e.symbol })),
          }),
        },
      );
    },
  });
}
