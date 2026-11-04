import type { ParseArgsConfig } from 'node:util';

/** A flag as `parseArgs` takes it, with what usage says of it: a new flag is written here, once. */
type Flag = NonNullable<ParseArgsConfig['options']>[string] & {
  /** The word for its value. */
  says?: string;
  /** The command means nothing without it: no brackets. */
  needed?: boolean;
  /** Means something only beside this flag: said inside its brackets. */
  under?: string;
  /** Between this tool's own processes, not for people. */
  unsaid?: boolean;
};

type Flags = Record<string, Flag>;

/** A command: what it takes beside its flags, its flags, and what it is for. */
type Command = { takes?: string; flags?: Flags; what?: string };

const value = (says: string) => ({ type: 'string', says }) as const;
const values = (says: string) => ({ type: 'string', says, multiple: true }) as const;
const needed = (says: string) => ({ type: 'string', says, needed: true }) as const;
const under = (flag: string, says: string) => ({ type: 'string', says, under: flag }) as const;
const on = { type: 'boolean' } as const;
const unsaidValue = { type: 'string', unsaid: true } as const;
const unsaidOn = { type: 'boolean', unsaid: true } as const;

/** In the order help lists them. */
export const COMMANDS = {
  mcp: {
    flags: {
      device: value('S'),
      app: value('A'),
      'allow-devices': value('RE'),
      'allow-apps': value('a,b'),
      'allow-urls': value('RE'),
      'no-home': on,
      takeover: on,
      share: on,
      animations: value('on|off'),
      measurements: value('dir'),
      'trace-limit-gb': value('N'),
      'no-install-consent': on,
      'accept-install-warnings': on,
      http: value('127.0.0.1:PORT'),
    },
    what: "the MCP server over stdio; with --http, on this Mac's loopback behind a token",
  },
  install: {
    flags: { yes: { type: 'boolean', short: 'y' }, 'dry-run': on, remove: on },
    what: 'add this server to the MCP clients on this Mac, or take it out',
  },
  update: {
    flags: { check: on, help: { type: 'boolean', short: 'h', unsaid: true } },
    what: 'move to the latest release, verified before anything changes; --check changes nothing',
  },
  devices: { what: 'the connected devices' },
  test: {
    takes: '<dir or files>',
    flags: {
      device: values('S'),
      param: values('NAME=value'),
      'env-file': value('F'),
      tag: values('T'),
      'exclude-tag': values('T'),
      artifacts: value('dir'),
      junit: value('file'),
      share: on,
      retries: value('N'),
      measure: on,
      iterations: under('measure', 'N'),
      measurements: under('measure', 'dir'),
    },
    what: 'replay flows, one after another, on each device; --retries runs a failed file again and calls it flaky; --measure keeps each as a scenario, by step',
  },
  doctor: { flags: { serial: value('S') }, what: 'what this machine and that device lack' },
  'ios build': { what: 'build the iOS runners now' },
  'tools install': { what: 'download the trace tools' },
  bench: {
    flags: {
      serial: needed('S'),
      driver: values('appdyno|<module>'),
      n: value('50'),
      out: value('file'),
      'max-load': value('N'),
    },
  },
  mirror: {
    takes: '[open]',
    flags: {
      device: values('S'),
      all: on,
      watch: { type: 'boolean', under: 'all' },
      max: value('N'),
      detach: on,
      quality: value('auto|high|standard'),
      codec: value('h264|hevc'),
      'no-input': on,
      headless: on,
      seconds: value('N'),
      takeover: on,
      record: value('file.mp4'),
      focus: on,
      'input-on-click': unsaidOn,
      'allow-devices': unsaidValue,
      help: { type: 'boolean', short: 'h', unsaid: true },
    },
    what: 'a live window on a device, driven by mouse and keyboard',
  },
  'mirror close|status|stats': {},
  'perf compare|baseline|budget': {
    flags: {
      app: value('A'),
      scenario: value('S'),
      'device-class': value('C'),
      last: value('N'),
      replace: on,
      format: value('text|json|junit'),
      measurements: value('dir'),
    },
    what: 'the performance gate: non-zero on a regression or a broken budget',
  },
  'perf functions': {
    flags: { from: needed('pm-a'), to: needed('pm-b'), measurements: value('dir') },
    what: 'which functions moved between two kept profiles',
  },
  'perf prune': {
    flags: { 'limit-gb': value('N'), 'dry-run': on, measurements: value('dir') },
    what: 'kept traces and heap dumps down to the limit, 10 GB by default',
  },
  'perf dashboard': {
    flags: { app: value('A'), out: value('dir'), open: on, measurements: value('dir') },
    what: 'one page: what can be read on each device, what changed, what needs attention',
  },
  'perf survey': {
    flags: {
      app: needed('A'),
      device: value('S'),
      measurements: value('dir'),
      share: on,
    },
    what: 'every measure on that device in turn, then the page',
  },
} as const satisfies Record<string, Command>;

type Name = keyof typeof COMMANDS;

const spelled = (name: string, flag: Flag) =>
  `--${name}${flag.type === 'string' ? ` ${flag.says}` : ''}`;

/** A command with its flags, as people type it. */
export function line(name: Name) {
  const { takes, flags = {} }: Command = COMMANDS[name];
  const all = Object.entries(flags).filter(([, f]) => !f.unsaid);
  const said = all
    .filter(([, f]) => !f.under)
    .map(([flag, f]) => {
      const inner = all.filter(([, x]) => x.under === flag).map(([n, x]) => `[${spelled(n, x)}]`);
      const whole = [spelled(flag, f), ...inner].join(' ');
      return f.needed ? whole : `[${whole}]${f.multiple ? '...' : ''}`;
    });
  return [name, ...(takes ? [takes] : []), ...said].join(' ');
}

/** The lines of what `prefix` starts, as an answer to words that make no call. */
export const usage = (prefix: string) =>
  (Object.keys(COMMANDS) as Name[])
    .filter((n) => n.startsWith(prefix))
    .map((n, i) => `${i ? '      ' : 'usage:'} appdyno ${line(n)}`)
    .join('\n');

const NAME_WIDTH = 17;

/** Every command, with what it is for. */
export const commandList = () =>
  (Object.keys(COMMANDS) as Name[])
    .map((n) => {
      const said = line(n);
      const { what }: Command = COMMANDS[n];
      if (!what) return `  ${said}`;
      return said.length < NAME_WIDTH
        ? `  ${said.padEnd(NAME_WIDTH)}${what}`
        : `  ${said}\n  ${''.padEnd(NAME_WIDTH)}${what}`;
    })
    .join('\n');
