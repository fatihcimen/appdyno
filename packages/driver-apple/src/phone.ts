import { phoneCrashes } from './crashes.js';
import { phoneLogs } from './logs.js';
import { loadPhoneStream, PhoneMirror } from './mirror-phone.js';
import { PhoneApps, PhoneEvents, PhoneSettings } from './phone-manage.js';
import type { PhoneBuild } from './phone-apns.js';
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DeviceError, type Point, type Tree } from '@appdyno/protocol';
import {
  sleep,
  stateDir,
  swipePath,
  TIMEOUTS,
  type ScreenRecorder,
  type SystemSwipe,
  type TreeOptions,
  must,
} from '@appdyno/core';
import { type IosDeviceOps, IosDevice } from './device.js';
import { phoneRecorder } from './record.js';
import { type RunnerTransport, IosRunnerLauncher } from './runner.js';
import { BUILD_LINE, iosProducts } from './runner-build.js';
import { PHONE_CONTROLS } from './mirror-press.js';
import { PhoneInspector } from './phone-inspector.js';
import { PHONE_LINKS } from './settings-pages.js';
import { PhoneLive } from './phone-live.js';
import { signedRunner, type PhoneSigning, findPhoneSigning, phoneXctestrun } from './signing.js';
import { assertBundle } from './simctl.js';
import { IosPhonePerf } from './phone-perf.js';
import { connectPort, listDevices } from './usbmux.js';
import { pairedPhones } from './wifi-paired.js';
import { Devicectl } from './devicectl.js';

/** The runner built for phones (unsigned; signed for the profile at first use): built once when missing. */
export async function phoneRunnerApp(build = true): Promise<string> {
  const dir = await iosProducts('device', build);
  const app = dir && join(dir, 'Debug-iphoneos/Runner-Runner.app');
  if (!app || !existsSync(app))
    throw new DeviceError(
      'UNSUPPORTED',
      'the iPhone runner is not built',
      `build it: ${BUILD_LINE.device}`,
    );
  return app;
}

const TEXT_FIELDS = new Set(['TextField', 'SecureTextField', 'TextView', 'SearchField']);

/** What the phone's lock screen shows, in any language. */
const LOCK_SCREEN = 'lockscreen-date-view';
const UNLOCK = 'unlock it by hand: no tool can answer a passcode';
const LOCK_PRESSES = 3;
const LOCK_GOES_MS = 1_500;

const signedRunners = new Map<string, ReturnType<typeof signedRunner>>();

/** A phone: the runner signed for the profile, a port on the phone, reached over USB. */
export function phoneTransport(
  udid: string,
  given?: PhoneSigning,
): RunnerTransport & { signed(): ReturnType<typeof signedRunner> } {
  const cache = join(stateDir(), 'ios-phone');
  // the signed runner is looked up once per runner build and profile in this process (a reconnect
  // does not ask the keychain again)
  let signing = given;
  const signed = async () => {
    signing ??= await findPhoneSigning(udid);
    const current = signing;
    const app = await phoneRunnerApp();
    const key = [join(app, 'PlugIns/Runner.xctest/Runner'), current.profile]
      .map((f) => `${f}@${statSync(f).mtimeMs}`)
      .join(':');
    let result = signedRunners.get(key);
    if (!result) {
      result = signedRunner(app, current, cache);
      signedRunners.set(key, result);
      result.catch(() => signedRunners.delete(key));
    }
    return result;
  };
  return {
    signed,
    async build() {
      const r = await signed();
      const xctestrun = join(stateDir(), `ios-${udid}.xctestrun`);
      await mkdir(stateDir(), { recursive: true, mode: 0o700 });
      await writeFile(xctestrun, phoneXctestrun(r.app, r.appId), { mode: 0o600 });
      return { xctestrun, sha256: r.key };
    },
    port: () => Promise.resolve(20_000 + Math.floor(Math.random() * 20_000)),
    open: async (port) =>
      (await wifiOnly(udid))
        ? must(await loadPhoneStream(), 'the phone stream').portOnWifi(udid, port)
        : connectPort(udid, port),
    tunnels: () => pairedPhones().includes(udid),
  };
}

/** A phone paired for Wi-Fi with no cable, whose stream is in this build: the network is what reaches it. */
const wifiOnly = async (udid: string) => (await loadPhoneStream())?.onWifi(udid) ?? false;

export function phoneOps(udid: string, ctl: Devicectl): IosDeviceOps {
  return {
    up: async () =>
      (await listDevices()).some(
        (d) => d.connection === 'USB' && d.serial.replace(/-/g, '') === udid.replace(/-/g, ''),
      ) || wifiOnly(udid),
    launch: async (b) => {
      await ctl.launch(b);
    },
    terminate: (b) => ctl.terminate(b),
    openUrl: async (url, b) => {
      if (!b)
        throw new DeviceError(
          'UNSUPPORTED',
          'on an iPhone a link is opened in a named app',
          'select the app first',
        );
      await ctl.launch(b, url);
    },
    setLocation: (lat, lon) => ctl.setLocation(lat, lon),
    clearLocation: () => ctl.clearLocation(),
    linkPrompt: false,
    settingsLinks: PHONE_LINKS,
    openSettings: async (link) => {
      await ctl.launch('com.apple.Preferences', link);
    },
    logs: phoneLogs,
    crashes: (q) => phoneCrashes(ctl, q),
    name: `iPhone ${udid}`,
    pid: (b) => ctl.pid(b),
  };
}

