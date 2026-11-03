/** Who may hold Android's one UI automation connection, as the device's `ps` shows it. */
export type Holder = {
  /** What kind of process it is: `uiautomator`, `instrumentation` or `app_process`. */
  tool: string;
  pid: number;
  command: string;
  /** Run in the device's shell to stop it. */
  shell: string;
};

const OUR_AGENT = 'dev.appdyno.agent.Main';
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

function holderOf(command: string, pid: number): Pick<Holder, 'tool' | 'shell'> | undefined {
  const kill = `kill ${pid}`;
  if (AM_INSTRUMENT.test(command)) {
    const pkg = COMPONENT.exec(command)?.[1];
    return { tool: 'instrumentation', shell: pkg ? forceStop(pkg) : kill };
  }
  if (UIAUTOMATOR.test(command)) return { tool: 'uiautomator', shell: kill };
  const name = command.split(/\s/, 1)[0]!.replace(/:\w+$/, '');
  if (PACKAGE.test(name) && INSTRUMENTED.test(name))
    return { tool: 'instrumentation', shell: forceStop(name) };
  if (APP_PROCESS.test(command) || MAIN_CLASS.test(command))
    return { tool: 'app_process', shell: kill };
  return undefined;
}

/** The processes in `ps -A -o PID,ARGS` that may hold it, other than ours, one per way to stop them. */
export function holdersIn(ps: string): Holder[] {
  const seen = new Map<string, Holder>();
  for (const line of ps.split('\n')) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const command = m[2]!;
    if (/^(ps|grep)\b/.test(command) || command.includes(OUR_AGENT)) continue;
    // the shell that started a holder holds nothing; killing it would not free the device
    if (/^(\S*\/)?sh -c (?!.*\bam instrument\b)/.test(command)) continue;
    const found = holderOf(command, pid);
    if (found && !seen.has(found.shell)) seen.set(found.shell, { ...found, pid, command });
  }
  return [...seen.values()];
}

/** The holders in words: who, and the exact command that stops each. */
export function conflictHint(holders: Holder[], serial: string): string {
  if (holders.length === 0)
    return `it is none this tool knows: look with \`adb -s ${serial} shell ps -A -o PID,ARGS\`, stop it, then retry`;
  const named = holders.map(
    (h) =>
      `${h.tool} (pid ${h.pid}): \`${h.command}\`: stop it with \`adb -s ${serial} shell ${h.shell}\``,
  );
  return `${named.join('; ')}; then retry, or start this server with --takeover to have it stopped`;
}
