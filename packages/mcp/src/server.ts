import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { INSTRUCTIONS, SERVER_INFO } from './brand.js';
import { ToolError, text, type Tool } from '@appdyno/ops';

/** The MCP server with `tools`; an unexpected failure is logged to stderr by its message only. */
export function createServer(tools: Record<string, Tool>, log: (line: object) => void): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  for (const [name, t] of Object.entries(tools)) {
    server.registerTool(
      name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.input,
        outputSchema: t.output,
        annotations: t.annotations,
      },
      async (args) => {
        const started = Date.now();
        try {
          const r = await t.handler(args as Record<string, unknown>);
          log({ tool: name, ms: Date.now() - started, outcome: 'ok' });
          return { content: r.blocks, structuredContent: r.data };
        } catch (e) {
          if (e instanceof ToolError) {
            log({ tool: name, ms: Date.now() - started, outcome: 'refused' });
            return { isError: true, content: text(e.message) };
          }
          // never the arguments: they may hold typed text
          log({
            tool: name,
            ms: Date.now() - started,
            outcome: 'error',
            error: (e as Error)?.message ?? String(e),
          });
          return { isError: true, content: text(`${name} failed with an internal error`) };
        }
      },
    );
  }
  return server;
}
