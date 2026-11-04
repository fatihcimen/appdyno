/** The name this server goes by in a client's list. */
export const SERVER = 'appdyno';

const COMMAND = 'npx';
const ARGS = ['-y', 'appdyno', 'mcp'];

/** What most clients take. */
export const STDIO = { command: COMMAND, args: ARGS };

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
  entry: Record<string, unknown>;
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
    entry: STDIO,
    ownFile: true,
  },
  {
    name: 'Claude Desktop',
    files: ['Library/Application Support/Claude/claude_desktop_config.json'],
    format: 'json',
    key: 'mcpServers',
    entry: STDIO,
  },
  {
    name: 'Cursor',
    files: ['.cursor/mcp.json'],
    format: 'jsonc',
    key: 'mcpServers',
    entry: STDIO,
  },
  {
    name: 'VS Code',
    files: ['Library/Application Support/Code/User/mcp.json'],
    format: 'jsonc',
    key: 'servers',
    entry: { type: 'stdio', ...STDIO },
  },
  {
    name: 'Windsurf',
    files: ['.config/devin/mcp_config.json', '.codeium/windsurf/mcp_config.json'],
    moved: { env: 'XDG_CONFIG_HOME', file: 'devin/mcp_config.json' },
    format: 'jsonc',
    key: 'mcpServers',
    entry: STDIO,
  },
  {
    name: 'Codex',
    files: ['.codex/config.toml'],
    moved: { env: 'CODEX_HOME', file: 'config.toml' },
    format: 'toml',
    key: 'mcp_servers',
    entry: STDIO,
  },
  {
    name: 'Gemini CLI',
    files: ['.gemini/settings.json'],
    moved: { env: 'GEMINI_CLI_HOME', file: '.gemini/settings.json' },
    format: 'jsonc',
    key: 'mcpServers',
    entry: STDIO,
  },
  {
    name: 'Zed',
    files: ['.config/zed/settings.json'],
    format: 'jsonc',
    key: 'context_servers',
    entry: { ...STDIO, env: {} },
  },
  {
    name: 'opencode',
    files: ['.config/opencode/opencode.json', '.config/opencode/opencode.jsonc'],
    format: 'jsonc',
    key: 'mcp',
    entry: { type: 'local', command: [COMMAND, ...ARGS], enabled: true },
  },
  {
    name: 'Cline CLI',
    files: ['.cline/data/settings/cline_mcp_settings.json'],
    moved: { env: 'CLINE_MCP_SETTINGS_PATH', file: '' },
    format: 'jsonc',
    key: 'mcpServers',
    entry: STDIO,
  },
];
