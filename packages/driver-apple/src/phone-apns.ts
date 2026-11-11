import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { run, type PushTokenKind } from '@appdyno/core';
import { tokensIn, type ApnsTarget } from './apns-push.js';
import { phoneFacts, type Devicectl } from './devicectl.js';
import { devicectlReady } from './first-launch.js';
import { infoValue } from './sim-links.js';
import { assertBundle, xcodeEnv } from './simctl.js';

/** What this tool read of a build it installed on an iPhone: no other app's signing can be read from here. */
export type PhoneBuild = { build?: 'development' | 'distribution'; voip: boolean };

/** How long a relaunched app has to print the token asked for. */
const TOKEN_WAIT_MS = 15_000;
/** The newest of a followed console's lines kept: an app under OS_ACTIVITY_DT_MODE says a great deal. */
const KEPT_LINES = 5_000;

/** A signature's `aps-environment`: production is a distribution build's, development a development build's. */
export const apsEnvironment = (entitlements: string) =>
  /<key>aps-environment<\/key>\s*<string>(\w+)<\/string>/.exec(entitlements)?.[1];

/** A build about to be installed: its bundle id, the environment its signature names, whether it declares VoIP. */
export async function readBuild(app: string): Promise<[bundle: string, PhoneBuild]> {
  const signed = await run('codesign', ['-d', '--entitlements', '-', '--xml', app]).then(
    (r) => r.stdout,
    () => '',
  );
  const aps = apsEnvironment(signed);
  const modes = await infoValue(app, 'UIBackgroundModes');
  return [
    String(await infoValue(app, 'CFBundleIdentifier', 'raw')),
    {
      ...(aps && { build: aps === 'production' ? 'distribution' : 'development' }),
      voip: Array.isArray(modes) && modes.includes('voip'),
    },
  ];
}

/** devicectl relaunching the app with its console followed, os_log and NSLog in it too, as under Xcode. */
async function followConsole(udid: string, app: string): Promise<ChildProcess> {
  await devicectlReady();
  return spawn(
    'xcrun',
    [
      'devicectl',
      'device',
      'process',
      'launch',
      '--console',
      '--terminate-existing',
      '--device',
      udid,
      '--environment-variables',
      JSON.stringify({ OS_ACTIVITY_DT_MODE: 'enable' }),
      assertBundle(app),
    ],
    { env: xcodeEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

/**
 * An iPhone, to APNs. This tool reads no running app's log there, so an app's tokens are what it prints once relaunched
 * with its console followed: only at a push that has none, and the answer says it was relaunched. Reading the phone's
 * own log through its developer services would spare the relaunch, and is not done yet.
 */
export class PhoneApnsTarget implements ApnsTarget {
  readonly name = 'iPhone';
  readonly production = true;
  /** Each app's console, from when it is asked for: one starting has no process yet. */
  private readonly followed = new Map<string, { child?: ChildProcess; lines: string[] }>();

  constructor(
    private readonly ctl: Devicectl,
    private readonly builds: Map<string, PhoneBuild>,
    private readonly follow = followConsole,
  ) {}

  async installed(app: string) {
    return (await this.ctl.app(app)) !== undefined;
  }

  build(app: string) {
    return Promise.resolve(this.builds.get(app)?.build);
  }

  declaresVoip(app: string) {
    return Promise.resolve(this.builds.get(app)?.voip);
  }

  async osMajor() {
    const j = await this.ctl.json(['device', 'info', 'details', '--device', this.ctl.udid]);
    const v = phoneFacts(j.result ?? {}).osVersion;
    return Number(v?.split('.')[0] ?? 0);
  }

  async lines(app: string, wanted: PushTokenKind) {
    const kept = this.followed.get(app);
    // one console an app: a call beside one starting or running takes what it has read
    if (kept && (kept.child?.exitCode ?? null) === null) return { lines: kept.lines };
    const lines: string[] = [];
    const entry: { child?: ChildProcess; lines: string[] } = { lines };
    this.followed.set(app, entry);
    let child: ChildProcess;
    try {
      child = await this.follow(this.ctl.udid, app);
    } catch (e) {
      this.followed.delete(app);
      throw e;
    }
    entry.child = child;
    // closed while it started: what it started goes with it
    if (this.followed.get(app) !== entry) child.kill('SIGKILL');
    await new Promise<void>((done) => {
      const timer = setTimeout(done, TOKEN_WAIT_MS);
      const take = (line: string) => {
        lines.push(line);
        if (lines.length > KEPT_LINES) lines.splice(0, lines.length - KEPT_LINES);
        if (tokensIn([line]).some((t) => t.kind === wanted)) {
          clearTimeout(timer);
          done();
        }
      };
      for (const out of [child.stdout, child.stderr])
        if (out) createInterface({ input: out }).on('line', take);
      child.on('exit', () => {
        clearTimeout(timer);
        done();
      });
    });
    return { lines, relaunched: true };
  }

  /** devicectl hands a signal it can catch on to the app: SIGKILL alone leaves the app running as it was. */
  close() {
    for (const { child } of this.followed.values()) child?.kill('SIGKILL');
    this.followed.clear();
  }
}
