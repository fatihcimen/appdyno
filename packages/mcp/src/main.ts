#!/usr/bin/env node
// appdyno MCP server over stdio. stdout is the MCP channel: logs go to stderr only.
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ServerContext } from './context.js';
import { DEFAULT_POLICY, type Policy } from './policy.js';
import { createServer } from './server.js';
import { createTools } from './tools.js';

const { values } = parseArgs({
  options: {
    device: { type: 'string' },
    app: { type: 'string' },
    'allow-devices': { type: 'string' },
    'allow-apps': { type: 'string' },
    'allow-urls': { type: 'string' },
    'no-home': { type: 'boolean' },
    measurements: { type: 'string' },
  },
});
const env = process.env;
const list = (s: string | undefined) =>
  (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const regex = (s: string | undefined) => (s ? new RegExp(s) : undefined);
const devices = regex(values['allow-devices'] ?? env.APPDYNO_ALLOW_DEVICES);
const urls = regex(values['allow-urls'] ?? env.APPDYNO_ALLOW_URLS);
const policy: Policy = {
  ...DEFAULT_POLICY,
  ...(devices && { devices }),
  ...(urls && { urls }),
  apps: list(values['allow-apps'] ?? env.APPDYNO_ALLOW_APPS),
  allowHome: !values['no-home'],
  secrets: list(env.APPDYNO_SECRETS),
};
const device = values.device ?? env.APPDYNO_SERIAL;
const app = values.app ?? env.APPDYNO_APP;
const ctx = new ServerContext(policy, undefined, {
  ...(device && { device }),
  ...(app && { app }),
});
const log = (line: object) =>
  process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), ...line })}\n`);
process.stdin.once('close', () => {
  ctx.close();
  process.exit(0);
});
await createServer(createTools(ctx), log).connect(new StdioServerTransport());
