import { resolve, relative, isAbsolute } from 'node:path';
import { tracesDir, type TraceDigest } from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { QueryOut } from './schemas.js';
import { defineOp, READ, ToolError, reply } from '../tool.js';

export function perfQueryOp(ctx: ServerContext) {
  return defineOp({
    name: 'perf_query',
    title: 'Query a kept trace',
    description:
      'A bounded table from a kept trace: Perfetto (.pftrace): read-only SQL; Instruments (.trace): its top rows (`table`; none lists the tables).',
    input: z
      .object({
        trace: z.string().max(1000).describe('the path a perf_ answer gave'),
        sql: z.string().max(10_000).optional(),
        table: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(500).default(50),
      })
      .strict(),
    output: QueryOut,
    annotations: READ,
    run: async ({ trace, sql, table, limit }) => {
      const path = resolve(trace);
      const inside = [tracesDir(), ctx.measurementsDir].some((d) => {
        const r = relative(d, path);
        return r !== '' && !r.startsWith('..') && !isAbsolute(r);
      });
      if (!inside) throw new ToolError(`not a kept trace: ${trace}`, 'POLICY_DENIED');
      let digest: TraceDigest | undefined;
      for (const p of ctx.providers) {
        digest = await p.queryTrace?.(path, {
          ...(sql && { sql }),
          ...(table && { table }),
          limit,
        });
        if (digest) break;
      }
      if (!digest) throw new ToolError(`no driver reads this trace: ${trace}`, 'UNSUPPORTED');
      return reply(
        [
          digest.columns.join(' | '),
          ...digest.rows.map((r) => r.join(' | ')),
          ...(digest.dropped ? [`(${digest.dropped} more rows left out)`] : []),
          `from: ${digest.source}`,
        ].join('\n'),
        { columns: digest.columns, rows: digest.rows, dropped: digest.dropped, trace: path },
      );
    },
  });
}
