/** The name this server goes by in a client's list. */
export const SERVER = 'appdyno';

export type Stdio = { command: string; args: string[] };

/** What most clients take, from the npm package. The app gives its own command. */
export const STDIO: Stdio = { command: 'npx', args: ['-y', 'appdyno', 'mcp'] };

export type Client = {
  name: string;
  /** Under the home folder, in order: the first that exists, else the first whose folder does. */
  files: string[];
  /** The variable that moves the file, and where it is under that. */
  moved?: { env: string; file: string };
  /** `json` refuses comments, as those clients do. */
  format: 'json' | 'jsonc' | 'toml';
  /** What the file lists its servers under. */
  key: string;
  entry: (server: Stdio) => Record<string, unknown>;
  /** The client writes this file itself: added to when it exists, and never begun for it. */
  ownFile?: true;
};

/** Each as its own documentation has it. */
export const CLIENTS: Client[] = [
  {
    name: 'Claude Code',
    files: ['.claude.json'],
    moved: { env: 'CLAUDE_CONFIG_DIR', file: '.claude.json' },
    format: 'json',
    key: 'mcpServers',
    entry: (server) => server,
    ownFile: true,
  },
  {
    name: 'Claude Desktop',
    files: ['Library/Application Support/Claude/claude_desktop_config.json'],
    format: 'json',
    key: 'mcpServers',
    entry: (server) => server,
  },
  {
    name: 'Cursor',
    files: ['.cursor/mcp.json'],
    format: 'jsonc',
    key: 'mcpServers',
    entry: (server) => server,
  },
  {
    name: 'VS Code',
    files: ['Library/Application Support/Code/User/mcp.json'],
    format: 'jsonc',
    key: 'servers',
    entry: (server) => ({ type: 'stdio', ...server }),
  },
  {
    name: 'Windsurf',
    files: ['.config/devin/mcp_config.json', '.codeium/windsurf/mcp_config.json'],
    moved: { env: 'XDG_CONFIG_HOME', file: 'devin/mcp_config.json' },
    format: 'jsonc',
    key: 'mcpServers',
    entry: (server) => server,
  },
  {
    name: 'Codex and ChatGPT desktop',
    files: ['.codex/config.toml'],
    moved: { env: 'CODEX_HOME', file: 'config.toml' },
    format: 'toml',
    key: 'mcp_servers',
    // 10 s and 60 s by default: a first download and a first runner build take minutes
    entry: (server) => ({ ...server, startup_timeout_sec: 120, tool_timeout_sec: 1800 }),
  },
  {
    name: 'Antigravity',
    files: ['.gemini/config/mcp_config.json'],
    format: 'jsonc',
    key: 'mcpServers',
    entry: (server) => server,
  },
  {
    name: 'Gemini CLI',
    files: ['.gemini/settings.json'],
    moved: { env: 'GEMINI_CLI_HOME', file: '.gemini/settings.json' },
    format: 'jsonc',
    key: 'mcpServers',
    entry: (server) => server,
  },
  {
    name: 'Zed',
    files: ['.config/zed/settings.json'],
    format: 'jsonc',
    key: 'context_servers',
    entry: (server) => ({ ...server, env: {} }),
  },
  {
    name: 'opencode',
    files: ['.config/opencode/opencode.json', '.config/opencode/opencode.jsonc'],
    format: 'jsonc',
    key: 'mcp',
    entry: ({ command, args }) => ({
      type: 'local',
      command: [command, ...args],
      enabled: true,
    }),
  },
  {
    name: 'Cline CLI',
    files: ['.cline/data/settings/cline_mcp_settings.json'],
    moved: { env: 'CLINE_MCP_SETTINGS_PATH', file: '' },
    format: 'jsonc',
    key: 'mcpServers',
    entry: (server) => server,
  },
];
