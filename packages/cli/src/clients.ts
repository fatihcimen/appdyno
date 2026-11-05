/** The name this server goes by in a client's list. */
export const SERVER = 'appdyno';

export type Stdio = { command: string; args: string[] };

/** What most clients take, from the npm package. The app gives its own command. */
export const STDIO: Stdio = { command: 'npx', args: ['-y', 'appdyno', 'mcp'] };

/** Words in both of the hub's languages. */
export type Said = { en: string; tr: string };

/** What a prompt asks of a client that treats it its own way: a measure's minutes, acting on a device, or a picture. */
export type PromptKind = 'long' | 'acts' | 'picture';

/** What any client has, wherever it runs. */
export type Named = {
  name: string;
  /** What it calls itself in MCP's `clientInfo`, which only its own call shows: `docs/clients.md` says which were seen. */
  says: RegExp;
  /** Where a person sees that it worked. */
  check: Said;
  /** Where a prompt goes differently in it. */
  notes?: Partial<Record<PromptKind, Said>>;
  /** What to call it on a device, where its name is for more than one app. */
  short?: string;
};

export type Client = Named & {
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
  /** Opened from the Dock, so it has none of a shell's `PATH`, and its entry is tried with none. */
  dock?: true;
};

/** Each as its own documentation has it. */
export const CLIENTS: Client[] = [
  {
    name: 'Claude Code',
    says: /claude-code/i,
    check: {
      en: '`claude mcp list` should say Connected. Inside a session, `/mcp`.',
      tr: '`claude mcp list` çıktısında Connected görünmeli. Oturum içinde `/mcp` yazın.',
    },
    files: ['.claude.json'],
    moved: { env: 'CLAUDE_CONFIG_DIR', file: '.claude.json' },
    format: 'json',
    key: 'mcpServers',
    entry: (server) => server,
    ownFile: true,
  },
  {
    name: 'Claude Desktop',
    says: /claude-ai/i,
    check: {
      en: 'Quit it with Cmd-Q and open it again, then the + under the chat box, Connectors.',
      tr: 'Cmd-Q ile kapatıp yeniden açın, sonra sohbet kutusunun altındaki +, Connectors.',
    },
    notes: {
      long: {
        en: 'A call has about 3 to 4 minutes here: run `appdyno ios build` before a first iOS use.',
        tr: "Burada bir çağrının süresi 3-4 dakika kadardır: iOS'ta ilk kullanımdan önce `appdyno ios build` çalıştırın.",
      },
    },
    files: ['Library/Application Support/Claude/claude_desktop_config.json'],
    format: 'json',
    key: 'mcpServers',
    entry: (server) => server,
    dock: true,
  },
  {
    name: 'Cursor',
    says: /cursor/i,
    check: {
      en: "In Cursor's Output panel (Cmd-Shift-U), choose MCP Logs.",
      tr: "Cursor'ın Output panelinde (Cmd-Shift-U) MCP Logs'u seçin.",
    },
    files: ['.cursor/mcp.json'],
    format: 'jsonc',
    key: 'mcpServers',
    entry: (server) => server,
  },
  {
    name: 'VS Code',
    says: /visual studio code/i,
    check: {
      en: 'Accept the prompt that asks whether you trust the server, then Chat: Open Customizations, MCP Servers.',
      tr: 'Sunucuya güvenip güvenmediğinizi soran istemi onaylayın, sonra Chat: Open Customizations, MCP Servers.',
    },
    files: ['Library/Application Support/Code/User/mcp.json'],
    format: 'jsonc',
    key: 'servers',
    entry: (server) => ({ type: 'stdio', ...server }),
  },
  {
    name: 'Windsurf',
    says: /windsurf|devin/i,
    check: { en: 'Customize, MCPs, This computer.', tr: 'Customize, MCPs, This computer.' },
    files: ['.config/devin/mcp_config.json', '.codeium/windsurf/mcp_config.json'],
    moved: { env: 'XDG_CONFIG_HOME', file: 'devin/mcp_config.json' },
    format: 'jsonc',
    key: 'mcpServers',
    entry: (server) => server,
  },
  {
    name: 'Codex and ChatGPT desktop',
    says: /codex|chatgpt/i,
    short: 'Codex',
    check: {
      en: "`codex mcp list` shows it as enabled. In a session, or in the app's composer, `/mcp`.",
      tr: '`codex mcp list` çıktısında enabled görünür. Oturumda ya da uygulamanın yazma kutusunda `/mcp` yazın.',
    },
    notes: {
      long: {
        en: 'Adding it here gives a call 30 minutes: by default Codex stops one at 60 seconds.',
        tr: 'Buradan eklemek bir çağrıya 30 dakika verir: Codex varsayılan olarak çağrıyı 60 saniyede keser.',
      },
    },
    files: ['.codex/config.toml'],
    moved: { env: 'CODEX_HOME', file: 'config.toml' },
    format: 'toml',
    key: 'mcp_servers',
    // 10 s and 60 s by default: a first download and a first runner build take minutes
    entry: (server) => ({ ...server, startup_timeout_sec: 120, tool_timeout_sec: 1800 }),
  },
  {
    name: 'Antigravity',
    says: /antigravity/i,
    check: { en: 'Restart it, then `/mcp`.', tr: 'Yeniden başlatın, sonra `/mcp` yazın.' },
    files: ['.gemini/config/mcp_config.json'],
    format: 'jsonc',
    key: 'mcpServers',
    entry: (server) => server,
  },
  {
    name: 'Gemini CLI',
    says: /gemini/i,
    check: {
      en: '`gemini mcp list`. In a folder you have not trusted it says Disabled: start `gemini` there once and trust it.',
      tr: '`gemini mcp list`. Güvenmediğiniz bir klasörde Disabled der: orada bir kez `gemini` başlatıp klasöre güvenin.',
    },
    files: ['.gemini/settings.json'],
    moved: { env: 'GEMINI_CLI_HOME', file: '.gemini/settings.json' },
    format: 'jsonc',
    key: 'mcpServers',
    entry: (server) => server,
  },
  {
    name: 'Zed',
    says: /^zed\b/i,
    check: {
      en: 'Settings, AI, MCP Servers. The dot beside appdyno turns green.',
      tr: "Settings, AI, MCP Servers. appdyno'nun yanındaki nokta yeşile döner.",
    },
    files: ['.config/zed/settings.json'],
    format: 'jsonc',
    key: 'context_servers',
    entry: (server) => ({ ...server, env: {} }),
  },
  {
    name: 'opencode',
    says: /opencode/i,
    check: {
      en: '`opencode mcp list` says connected.',
      tr: '`opencode mcp list` çıktısında connected yazar.',
    },
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
    says: /cline/i,
    check: { en: '`cline config mcp`.', tr: '`cline config mcp`.' },
    files: ['.cline/data/settings/cline_mcp_settings.json'],
    moved: { env: 'CLINE_MCP_SETTINGS_PATH', file: '' },
    format: 'jsonc',
    key: 'mcpServers',
    entry: (server) => server,
  },
];

