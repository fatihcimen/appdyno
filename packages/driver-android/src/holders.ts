/** Who holds Android's one UI automation connection, as the device's `ps` shows it. */
export type Holder = {
  tool: string;
  pid: number;
  command: string;
  /** Run in the device's shell to stop it. */
  shell: string;
};

const pkgStop = (pkg: string) => `am force-stop ${pkg}`;

const KNOWN: { tool: string; match: RegExp; stop: (m: RegExpExecArray, pid: number) => string }[] =
  [
    {
      tool: 'another-server',
      match: /com\.another-vendor\.another-helper\.DeviceServer/,
      stop: (_, pid) => `kill ${pid}`,
    },
    {
      tool: 'another-tool',
      match: /com\.another-vendor\.another-tool[\w.]*/,
      stop: (m) => pkgStop(m[0].replace(/\.test$/, '')),
    },
    {
      tool: 'another-tool',
      match: /\bam instrument\b.*another-tool/,
      stop: (_, pid) => `kill ${pid}`,
    },
    {
      tool: 'Appium',
      match: /io\.appium\.uiautomator2[\w.]*/,
      stop: () => pkgStop('io.appium.uiautomator2.server'),
    },
    {
      tool: 'uiautomator',
      match: /(?:^|[\s/])uiautomator(?:\s|$)|com\.android\.commands\.uiautomator/,
      stop: (_, pid) => `kill ${pid}`,
    },
  ];

/** The known holders in `ps -A -o PID,ARGS`, one per way to stop them. */
export function holdersIn(ps: string): Holder[] {
  const seen = new Map<string, Holder>();
  for (const line of ps.split('\n')) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const command = m[2]!;
    if (/^(ps|grep)\b/.test(command) || command.includes('dev.appdyno.agent.Main')) continue;
    // the shell that started a holder holds nothing; killing it would not free the device
    if (/^(\S*\/)?sh -c (?!.*\bam instrument\b)/.test(command)) continue;
    for (const k of KNOWN) {
      const hit = k.match.exec(command);
      if (!hit) continue;
      const shell = k.stop(hit, pid);
      if (!seen.has(shell)) seen.set(shell, { tool: k.tool, pid, command, shell });
      break;
    }
  }
  return [...seen.values()];
}

/** The holders in words: who, and the exact command that stops each. */
export function conflictHint(holders: Holder[], serial: string): string {
  if (holders.length === 0)
    return `another UI automation client holds this device and is none this tool knows: look with \`adb -s ${serial} shell ps -A -o PID,ARGS\`, stop it, then retry`;
  const named = holders.map(
    (h) => `${h.tool} (pid ${h.pid}): stop it with \`adb -s ${serial} shell ${h.shell}\``,
  );
  return `${named.join('; ')}; then retry, or start this server with --takeover to have it stopped`;
}
