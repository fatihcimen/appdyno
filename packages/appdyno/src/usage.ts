import { TOOLSET_NAMES } from '@appdyno/ops';
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
      'allow-data-loss': value('virtual|all'),
      'allow-power': value('virtual|all'),
      'allow-write': values('dir'),
      'allow-build': on,
      toolsets: value(TOOLSET_NAMES.join(',')),
      'no-home': on,
      silent: on,
      takeover: on,
      share: on,
      animations: value('on|off'),
      measurements: value('dir'),
      'trace-limit-gb': value('N'),
      'flight-seconds': value('N'),
      'full-urls': on,
      'no-install-consent': on,
      'accept-install-warnings': on,
      'no-fetch': on,
      http: value('127.0.0.1:PORT'),
      'end-with-parent': unsaidOn,
      'put-back-after': unsaidValue,
    },
    what: "the MCP server over stdio; with --http, on this Mac's loopback behind a token; --toolsets lists only those groups of tools, all of them when it is left out",
  },
  install: {
    flags: { yes: { type: 'boolean', short: 'y' }, 'dry-run': on, remove: on, moved: unsaidOn },
    what: 'add this server to the MCP clients on this Mac, or take it out',
  },
  update: {
    flags: { check: on },
    what: 'move to the latest release, verified before anything changes; --check changes nothing',
  },
  path: {
    flags: { remove: on },
    what: 'from the app: put this appdyno on the PATH of every shell, or take it off',
  },
  devices: { flags: { json: unsaidOn }, what: 'the connected devices' },
  version: { what: 'which version this is' },
  test: {
    takes: '<dir or files>',
    flags: {
      device: values('S'),
      param: values('NAME=value'),
      'env-file': value('F'),
      tag: values('T'),
      'exclude-tag': values('T'),
      shard: value('i/n'),
      artifacts: value('dir'),
      junit: value('file'),
      'pr-body': value('file'),
      'no-report': on,
      share: on,
      retries: value('N'),
      'fail-on-flaky': { type: 'boolean', under: 'retries' },
      'update-baselines': on,
      measure: on,
      iterations: under('measure', 'N'),
      measurements: under('measure', 'dir'),
    },
    what: 'replay flows, one after another, on each device, and leave one verdict, one page, JUnit and a pull request text in the artifacts folder (--no-report: the record and JUnit alone); --shard 2/4 runs the second of four parts of the files, the same parts on every machine; --retries runs a failed file again and calls it flaky, which --fail-on-flaky fails the run for (exit 1); --update-baselines saves what visual steps compare with; --measure keeps each as a scenario, by step',
  },
  'test merge': {
    takes: '<dir>...',
    flags: {
      out: needed('dir'),
      'allow-mixed': on,
      junit: value('file'),
      'pr-body': value('file'),
    },
    what: "several runs' folders, as shards leave them, into one record, verdict, page, JUnit and pull request text; exit 1 when any part failed or a shard is missing, 2 when they cannot be one run",
  },
  'test share': {
    takes: '<dir>',
    flags: { zip: value('file'), with: value('video'), without: value('video,logs,trees') },
    what: "what a run's folder holds, to read before it is sent to anyone; --zip packs it, with the kinds --without names left out, and asks which when it holds a video",
  },
  'test comment': {
    takes: '<dir>',
    flags: { out: value('file') },
    what: "the pull request text again, from a run's record; no device",
  },
  doctor: { flags: { serial: value('S') }, what: 'what this machine and that device lack' },
  'ios build': {
    flags: { 'no-fetch': on },
    what: "fetch or build the iOS runners now; --no-fetch builds the simulator's here and asks the network for nothing",
  },
  'push setup': {
    takes: 'apns|fcm',
    flags: { forget: on },
    what: "a push service's credentials, which a person gives here and send_push uses; --forget deletes them",
  },
  'tools install': {
    takes: '[adb]',
    flags: { 'accept-license': on },
    what: "download the trace tools; adb: Google's platform-tools, under Google's terms",
  },
  bench: {
    flags: {
      serial: needed('S'),
      n: value('50'),
      out: value('file'),
      'max-load': value('N'),
    },
    what: 'time reads, taps and typing on an Android device',
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
      wifi: on,
      'no-input': on,
      headless: on,
      behind: unsaidOn,
      pair: on,
      seconds: value('N'),
      takeover: on,
      record: value('file.mp4'),
      focus: on,
      'input-on-click': unsaidOn,
      'allow-devices': value('RE'),
    },
    what: 'a live window on a device, driven by mouse and keyboard',
  },
  'mirror close|status|stats': {},
  pair: {
    takes: '[address code]',
    flags: { device: value('S'), forget: on, help: { type: 'boolean', short: 'h', unsaid: true } },
    what: 'this Mac with a phone for Wi-Fi, once: an iPhone on its cable by --device, an Android phone by what it shows',
  },
  hub: {
    flags: {
      focus: on,
      behind: unsaidOn,
      appearance: unsaidValue,
      'allow-devices': value('RE'),
    },
    what: 'every device of this Mac in one window: start, stop, make one, open its window',
  },
  'perf compare|baseline|budget': {
    flags: {
      app: value('A'),
      scenario: value('S'),
      'device-class': value('C'),
      last: value('N'),
      replace: on,
      kind: value('K'),
      max: value('N'),
      min: value('N'),
      format: value('text|json|junit'),
      measurements: value('dir'),
    },
    what: 'the performance gate: non-zero on a regression, a broken budget or a change it could not decide; budget takes --kind with --max or --min',
  },
  'perf why|reference': {
    flags: {
      app: value('A'),
      scenario: value('S'),
      'device-class': value('C'),
      device: value('S'),
      dsym: value('path'),
      format: value('text|json|junit'),
      measurements: value('dir'),
      share: on,
    },
    what: "the gate, and on a regression its cause, found on the device; reference: what that diffs against, on the baseline's build",
  },
  'perf comment': {
    flags: {
      out: needed('file'),
      app: value('A'),
      scenario: value('S'),
      'device-class': value('C'),
      measurements: value('dir'),
    },
    what: "the gate's newest answers as Markdown in a file, for your own CI to post; no device",
  },
  'perf functions': {
    flags: { from: needed('pm-a'), to: needed('pm-b'), measurements: value('dir') },
    what: 'which functions moved between two kept profiles',
  },
  'perf prune': {
    flags: { 'limit-gb': value('N'), 'dry-run': on },
    what: 'kept traces and heap dumps down to the limit, 10 GB by default',
  },
  timeline: {
    flags: {
      app: needed('A'),
      device: value('S'),
      flow: value('file'),
      seconds: value('N'),
      dir: value('dir'),
      'full-urls': on,
    },
    what: 'video, touches, frames, requests, log and memory on one clock, in one file: for a flow, or for N seconds of your hands',
  },
  flight: {
    flags: {
      app: needed('A'),
      device: value('S'),
      seconds: value('N'),
      dir: value('dir'),
      'full-urls': on,
    },
    what: 'keeps the last N seconds of an app as a timeline, saved on a crash or a stall, until Ctrl-C',
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
  `--${name}${flag.type === 'string' ? ` ${String(flag.says)}` : ''}`;

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

/** What `--help` answers for a command of these tables; undefined for an operation, which words its own. */
export function helpFor(command: string | undefined, words: string[]) {
  if (!command || !(words.includes('--help') || words.includes('-h'))) return undefined;
  const starting = (prefix: string) =>
    (Object.keys(COMMANDS) as Name[]).filter((n) => n === prefix || n.startsWith(`${prefix} `));
  const sub = words[0]?.startsWith('-') ? undefined : words[0];
  const exact = sub ? starting(`${command} ${sub}`) : [];
  // `perf compare` goes on to its operation
  const toOp = sub && command === 'perf';
  const names = exact.length > 0 || toOp ? exact : starting(command);
  if (names.length === 0) return undefined;
  return names
    .map((n, i) => {
      const { what }: Command = COMMANDS[n];
      return `${i ? '      ' : 'usage:'} appdyno ${line(n)}${what ? `\n       ${what}` : ''}`;
    })
    .join('\n');
}

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
