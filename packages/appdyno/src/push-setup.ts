import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { pushCredentials } from '@appdyno/core';
import { keepFcmKey } from '@appdyno/driver-android';
import { keepApnsKey } from '@appdyno/driver-apple';
import { COMMANDS, usage } from './usage.js';

const NAMES = { apns: 'APNs', fcm: 'FCM' } as const;

const PRODUCTION =
  'Let a distribution build take pushes from production, api.push.apple.com? Anything else goes to the sandbox. [y/N] ';

type Use = {
  /** A person's answer at this terminal; none where there is no terminal. */
  ask?: (question: string) => Promise<string>;
  /** A file the person named. */
  read(path: string): string;
  say(line: string): void;
};

/** The terminal this runs in, if it is one: its questions on stderr, as stdout is the answer's. */
function terminalUse(): Use {
  const read = (path: string) => readFileSync(path.trim().replace(/^~(?=\/)/, homedir()), 'utf8');
  const say = (line: string) => console.log(line);
  if (!process.stdin.isTTY) return { read, say };
  return {
    read,
    say,
    ask: async (question) => {
      const line = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await line.question(question);
      } finally {
        line.close();
      }
    },
  };
}

/**
 * `appdyno push setup apns|fcm`: a push service's credentials, which only a person gives, at a terminal, and keeps for
 * this user alone; `--forget` deletes them. Nothing here says them back.
 */
export async function pushCommand(args: string[], use: Use = terminalUse()) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: COMMANDS['push setup'].flags,
  });
  const [verb, service] = positionals;
  if (verb !== 'setup' || (service !== 'apns' && service !== 'fcm')) {
    use.say(usage('push setup'));
    return 2;
  }
  const file = pushCredentials(service);
  if (values.forget) {
    const had = existsSync(file);
    rmSync(file, { force: true });
    use.say(
      had
        ? `${NAMES[service]}: its credentials are deleted from this Mac.`
        : `${NAMES[service]} was not set up.`,
    );
    return 0;
  }
  if (!use.ask) {
    use.say(`A person sets ${NAMES[service]} up at a terminal: run this in one.`);
    return 2;
  }
  try {
    if (service === 'apns')
      keepApnsKey({
        key: use.read(await use.ask('Path of the APNs key, the .p8 file: ')),
        keyId: (await use.ask('Its key ID: ')).trim(),
        teamId: (await use.ask('Team ID: ')).trim(),
        production: /^y(es)?$/i.test((await use.ask(PRODUCTION)).trim()),
      });
    else keepFcmKey(use.read(await use.ask("Path of the service account's JSON file: ")));
  } catch (e) {
    use.say((e as Error).message);
    return 1;
  }
  use.say(
    `${NAMES[service]} is set up, kept in ${file} for this user alone. push uses it, and an MCP client is told only that it is set.`,
  );
  return 0;
}