/** They run in their maker's cloud: nothing to add on this Mac, and they reach it by `--http` and a tunnel of a person's own. */
export const BROWSER_CLIENTS: Named[] = [
  {
    name: 'ChatGPT in a browser',
    says: /openai|chatgpt/i,
    check: {
      en: 'Business, Enterprise or Edu. Plugins, +, Add custom MCP server, then `https://<your tunnel>/mcp/<token>` and No authentication.',
      tr: 'Business, Enterprise ya da Edu. Plugins, +, Add custom MCP server, sonra `https://<tüneliniz>/mcp/<token>` ve No authentication.',
    },
    notes: {
      long: {
        en: 'Through its Secure MCP Tunnel each request has 120 seconds, and a long measure does not fit.',
        tr: 'Secure MCP Tunnel üzerinden her isteğin 120 saniyesi vardır, uzun ölçümler buna sığmaz.',
      },
      acts: {
        en: 'On Pro only tools marked read-only reach it: no tap and no typing.',
        tr: 'Pro planında yalnızca salt okunur işaretli araçlar çalışır: dokunma ve yazı yazma yoktur.',
      },
      picture: {
        en: "One report says it shows a tool's image as nothing: if `screenshot` comes back empty, use `screen`.",
        tr: 'Bir bildirime göre aracın görselini boş gösteriyor: `screenshot` boş dönerse `screen` kullanın.',
      },
    },
  },
  {
    name: 'Claude in a browser',
    says: /claude/i,
    check: {
      en: 'On the web, on a phone and in Cowork. Customize, Connectors, +, Add custom connector, then `https://<your tunnel>/mcp/<token>` and No sign-in.',
      tr: 'Web, telefon ve Cowork için. Customize, Connectors, +, Add custom connector, sonra `https://<tüneliniz>/mcp/<token>` ve No sign-in.',
    },
    notes: {
      long: {
        en: 'A tool call has about 240 seconds here: use something shorter, or a client on this Mac.',
        tr: "Burada bir araç çağrısının yaklaşık 240 saniyesi vardır: daha kısa bir işlem seçin ya da bu Mac'teki bir istemciyi kullanın.",
      },
    },
  },
];

/** What a person calls the client that named itself this: its own word, where the list has no such client. */
export function clientNamed(said: string) {
  const known = [...CLIENTS, ...BROWSER_CLIENTS].find((c) => c.says.test(said));
  return known ? (known.short ?? known.name) : said;
}
