#!/usr/bin/env node
// `appdyno-mcp` is `appdyno mcp`.
process.argv.splice(2, 0, 'mcp');
await import('./main.js');
