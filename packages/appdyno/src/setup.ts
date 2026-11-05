import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import {
  appCommand,
  download,
  followMove,
  install,
  installedBy,
  manifestOf,
  putOnPath,
  serverOf,
  takeOffPath,
  update,
} from '@appdyno/cli';
import { run, type DeviceProvider } from '@appdyno/core';
import { Adb, installAdb, installTools, PLATFORM_TOOLS } from '@appdyno/driver-android';
import { COMMANDS, usage } from './usage.js';

const out = (line: string) => console.log(line);

/** `install`: the npm package's entry, or the app's own; `--moved` only follows an app that moved. */
export async function installCommand(
  args: string[],
  root: string,
  err: (line: string) => void,
): Promise<number> {
  const { values } = parseArgs({ args, options: COMMANDS.install.flags });
  const server = serverOf(root, manifestOf(root).name);
  // a copy that is not the app has no entry to follow, and must not write the npm package's over one
  if (values.moved && !server) return 0;
  if (values.moved && server) followMove(homedir(), server.command);
  const { stdin: input, stdout: output } = process;
  const terminal = input.isTTY ? createInterface({ input, output }) : undefined;
  try {
    return await install({
      home: homedir(),
      env: process.env,
      yes: values.yes || values.moved,
      remove: values.remove,
      dryRun: values['dry-run'],
      moved: values.moved,
      server,
      ask: terminal && ((question) => terminal.question(question)),
      out,
      err,
    });
  } finally {
    terminal?.close();
  }
}

/** `update`. */
export async function updateCommand(args: string[], root: string): Promise<number> {
  const { values } = parseArgs({ args, options: COMMANDS.update.flags });
  return update({ root, run, get: download, check: values.check, out });
}

/** `tools install [adb]`: adb only with a person's word on Google's terms. */
export async function toolsCommand(args: string[], err: (line: string) => void): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: COMMANDS['tools install'].flags,
  });
  if (positionals[0] !== 'install') {
    err(usage('tools install'));
    return 2;
  }
  if (positionals[1] !== 'adb') {
    out(await installTools(err));
    return 0;
  }
  if (!values['accept-license']) {
    err(`adb comes from Google, under its terms: ${PLATFORM_TOOLS.terms}`);
    err('--accept-license says you accept them, and it is downloaded');
    return 2;
  }
  out(await installAdb(err));
  return 0;
}

/** `devices`: a line each, or for the menu bar what it lists and whether adb is here at all. */
export async function devicesCommand(args: string[], providers: DeviceProvider[]) {
  const { values } = parseArgs({ args, options: COMMANDS.devices.flags });
  const found = (await Promise.all(providers.map((p) => p.list().catch(() => [])))).flat();
  if (values.json) {
    const adb = await run(new Adb().bin, ['version']).then(
      () => true,
      () => false,
    );
    out(JSON.stringify({ devices: found, adb }));
  } else for (const d of found) out(`${d.serial}\t${d.state}\t${d.model ?? ''}`);
  return 0;
}

/** `path`: only the app has a command to put there. */
export async function pathCommand(args: string[], root: string, err: (line: string) => void) {
  const { values } = parseArgs({ args, options: COMMANDS.path.flags });
  const place = installedBy(root, manifestOf(root).name);
  if (!('bundle' in place)) {
    err(`this appdyno is ${place.by}, and its own manager keeps its command`);
    return 1;
  }
  const o = { home: homedir(), command: appCommand(place.bundle), run, out };
  return values.remove ? takeOffPath(o) : putOnPath(o);
}
