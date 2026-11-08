import { must } from '@appdyno/core';

/** Who may hold Android's one UI automation connection, as the device's `ps` shows it. */
export type Holder = {
  /** What kind of process it is: `uiautomator`, `instrumentation` or `app_process`. */
  tool: string;
  pid: number;
  command: string;
  /** Run in the device's shell to stop it. */
  shell: string;
};

/** The device's process list, as `holdersIn` reads it. */
export const PROCESS_LIST = 'ps -A -o PID,USER,ARGS';

const OUR_AGENT = 'dev.appdyno.agent.Main';
/** Mirrors a screen with no UI automation: stopping it frees nothing. */
const HOLDS_NOTHING = 'com.genymobile.scrcpy';
const UIAUTOMATOR = /(?:^|[\s/])uiautomator(?:\s|$)|com\.android\.commands\.uiautomator/;
const AM_INSTRUMENT = /\bam instrument\b/;
const COMPONENT = /\s([A-Za-z]\w*(?:\.\w+)+)\/\S+/;
const APP_PROCESS = /(?:^|\/)app_process(?:32|64)?\s/;
/** A program `app_process` started shows as its class; an app's process shows as its package. */
const MAIN_CLASS = /^[a-z]\w*(?:\.[a-z]\w*)+\.[A-Z]\w*(?:\s|$)/;
const PACKAGE = /^[A-Za-z]\w*(?:\.\w+)+$/;
/** An instrumentation's own process: its test package, or a package named for what it runs on. */
const INSTRUMENTED = /\.test$|\.uiautomator\d*(?:\.|$)/;

/** A test package runs inside the app it tests: stopping that app ends both. */
const forceStop = (pkg: string) => `am force-stop ${pkg.replace(/\.test$/, '')}`;

function holderOf(
  command: string,
  pid: number,
  user: string,
): Pick<Holder, 'tool' | 'shell'> | undefined {
  const kill = `kill ${pid}`;
  const name = must(command.split(/\s/, 1)[0], 'a name').replace(/:\w+$/, '');
  // runs as the app it tests; everything else here was started from adb's shell, and an app or a
  // system service that merely looks like one must never be stopped by --takeover
  if (PACKAGE.test(name) && INSTRUMENTED.test(name))
    return { tool: 'instrumentation', shell: forceStop(name) };
  if (user !== 'shell') return undefined;
  if (AM_INSTRUMENT.test(command)) {
    const pkg = COMPONENT.exec(command)?.[1];
    return { tool: 'instrumentation', shell: pkg ? forceStop(pkg) : kill };
  }
  if (UIAUTOMATOR.test(command)) return { tool: 'uiautomator', shell: kill };
  if (APP_PROCESS.test(command) || MAIN_CLASS.test(command))
    return { tool: 'app_process', shell: kill };
  return undefined;
}

/** The processes in `PROCESS_LIST` that may hold it, other than ours, one per way to stop them. */
export function holdersIn(ps: string): Holder[] {
  const seen = new Map<string, Holder>();
  for (const line of ps.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const command = must(m[3], 'a command');
    if (
      /^(ps|grep)\b/.test(command) ||
      command.includes(OUR_AGENT) ||
      command.includes(HOLDS_NOTHING)
    )
      continue;
    // the shell that started a holder holds nothing; killing it would not free the device
    if (/^(\S*\/)?sh -c (?!.*\bam instrument\b)/.test(command)) continue;
    const found = holderOf(command, pid, must(m[2], 'a user'));
    if (found && !seen.has(found.shell)) seen.set(found.shell, { ...found, pid, command });
  }
  return [...seen.values()];
}

/** The holders in words: who, and the exact command that stops each. */
export function conflictHint(holders: Holder[], serial: string): string {
  if (holders.length === 0)
    return `it is none this tool knows: look with \`adb -s ${serial} shell ${PROCESS_LIST}\`, stop it, then retry`;
  const named = holders.map(
    (h) =>
      `${h.tool} (pid ${h.pid}): \`${h.command}\`: stop it with \`adb -s ${serial} shell ${h.shell}\``,
  );
  return `${named.join('; ')}; then retry, or start this server with --takeover to have it stopped`;
}