/**
 * A real iPhone over USB: the runner signed for the development profile and installed when the phone
 * has another build under that id (another tool's runner, an older one); apps and links via devicectl.
 */
export class IosPhoneDevice extends IosDevice {
  readonly virtual = false;
  readonly mirror: PhoneMirror;
  private readonly transport: ReturnType<typeof phoneTransport>;
  readonly ctl: Devicectl;
  override async hardware() {
    const model = await this.ctl.marketingName().catch(() => undefined);
    return { ...(await super.hardware()), controls: PHONE_CONTROLS, ...(model && { model }) };
  }
  /** What Instruments and XCTest can read from a phone: what they cannot says why. */
  readonly measure: IosPhonePerf = new IosPhonePerf(this);

  constructor(serial: string, signing?: PhoneSigning) {
    const transport = phoneTransport(serial, signing);
    const ctl = new Devicectl(serial);
    super(serial, phoneOps(serial, ctl), new IosRunnerLauncher(serial, transport));
    this.transport = transport;
    this.ctl = ctl;
    this.mirror = new PhoneMirror(serial, undefined, undefined, undefined, undefined, {
      fieldAt: (x, y) => this.fieldAt(x, y),
      keys: (text, into) => this.keys(text, into),
    });
    const builds = new Map<string, PhoneBuild>();
    this.apps = new PhoneApps(ctl, builds, async (pkg, service) => {
      await this.call('permission.reset', { pkg, service }, TIMEOUTS.action);
    });
    this.settings = new PhoneSettings(ctl);
    this.events = new PhoneEvents(ctl, builds);
    this.inspector = new PhoneInspector(ctl);
    this.liveMetrics = new PhoneLive(serial);
    this.recorder = phoneRecorder(serial);
  }

  readonly recorder: ScreenRecorder;

  /**
   * That point of the text field under a share of the screen, false with none there; undefined when another app is in
   * front than the one chosen.
   */
  private async fieldAt(x: number, y: number) {
    const { windows, nodes } = await this.tree({ asItIs: true });
    const front = windows[0];
    if (!front || front.pkg !== this.targetApp) return undefined;
    const at = { x: x * front.b[2], y: y * front.b[3] };
    return nodes.some(
      ({ f, c, b }) =>
        f & 1 && TEXT_FIELDS.has(c) && at.x >= b[0] && at.x <= b[2] && at.y >= b[1] && at.y <= b[3],
    )
      ? at
      : false;
  }

  /** The first letters of a window start the runner, which it needs for nothing else. */
  private async keys(text: string, into?: Point) {
    await this.call('text.keys', { text, ...(into && { into }) }, TIMEOUTS.text);
  }

  /** By the phone's own service: the runner has the pasteboard only while it is in front. */
  override async setClipboard(text: string) {
    await this.ctl.writePasteboard(text);
  }

  override async getClipboard() {
    return (await this.ctl.readPasteboard()) || undefined;
  }

  /** By the phone's own service where it has it, which needs no runner but has one size; else as any device. */
  override async screenshot(opts: Parameters<IosDevice['screenshot']>[0] = {}) {
    const own = opts.maxPx ? undefined : await this.mirror.screenshot(opts.format ?? 'jpeg');
    return own ?? super.screenshot(opts);
  }
  readonly apps: PhoneApps;
  readonly settings: PhoneSettings;
  readonly events: PhoneEvents;

  override close() {
    this.events.close();
    super.close();
  }
  readonly inspector: PhoneInspector;
  readonly liveMetrics: PhoneLive;

  /**
   * A phone locks itself about a minute after the last touch, and a swipe or a tap on its lock screen goes to the system
   * (one opened Spotlight): with no passcode the home button gets past it, then the app comes back; with one, nothing
   * here can, and the read refuses by name before anything touches it.
   */
  override async tree({ asItIs, ...opts }: TreeOptions = {}) {
    const onLock = (t: Tree) => t.nodes.some((n) => n.id === LOCK_SCREEN);
    const read = await super.tree(opts);
    // Notification Center, opened here, has the lock screen's date
    if (asItIs || !onLock(read) || this.underView) return read;
    if ((await this.ctl.lockState()).passcodeRequired)
      throw new DeviceError(
        'DEVICE_LOCKED',
        `${this.serial} is locked behind its passcode`,
        UNLOCK,
      );
    // on a dark screen the first press only wakes it, with the lock screen still up; a launch does that as well
    for (let press = 0; press < LOCK_PRESSES; press++) {
      await this.key('home', { settle: false });
      if (this.targetApp) await this.launch(this.targetApp);
      await sleep(LOCK_GOES_MS);
      const after = await super.tree(opts);
      if (!onLock(after)) return after;
    }
    throw new DeviceError('DEVICE_LOCKED', `${this.serial} stays on its lock screen`, UNLOCK);
  }

  /** A phone takes a mirror's input only while a stream runs: by the runner. */
  protected async drag(way: SystemSwipe) {
    await this.act({
      kind: 'gesture',
      pointers: [swipePath(way, must(this.helloInfo, 'the hello').screen)],
    });
  }

  /** The app in front on a screen that is on: a launch brings a running app forward as it is and lights a dark screen. */
  async inFront(bundle: string) {
    await this.launch(assertBundle(bundle));
    await this.tree();
  }

  /** Our runner on the phone: installed when the phone has another build under the profile's id. */
  override async prepareStart() {
    await super.prepareStart();
    const r = await this.transport.signed();
    const onPhone = await this.ctl.app(r.appId);
    if (onPhone?.bundleVersion !== r.stamp) await this.ctl.install(r.app);
  }
}
