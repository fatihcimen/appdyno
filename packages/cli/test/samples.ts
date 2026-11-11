import { SERVER } from '../src/clients.js';

/** A file the size and shape of a client's own state: one list among much else. */
export const STATE = (key: string) => `{
  "numStartups": 12,
  "oauthAccount": { "emailAddress": "someone@example.test" },
  "projects": {
    "/work/app": {
      "mcpServers": { "${SERVER}": { "command": "old" } },
      "allowedTools": []
    }
  },
  "${key}": {
    "docs": {
      "type": "http",
      "url": "https://docs.example.test/mcp"
    }
  },
  "tipsHistory": { "a": 1 }
}
`;

/** An editor's settings: comments, a trailing comma, a tab of its own. */
export const EDITOR = (key: string) => `// the theme is the one the team uses
{
  "theme": "One Dark", // "One Light" at noon
  /* the servers
     this machine runs */
  "${key}": {
    // keep this first
    "docs": { "command": "node", "args": ["docs.js", "--port=1"], }, // on port 1
    "/* not a comment */": { "command": "//nor this" },
    "other": {
      "command": "node",
    },
  },
  "languages": { "C": { "tab_size": 8 } },
}
`;

export const TOML = (key: string) => `# the model this machine uses
model = "a-model"
approval_policy = 'on-request'
notice = """
[${key}.${SERVER}]
not a table: this is text
"""
limits = [
  1, # one
  2,
]

[${key}.docs]
command = "node" # the runtime
args = ["docs.js"]

[${key}.docs.env]
TOKEN = "t"

[profiles.fast]
model = "b-model"
retries = 3
ratio = 0.5
at = 1979-05-27 07:32:00
env = { A = "1", B = "2" }
`;
