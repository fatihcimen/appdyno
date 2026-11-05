import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { download, install, update } from '@appdyno/cli';
import { run, type DeviceProvider } from '@appdyno/core';
import { installAdb, installTools, PLATFORM_TOOLS } from '@appdyno/driver-android';
import { COMMANDS, usage } from './usage.js';

const out = (line: string) => console.log(line);

/** `install`. */
export async function installCommand(args: string[], err: (line: string) => void): Promise<number> {
  const { values } = parseArgs({ args, options: COMMANDS.install.flags });
  const { stdin: input, stdout: output } = process;
  const terminal = input.isTTY ? createInterface({ input, output }) : undefined;
  try {
    return await install({
      home: homedir(),
      env: process.env,
      yes: values.yes,
      remove: values.remove,
      dryRun: values['dry-run'],
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

/** `devices`: a line each. */
export async function devicesCommand(providers: DeviceProvider[]) {
  for (const provider of providers)
    for (const d of await provider.list()) out(`${d.serial}\t${d.state}\t${d.model ?? ''}`);
  return 0;
}
