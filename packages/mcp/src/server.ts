import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { INSTRUCTIONS, SERVER_INFO } from './brand.js';
import { inCall, inputSchemaOf, ToolError, text, type Op } from '@appdyno/ops';

/** How often a call with a progress token says it is still working. */
const BEAT_MS = 5_000;

/**
 * A JSON schema without what every tool would repeat: arguments are checked strictly when they arrive, and
 * the default of `read` and of `app` are in the server's instructions.
 */
function slim(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(slim);
  if (typeof schema !== 'object' || schema === null) return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(
        ([k, v]) =>
          k !== '$schema' &&
          !(k === 'additionalProperties' && v === false) &&
          !(k === 'default' && v === 'diff') &&
          !(k === 'description' && v === 'default: the selected app'),
      )
      .map(([k, v]) => [k, slim(v)]),
  );
}

/**
 * The MCP server, one tool per op; an unexpected failure is logged to stderr by its message only. No
 * output schemas in the catalog: 16,000 characters that a client's validator would also hold against a
 * failed answer's code and hint. Structured content goes out all the same.
 */
export function createServer(ops: Record<string, Op>, log: (line: object) => void): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  for (const { name, ...t } of Object.values(ops)) {
    server.registerTool(
      name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.input,
        annotations: t.annotations,
      },
      async (args, extra) => {
        const started = Date.now();
        const token = extra._meta?.progressToken;
        let sent = 0;
        const progress =
          token === undefined
            ? undefined
            : (message: string) =>
                void extra
                  .sendNotification({
                    method: 'notifications/progress',
                    params: { progressToken: token, progress: ++sent, message },
                  })
                  .catch(() => undefined);
        const beat =
          progress &&
          setInterval(
            () =>
              progress(`${name}: still working (${Math.round((Date.now() - started) / 1000)} s)`),
            BEAT_MS,
          );
        try {
          const r = await inCall({ signal: extra.signal, ...(progress && { progress }) }, () =>
            t.handler(args as Record<string, unknown>),
          );
          log({ tool: name, ms: Date.now() - started, outcome: 'ok' });
          return { content: r.blocks, structuredContent: r.data };
        } catch (e) {
          if (e instanceof ToolError) {
            log({ tool: name, ms: Date.now() - started, outcome: 'refused', code: e.code });
            return {
              isError: true,
              content: text(e.message),
              structuredContent: {
                code: e.code,
                ...(e.hint && { hint: e.hint }),
                ...(e.dispatched !== undefined && { dispatched: e.dispatched }),
              },
            };
          }
          // never the arguments: they may hold typed text
          log({
            tool: name,
            ms: Date.now() - started,
            outcome: 'error',
            error: (e as Error)?.message ?? String(e),
          });
          return {
            isError: true,
            content: text(`${name} failed with an internal error`),
            structuredContent: { code: 'INTERNAL', hint: 'see the server log' },
          };
        } finally {
          clearInterval(beat);
        }
      },
    );
  }
  // the SDK's own list adds a schema dialect and a task setting to every tool, and closed-object markers that
  // cost thousands of characters in every session: arguments are still checked strictly when they arrive
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: Object.values(ops).map((op) => ({
      name: op.name,
      title: op.title,
      description: op.description,
      inputSchema: slim(inputSchemaOf(op)) as ReturnType<typeof inputSchemaOf>,
      annotations: op.annotations,
    })),
  }));
  return server;
}
