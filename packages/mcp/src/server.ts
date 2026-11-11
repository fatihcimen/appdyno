import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  isInputRequiredResult,
  McpServer,
  type CallToolResult,
  type ClientCapabilities,
  type Implementation,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { noteClientCall } from '@appdyno/core';
import { INSTRUCTIONS, SERVER_INFO } from './brand.js';
import { ASK_MS, inRound, verifyRound } from './rounds.js';
import {
  ANY_ARGUMENTS,
  argumentsFor,
  inCall,
  inputSchemaOf,
  refusalText,
  ToolError,
  text,
  textOf,
  type Op,
  type ToolResult,
} from '@appdyno/ops';

/**
 * Who calls, and whether its person can be asked: a 2026-07-28 request says so itself. Over `--http` a 2025 client never
 * can be, as a server lasts one POST and never saw its `initialize`, and `createServer` asks none there at all.
 */
function callerOf(server: McpServer, ctx: ServerContext) {
  // the published type of the envelope is empty: these are its keys
  const envelope:
    | {
        [CLIENT_INFO_META_KEY]?: Implementation;
        [CLIENT_CAPABILITIES_META_KEY]?: ClientCapabilities;
      }
    | undefined = ctx.mcpReq.envelope;
  // a 2025 client says who it is and what it can once, in `initialize`, which only these deprecated accessors keep
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- a 2025 client's own, as above
  const named = server.server.getClientVersion();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- a 2025 client's own, as above
  const declared = server.server.getClientCapabilities();
  const elicitation = (envelope?.[CLIENT_CAPABILITIES_META_KEY] ?? declared)?.elicitation;
  return {
    info: envelope?.[CLIENT_INFO_META_KEY] ?? named,
    // `elicitation: {}` is `{ form: {} }` (2025-11-25, Elicitation, Capabilities); a form is what is put
    canAsk: elicitation !== undefined && ('form' in elicitation || !('url' in elicitation)),
  };
}

/** A refusal, whole in its words and whole in its structured content, as a client may show either alone. */
const refusal = (e: ToolError): CallToolResult => {
  const said = refusalText(e);
  return {
    isError: true,
    content: text(said),
    structuredContent: {
      text: said,
      code: e.code,
      ...(e.hint && { hint: e.hint }),
      ...(e.dispatched !== undefined && { dispatched: e.dispatched }),
    },
  };
};

/**
 * An answer's structured content: its whole text, as a client may hand a model this in place of the text, and beside it
 * the summary but for `done`, the words the text starts with, which a listing's or `steps`' is the whole of.
 */
export const structuredOf = ({ blocks, data }: ToolResult): Record<string, unknown> => {
  const said = textOf(blocks);
  const { done, ...rest } = data;
  return { text: said, ...(typeof done === 'string' && !said.includes(done) && { done }), ...rest };
};

/** What many tools would each say of an argument: the server's instructions say it once. */
const IN_INSTRUCTIONS = new Set([
  'default: the selected app',
  'kept under this name',
  'iOS simulator: frame probe; relaunches the app',
]);

/**
 * A JSON schema without what every tool would repeat: arguments are checked strictly when they arrive, and
 * the default of `read` is in the server's instructions.
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
          !(k === 'description' && typeof v === 'string' && IN_INSTRUCTIONS.has(v)),
      )
      .map(([k, v]) => [k, slim(v)]),
  );
}

/**
 * The MCP server, one tool per op; an unexpected failure is logged to stderr by its message only. No
 * output schemas in the catalog: 16,000 characters that a client's validator would also hold against a
 * failed answer's code and hint. Structured content goes out all the same, as `structuredOf` has it. `http` says the server serves `--http`, where a server lasts
 * one POST and the `initialize` that named its client, `client`, came in another. There no one is asked: whoever holds
 * the token answers what it is asked, so what loses data or acts on a device's power goes ahead only by the person's
 * own flag, as SECURITY.md has it.
 */
export function createServer(
  ops: Record<string, Op>,
  log: (line: object) => void,
  http?: { client: string | undefined },
): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: INSTRUCTIONS,
    inputRequired: { roundTimeoutMs: ASK_MS },
    requestState: { verify: verifyRound },
  });
  for (const { name, ...t } of Object.values(ops)) {
    server.registerTool(
      name,
      {
        title: t.title,
        description: t.description,
        inputSchema: ANY_ARGUMENTS,
        annotations: t.annotations,
      },
      async (args, ctx) => {
        const caller = callerOf(server, ctx);
        const client = http?.client ? { name: http.client } : caller.info;
        // what earns a client its word in the hub: a call that got here, whatever came of it
        if (client) noteClientCall(client, http ? 'http' : 'stdio');
        const started = Date.now();
        const said = (outcome: string, more?: object) =>
          log({ tool: name, ms: Date.now() - started, outcome, ...more });
        const answer = await inRound(
          name,
          ctx,
          async ({ signal, progress, ask }): Promise<CallToolResult> => {
            try {
              const r = await inCall(
                {
                  signal,
                  progress,
                  ...(client && { client: client.name }),
                  ...(caller.canAsk && !http && { ask }),
                },
                () => t.handler(argumentsFor(t, args)),
              );
              said('ok');
              return { content: r.blocks, structuredContent: structuredOf(r) };
            } catch (e) {
              if (e instanceof ToolError) {
                said('refused', { code: e.code });
                return refusal(e);
              }
              // never the arguments: they may hold typed text
              said('error', { error: e instanceof Error ? e.message : String(e) });
              return refusal(
                new ToolError(
                  `${name} failed with an internal error`,
                  'INTERNAL',
                  'see the server log',
                ),
              );
            }
          },
          () =>
            refusal(
              new ToolError(
                `${name}: the question it asked is no longer waiting, unanswered for ${ASK_MS / 60_000} minutes or asked before a restart: nothing more was done`,
                'PERMISSION_REQUIRED',
                'ask again only if the person asks for it',
              ),
            ),
        );
        if (isInputRequiredResult(answer)) said('asked');
        return answer;
      },
    );
  }
  // the SDK's own list adds a schema dialect and a task setting to every tool, and closed-object markers that
  // cost thousands of characters in every session: arguments are still checked strictly when they arrive
  server.server.setRequestHandler('tools/list', () => ({
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
