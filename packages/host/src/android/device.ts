import {
  DeviceError,
  type ActParams,
  type ActResult,
  type AuditResult,
  type Hello,
  type Key,
  type Method,
  type ParamsOf,
  type Point,
  type Read,
  type ResultOf,
  type SettleInput,
  type TextResult,
  type Tree,
} from '@appdyno/protocol';
import { Adb, assertSerial, shq } from '../adb.js';
import { auditAndroid, decodePng } from '../audit.js';
import { DeviceQueue } from '../queue.js';
import type { RpcClient } from '../rpc.js';
import { afterTimeout } from '../stuck.js';
import { buildScreen, type Screen } from '../screen/index.js';
import { AndroidAgentLauncher, REMOTE_DIR } from './agent.js';
import { AndroidPerf } from './perf.js';

/** Per-command limits (ms); the settle cap is added to an action's. */
export const TIMEOUTS = {
  hello: 10_000,
  action: 15_000,
  text: 30_000,
  read: 15_000,
  screenshot: 30_000,
  app: 60_000,
  /** The iOS platform audit takes seconds on a busy screen: a stuck-runner restart must not cut it. */
  audit: 30_000,
} as const;

export type ActOptions = { settle?: SettleInput | false; read?: Read; before?: string };

/** Read-only requests are retried once on a fresh connection when the agent went away. */
const RETRY_SAFE: ReadonlySet<Method> = new Set<Method>([
  'tree.get',
  'a11y.read',
  'screenshot',
  'app.foreground',
  'clipboard.get',
]);

const PKG = /^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/;
const assertPkg = (p: string) => {
  if (!PKG.test(p)) throw new DeviceError('INVALID_ARGUMENT', `not a package name: ${p}`);
  return p;
};

/**
 * An Android device or emulator driven through its agent: every command has a timeout, commands never
 * overlap, failures are typed DeviceErrors. App lifecycle, links and location go through adb's own
 * protocol (no adb process per call).
 */
export class AndroidDevice {
  readonly platform = 'android' as const;
  private rpc: RpcClient | undefined;
  private connecting: Promise<RpcClient> | undefined;
  private helloInfo: Hello | undefined;
  private readonly queue = new DeviceQueue();
  private readonly launcher: AndroidAgentLauncher;
  /** Whether the last connect started a new agent (a cold start), for measurements. */
  lastStartWasCold = false;

  constructor(
    readonly serial: string,
    private readonly adb: Adb = new Adb(),
    /** How long a read-only call waits for an unplugged or rebooting device to come back (0: not at all). */
    private readonly reconnectWaitMs = 0,
  ) {
    assertSerial(serial);
    this.launcher = new AndroidAgentLauncher(adb, serial);
  }

  /** Connects (starting the agent when needed); the agent's hello. */
  async open(): Promise<Hello> {
    await this.queue.run(() => this.ensure());
    return this.helloInfo!;
  }

  get hello(): Hello | undefined {
    return this.helloInfo;
  }

