// The two processes of hub-dies.test.ts: a hub, and a command it runs. Real ones: what is tested is a hub that dies.
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { must } from '@appdyno/core';
import { HubRuns } from '../src/hub-run.js';
import { endWithHub } from '../src/lifetime.js';

const [mode, on] = process.argv.slice(2);

if (mode === 'hub') {
  const self = [process.execPath, fileURLToPath(import.meta.url), 'command', must(on, 'its way')];
  new HubRuns(self, process.env, tmpdir()).start('tools', {}, (said) =>
    console.log(JSON.stringify(said)),
  );
} else {
  endWithHub();
  if (on === 'refuses') process.on('SIGINT', () => undefined);
  console.log(`up ${process.pid}`);
  setInterval(() => undefined, 1_000);
}
