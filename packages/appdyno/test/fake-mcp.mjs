// A command an entry could run, for what a client would find. As a stdio server it answers `initialize` and `tools/list`;
// with `http` it stands in for `appdyno mcp --http`: it says its address, says a taken port is taken, and ends with stdin.
import { createInterface } from 'node:readline';

const [mode] = process.argv.slice(2);

if (mode === 'http') {
  const port = process.argv[process.argv.indexOf('--http') + 1]?.split(':')[1];
  if (port === process.env.FAKE_TAKEN) {
    process.stderr.write('listen EADDRINUSE: address already in use\n');
    process.exit(1);
  }
  if (process.env.FAKE_ARGS)
    (await import('node:fs')).writeFileSync(process.env.FAKE_ARGS, process.argv.join(' '));
  process.stderr.write(`appdyno mcp: http://127.0.0.1:${port}/mcp\n`);
  process.stdin.resume();
  process.stdin.once('close', () => process.exit(0));
  process.once('SIGTERM', () => process.exit(0));
} else {
  const answer = (id, result) =>
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  for await (const line of createInterface({ input: process.stdin })) {
    const { id, method, params } = JSON.parse(line);
    if (method === 'initialize')
      answer(id, {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'fake', version: '1' },
      });
    if (method === 'tools/list')
      answer(id, { tools: [{ name: 'one', inputSchema: { type: 'object' } }] });
  }
}
