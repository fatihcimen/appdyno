import { resolve, relative, isAbsolute } from 'node:path';
import { tracesDir, type TraceDigest } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { QueryOut } from './schemas.js';
import { defineOp, READ, ToolError, reply } from '../tool.js';

/** What a kept trace is asked with, by its kind. */
const ASKED_WITH =
  'a Perfetto trace (.pftrace) takes sql, one read-only SELECT; an Instruments trace (.trace) a table, and lists them with none';

/** Of a trace its tool could not read, as one whose recording broke off. */
const UNREAD =
  'record it again with the measure that kept it: a recording cut short has nothing to read';

export function perfQueryOp(ctx: ServerContext) {
  return defineOp({
    name: 'perf_query',
    title: 'Query a kept trace',
    description:
      'A bounded table from a kept trace, by the path a perf_ answer gave: Perfetto (.pftrace): read-only SQL; Instruments (.trace): its top rows (`table`; none lists the tables).',
    input: z
      .object({
        trace: z.string().max(1000),
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
      if (!inside)
        throw new ToolError(
          `not a kept trace: ${trace}`,
          'POLICY_DENIED',
          "give the path a perf_ answer names after trace (perf_query): a measurement's id is none",
        );
      let digest: TraceDigest | undefined;
      for (const p of ctx.providers) {
        digest = await p
          .queryTrace?.(path, {
            ...(sql && { sql }),
            ...(table && { table }),
            limit,
          })
          .catch((e: unknown) => {
            // a driver's refusal with nothing to do said: of how it was asked, or of a trace it could not read
            if (e instanceof DeviceError && !e.hint)
              throw new ToolError(
                e.message,
                e.code,
                e.code === 'INVALID_ARGUMENT' ? ASKED_WITH : UNREAD,
              );
            throw e;
          });
        if (digest) break;
      }
      if (!digest)
        throw new ToolError(
          `no driver reads this trace: ${trace}: perf_query reads a Perfetto trace (.pftrace) and an Instruments trace (.trace)`,
          'UNSUPPORTED',
          "a raw output or a probe's output is text: read the file itself",
        );
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