  private ensure(): Promise<RpcClient> {
    if (this.rpc && !this.rpc.closed) return Promise.resolve(this.rpc);
    this.connecting ??= this.launcher
      .connect()
      .then(async ({ rpc, hello, started }) => {
        this.rpc = rpc;
        this.helloInfo = hello;
        this.lastStartWasCold = started;
        // a new agent: a host that died without stopping its own may have left test providers
        if (started) await this.clearStaleLocation().catch(() => undefined);
        return rpc;
      })
      .finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  private call<M extends Method>(method: M, params: ParamsOf<M>, timeoutMs: number) {
    return this.queue.run(async () => {
      let rpc: RpcClient | undefined;
      try {
        rpc = await this.ensure();
        return await rpc.call(method, params, { timeoutMs });
      } catch (e) {
        const lost = e instanceof DeviceError && (e.code === 'AGENT_UNAVAILABLE' || e.code === 'DEVICE_GONE');
        if (!lost) throw await afterTimeout(e, rpc, () => this.restartStuck(rpc!));
        if (!RETRY_SAFE.has(method)) throw e;
        this.rpc = undefined;
        // an unplugged cable or a reboot: the agent may still run on the device, its state file finds it
        if ((e as DeviceError).code === 'DEVICE_GONE') await this.waitForDevice(e);
        return (await this.ensure()).call(method, params, { timeoutMs });
      }
    });
  }

  /** An agent whose work lane stays stuck: stopped, so the next call starts a new one. */
  private async restartStuck(rpc: RpcClient) {
    if (this.rpc === rpc) this.rpc = undefined;
    rpc.close();
    await this.launcher.stop();
  }

  /** Waits until adb lists the device as usable again, at most reconnectWaitMs; else rethrows `cause`. */
  private async waitForDevice(cause: unknown) {
    const end = Date.now() + this.reconnectWaitMs;
    while (Date.now() < end) {
      const d = (await this.adb.devices().catch(() => [])).find((x) => x.serial === this.serial);
      if (d?.state === 'device') return;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw cause;
  }

  /**
   * A screen that went dark or locked comes back: wake it, dismiss a keyguard without a credential, and
   * swipe it up when dismissing did not work. Says what it did; a locked device with a PIN stays locked.
   */
  async ensureAwake(): Promise<{ woke: boolean; unlocked: boolean; locked: boolean }> {
    const state = async () => {
      const out = await this.shell(
        "dumpsys power | grep -m1 'mWakefulness='; dumpsys window | grep -m1 -E 'isKeyguardShowing=|mShowingLockscreen='",
      );
      return { awake: /mWakefulness=Awake/.test(out), locked: /isKeyguardShowing=true|mShowingLockscreen=true/.test(out) };
    };
    let s = await state();
    let woke = false;
    let unlocked = false;
    if (!s.awake) {
      await this.shell('input keyevent KEYCODE_WAKEUP');
      await new Promise((r) => setTimeout(r, 400));
      woke = true;
      s = await state();
    }
    if (s.locked) {
      await this.shell('wm dismiss-keyguard');
      await new Promise((r) => setTimeout(r, 600));
      s = await state();
      if (s.locked) {
        const w = this.helloInfo?.screen ?? { w: 1080, h: 2400 };
        await this.shell(`input swipe ${Math.round(w.w / 2)} ${Math.round(w.h * 0.9)} ${Math.round(w.w / 2)} ${Math.round(w.h * 0.3)} 250`);
        await new Promise((r) => setTimeout(r, 600));
        s = await state();
      }
      unlocked = !s.locked;
    }
    return { woke, unlocked, locked: s.locked };
  }

  async tree(opts: { maxDepth?: number; maxNodes?: number } = {}): Promise<Tree> {
    const read = async () => (await this.call('tree.get', opts, TIMEOUTS.read)).result;
    const t = await read().catch((e: unknown) => {
      if (e instanceof DeviceError && e.code === 'NOT_FOUND') return undefined;
      throw e;
    });
    // no app window at all: a dark or locked screen; once awake, read again
    if (t && t.windows.some((w) => w.type === 1)) return t;
    const s = await this.ensureAwake();
    if (!s.woke && !s.unlocked) {
      if (t) return t;
      throw new DeviceError('NOT_FOUND', 'no window to read', s.locked ? 'the device is locked' : undefined);
    }
    return read();
  }

  /** The current screen with stable refs. */
  async read(appId?: string): Promise<Screen> {
    return buildScreen(await this.tree(), { platform: 'android', ...(appId && { appId }) });
  }

  async act(action: ActParams, opts: ActOptions = {}): Promise<ActResult> {
    const settle = opts.settle === false ? undefined : (opts.settle ?? {});
    const cap = settle ? (settle.maxMs ?? 3_000) : 0;
    const { result } = await this.call(
      'act',
      { action, ...(settle && { settle }), read: opts.read ?? 'none', ...(opts.before && { before: opts.before }) },
      TIMEOUTS.action + cap + durationOf(action),
    );
    return result;
  }

  tap(p: Point, opts?: ActOptions) {
    return this.act({ kind: 'tap', x: p.x, y: p.y }, opts);
  }
  longPress(p: Point, durationMs = 800, opts?: ActOptions) {
    return this.act({ kind: 'longPress', x: p.x, y: p.y, durationMs }, opts);
  }
  swipe(from: Point, to: Point, durationMs = 300, opts?: ActOptions) {
    return this.act({ kind: 'swipe', from, to, durationMs }, opts);
  }
  key(key: Key, opts?: ActOptions) {
    return this.act({ kind: 'key', key }, opts);
  }

  /** Types into the focused field (or the field at `at`, tapped first); `replace` sets its whole text. */
  async typeText(
    text: string,
    opts: { at?: Point; replace?: boolean; submit?: boolean } & ActOptions = {},
  ): Promise<TextResult> {
    const settle = opts.settle === false ? undefined : (opts.settle ?? {});
    const { result } = await this.call(
      'text.set',
      {
        text,
        replace: opts.replace ?? false,
        submit: opts.submit ?? false,
        ...(opts.at && { at: opts.at }),
        ...(settle && { settle }),
        read: opts.read ?? 'none',
      },
      TIMEOUTS.text + (settle?.maxMs ?? 3_000),
    );
    return result;
  }

  async screenshot(
    opts: ParamsOf<'screenshot'> = {},
  ): Promise<{ meta: ResultOf<'screenshot'>; data: Buffer }> {
    const r = await this.call('screenshot', opts, TIMEOUTS.screenshot);
    if (!r.binary) throw new DeviceError('INTERNAL', 'the screenshot came without its image');
    return { meta: r.result, data: r.binary };
  }

  /**
   * The screen's accessibility issues (docs/protocol.md "Accessibility audit"): the host's checks of a
   * tree read, a PNG screenshot and the characters each text does not show.
   */
  async audit(opts: { maxIssues?: number } = {}): Promise<AuditResult> {
    const startedAt = Date.now();
    const hello = await this.open();
    const { tree, clips, traversal } = hello.capabilities.includes('a11y.read')
      ? (await this.call('a11y.read', {}, TIMEOUTS.read)).result
      : { tree: await this.tree(), clips: [], traversal: [] };
    const shot = await this.screenshot({ format: 'png' });
    const r = auditAndroid(tree, decodePng(shot.data), {
      scale: hello.screen.density / 160,
      clips,
      ...(opts.maxIssues && { maxIssues: opts.maxIssues }),
      startedAt,
    });
    return { ...r, read: { tree, traversal } };
  }

  async foreground(): Promise<string | undefined> {
    return (await this.call('app.foreground', {}, TIMEOUTS.read)).result.pkg;
  }

  async setClipboard(text: string) {
    await this.call('clipboard.set', { text }, TIMEOUTS.action);
  }
  async getClipboard(): Promise<string | undefined> {
    return (await this.call('clipboard.get', {}, TIMEOUTS.action)).result.text;
  }

  /** 0 portrait, 1 landscape (90°), 2 upside down, 3 landscape (270°); the rotation stays frozen. */
  async setOrientation(rotation: 0 | 1 | 2 | 3) {
    await this.call('orientation.set', { rotation }, TIMEOUTS.action);
  }

  /** Opens a link (`am start -W` with VIEW); `pkg` keeps it in that app. */
  async openUrl(url: string, pkg?: string) {
    const out = await this.shell(
      `am start -W -a android.intent.action.VIEW -d ${shq(url)}${pkg ? ` -p ${assertPkg(pkg)}` : ''} 2>&1`,
      TIMEOUTS.app,
    );
    if (/^Error|Exception|Status: (?!ok)/m.test(out)) throw new DeviceError('NOT_FOUND', `the link did not open: ${firstLine(out)}`);
  }

  /** Starts the app's launcher activity and waits for it (`am start -W`); returns its output. */
  async launch(pkg: string): Promise<string> {
    assertPkg(pkg);
    const resolved = (
      await this.shell(`cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${pkg} 2>&1`, TIMEOUTS.app)
    )
      .trim()
      .split('\n')
      .pop()!;
    if (!resolved.includes('/')) throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not installed or has no launcher activity`);
    const out = await this.shell(`am start -W -n ${shq(resolved)} 2>&1`, TIMEOUTS.app);
    if (/^Error|Status: (?!ok)/m.test(out)) throw new DeviceError('APP_NOT_RUNNING', `${pkg} did not start: ${firstLine(out)}`);
    return out;
  }

  async terminate(pkg: string) {
    await this.shell(`am force-stop ${assertPkg(pkg)}`, TIMEOUTS.app);
  }

  /**
   * A fixed position through test location providers (gps, network, fused: apps read fused as often as
   * gps; the shell user's mock-location right). A provider is ours only when our own add created it: a
   * provider that is already a test provider (the probe of its state succeeds) is used and never added
   * or listed, whatever a snapshot of the device's providers showed. Ours carry the tag TEST_TAG and are
   * listed on the device (TEST_LOCATION, with this host's process); clearLocation, stopAgent and the next
   * agent start once this process is gone remove them, each only after reading again that the provider
   * is still a test provider with our tag.
   */
  async setLocation(lat: number, lon: number) {
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new DeviceError('INVALID_ARGUMENT', 'latitude/longitude out of range');
    const at = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    const before = parseTestLocation(await this.shell(`cat ${TEST_LOCATION} 2>/dev/null`));
    const out = await this.shell(locationScript(at), TIMEOUTS.app);
    if (!out.trim().endsWith('done') || /Unknown command|No shell command/i.test(out))
      throw new DeviceError('UNSUPPORTED', `this device refused the test location: ${firstLine(out)}`);
    const run = parseLocationRun(out);
    // still ours: what this call created, and what an earlier call of this process created that is still there
    const kept = before.pid === process.pid ? before.providers.filter((e) => run.had.includes(e.split('/')[0]!)) : [];
    await this.shell(`mkdir -p ${REMOTE_DIR}; echo ${process.pid} ${[...kept, ...run.made].join(' ')} > ${TEST_LOCATION}`);
  }

  /** Removes the test location providers setLocation created, and only those still ours on a fresh read. */
  async clearLocation() {
    const marker = parseTestLocation(await this.shell(`cat ${TEST_LOCATION} 2>/dev/null`));
    const ours = removableProviders(marker.providers, await this.shell('dumpsys location', TIMEOUTS.app));
    await this.shell(
      [...ours.map((p) => `cmd location providers remove-test-provider ${p}`), `rm -f ${TEST_LOCATION}`].join('; '),
      TIMEOUTS.app,
    );
  }

  /** At a new agent's start: the test providers of a host process that is gone (it died before clearing). */
  private async clearStaleLocation() {
    const marker = parseTestLocation(
      await this.adb.exec(this.serial, `cat ${TEST_LOCATION} 2>/dev/null`, { timeoutMs: TIMEOUTS.action }),
    );
    if (marker.pid === undefined || processAlive(marker.pid)) return;
    const ours = removableProviders(
      marker.providers,
      await this.adb.exec(this.serial, 'dumpsys location', { timeoutMs: TIMEOUTS.app }),
    );
    await this.adb.exec(
      this.serial,
      [...ours.map((p) => `cmd location providers remove-test-provider ${p}`), `rm -f ${TEST_LOCATION}`].join('; '),
      { timeoutMs: TIMEOUTS.app },
    );
  }

  /** A shell command on the device (adb protocol, no adb process); output with stderr when redirected. */
  async shell(command: string, timeoutMs: number = TIMEOUTS.action): Promise<string> {
    return this.queue.run(() => this.adb.exec(this.serial, command, { timeoutMs }));
  }

  /**
   * As `shell`, but not queued behind the device's other commands: a recording that runs while the
   * caller acts on the device (its own adb connection).
   */
  async shellAlongside(command: string, timeoutMs: number = TIMEOUTS.action): Promise<string> {
    return this.adb.exec(this.serial, command, { timeoutMs });
  }

  /** As `shell`, the output as bytes. */
  async shellBuffer(command: string, timeoutMs: number = TIMEOUTS.action): Promise<Buffer> {
    return this.queue.run(() => this.adb.execBuffer(this.serial, command, { timeoutMs }));
  }

  /** Copies a file from the device (adb's file transfer). */
  async pull(remote: string, local: string): Promise<void> {
    await this.queue.run(() => this.adb.run(['-s', this.serial, 'pull', remote, local], 300_000));
  }

  /** The app's and the device's performance (frames, memory, CPU, launch, device state). */
  get perf(): AndroidPerf {
    return (this.perfTools ??= new AndroidPerf(this));
  }
  private perfTools: AndroidPerf | undefined;

  /** Closes the connection; the agent keeps running for the next host. */
  close() {
    this.rpc?.close();
    this.rpc = undefined;
  }

  /** Stops the agent on the device (the UI automation connection is released); its test providers go. */
  async stopAgent() {
    this.close();
    await this.clearLocation().catch(() => undefined);
    await this.launcher.stop();
  }
}

const firstLine = (s: string) => s.trim().split('\n')[0]?.slice(0, 200) ?? '';

const TEST_PROVIDERS = ['gps', 'network', 'fused'];
/** The attribution tag of our test providers (dumpsys location shows it in the provider's block). */
export const TEST_TAG = 'appdyno';

/**
 * The device side of setLocation: per provider, a probe of its test state (it fails unless the provider is
 * already a test provider: then it is used, `had`), else our add with our tag (`made`; `/plain` where this
 * release takes no tag), then the position.
 */
export function locationScript(at: string): string {
  const add = (p: string) =>
    `if cmd location providers add-test-provider ${p} --extraAttributionTags ${TEST_TAG} >/dev/null 2>&1; then echo "made ${p}"; ` +
    `elif cmd location providers add-test-provider ${p} >/dev/null 2>&1; then echo "made ${p}/plain"; fi`;
  return [
    'appops set com.android.shell android:mock_location allow',
    'cmd location set-location-enabled true',
    ...TEST_PROVIDERS.map(
      (p) =>
        `if cmd location providers set-test-provider-enabled ${p} true >/dev/null 2>&1; then echo "had ${p}"; else ${add(p)}; ` +
        `cmd location providers set-test-provider-enabled ${p} true; fi; ` +
        `cmd location providers set-test-provider-location ${p} --location ${at}`,
    ),
    'echo done',
  ].join('; ');
}

/** What locationScript said: the providers that were test providers already, and the ones it created. */
export function parseLocationRun(out: string): { had: string[]; made: string[] } {
  const had: string[] = [];
  const made: string[] = [];
  for (const m of out.matchAll(/^(had|made) (\w+(?:\/plain)?)\s*$/gm)) {
    const [, kind, entry] = m;
    if (!TEST_PROVIDERS.includes(entry!.split('/')[0]!)) continue;
    (kind === 'had' ? had : made).push(entry!);
  }
  return { had, made };
}

/** Each test provider's block in `dumpsys location` (`    gps provider [mock]:` and its indented lines). */
function mockBlocks(dumpsys: string): Map<string, string> {
  const blocks = new Map<string, string>();
  let current: string | undefined;
  for (const line of dumpsys.split(/\r?\n/)) {
    const head = /^(\s*)(\w+) provider( \[mock\])?:\s*$/.exec(line);
    if (head) {
      current = head[3] ? head[2] : undefined;
      if (current) blocks.set(current, '');
      continue;
    }
    if (current && /^\s{5,}\S/.test(line)) blocks.set(current, blocks.get(current)! + line + '\n');
    else if (current && line.trim()) current = undefined;
  }
  return blocks;
}

/**
 * Of the listed providers (`gps`, or `gps/plain` where no tag was taken), the ones that may be removed now:
 * still a test provider, and carrying our tag when it was created with one (a provider replaced since
 * by someone else's is not ours any more).
 */
export function removableProviders(listed: string[], dumpsys: string): string[] {
  const blocks = mockBlocks(dumpsys);
  const tagged = new RegExp(`extra attribution tags=\\{[^}]*\\b${TEST_TAG}\\b`);
  return listed.flatMap((entry) => {
    const [p, kind] = entry.split('/');
    const block = blocks.get(p!);
    if (block === undefined) return [];
    return kind === 'plain' || tagged.test(block) ? [p!] : [];
  });
}
/** The test location providers this library added: `<host pid> <provider>…`. */
export const TEST_LOCATION = `${REMOTE_DIR}/test-location`;

/** Providers `dumpsys location` shows with a mock (`  gps provider [mock]:`). */
export function mockedProviders(dumpsys: string): Set<string> {
  return new Set([...dumpsys.matchAll(/^\s*(\w+) provider \[mock\]/gm)].map((m) => m[1]!));
}

/** The host process and the providers of a TEST_LOCATION file; nothing when it is missing or not ours. */
export function parseTestLocation(text: string): { pid?: number; providers: string[] } {
  const [pid, ...rest] = text.trim().split(/\s+/);
  if (!pid || !/^\d+$/.test(pid)) return { providers: [] };
  return {
    pid: Number(pid),
    providers: rest.filter((e) => /^\w+(\/plain)?$/.test(e) && TEST_PROVIDERS.includes(e.split('/')[0]!)),
  };
}

/** Whether a process of this Mac still runs (a host that set the location and has not gone). */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it runs, as another user
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function durationOf(a: ActParams): number {
  if (a.kind === 'longPress' || a.kind === 'swipe') return a.durationMs;
  if (a.kind === 'gesture') return Math.max(...a.pointers.map((p) => p[p.length - 1]!.t));
  return 0;
}
