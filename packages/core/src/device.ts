import type { PhoneLook, PhoneSteps } from './usb.js';
import type {
  SettleInput,
  Read,
  Tree,
  Hello,
  ActParams,
  ActResult,
  Point,
  Modifier,
  TextResult,
  ParamsOf,
  ResultOf,
  AuditType,
  AuditResult,
  Platform,
} from '@appdyno/protocol';
import type { MeasureSource, TraceDigest } from './measure.js';
import type { LiveMetrics } from './mirror/live-metrics.js';
import type { PlatformScreen } from './screen/port.js';
import type { Need } from './mirror/need.js';
import type { SystemView } from './system-swipes.js';
import type { Mirror } from './mirror/port.js';
import type { VirtualDevices } from './virtual.js';
import type { AppManager } from './device-apps.js';
import type { ScreenInspector, ScreenRecorder } from './device-capture.js';
import type { DeviceEvents, DeviceSettings, SettingsPage } from './device-conditions.js';
import type { CrashesAnswer, CrashesQuery, LogsAnswer, LogsQuery } from './device-logs.js';
import type { NetworkSource, WebInspector } from './device-network.js';

/**
 * UIKit takes no touches during a push or a pop. The tree is final and the app's reports say all is still well
 * before it ends: a tap under 560 ms after the touch that went back was lost, 7 of 30, with the app reporting it.
 */
export const TRANSITION_MS = 650;

/** Whether a touch during a slide is lost, as UIKit drops it: Android's agent waits for rest before each action. */
export const SLIDE_DROPS_TOUCH: Record<Platform, boolean> = { android: false, ios: true };

/** The system's Settings, an app of its own, at whatever page it opens. */
export const SETTINGS_APP: Record<Platform, string> = {
  android: 'com.android.settings',
  ios: 'com.apple.Preferences',
};

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

/** `pidOf`: an app whose process the answer names, where the device's agent can tell it (`pid`). */
export type ActOptions = {
  settle?: SettleInput | false;
  read?: Read;
  before?: string;
  pidOf?: string;
};

export type TreeOptions = { maxDepth?: number; maxNodes?: number; asItIs?: boolean };

/** The OS by name, for a stored record too, which has no device to ask. */
const OS_NAMES: Record<Platform, string> = { android: 'Android', ios: 'iOS' };

/** The OS as people name it: Android 14, iOS 18.2. */
export const osName = (platform: Platform, version: string) => `${OS_NAMES[platform]} ${version}`;

/** What a device is, for how a window draws it: nothing here starts anything on it. */
export type DeviceHardware = {
  platform: Platform;
  /** What a window offers on this device, in the viewer's names. */
  controls: string[];
  /** A window lists the system's apps too: its own list may otherwise be empty. */
  systemApps?: boolean;
  /** What picks its frame: a maker's own word for it, such as a part number. */
  model?: string;
  /** What a person calls it, where that is not its model. */
  name?: string;
  color?: string;
};

/** One device, whichever platform: what the operations are written against. */
export type Device = {
  readonly platformScreen: PlatformScreen;
  readonly apps: AppManager;
  readonly settings: DeviceSettings;
  readonly events: DeviceEvents;
  readonly recorder: ScreenRecorder;
  readonly network?: NetworkSource;
  readonly web?: WebInspector;
  readonly inspector?: ScreenInspector;
  /** A live picture of the device: nothing of it starts until asked, and no agent needs to be up first. */
  readonly mirror: Mirror;
  /** Numbers a second, for a person watching: none where this kind of device has no source. */
  readonly liveMetrics?: LiveMetrics;
  hardware(): Promise<DeviceHardware>;
  /** One attempt to close an open keyboard; the caller reads whether it went. */
  dismissKeyboard(): Promise<void>;
  /**
   * Waits on the device until the screen differs from `since` (no `since`: answers at once with it);
   * undefined where the device cannot wait itself, as a simulator with no runner up: the caller polls.
   */
  waitChange(
    since: string | undefined,
    timeoutMs: number,
  ): Promise<{ sig: string; tree?: Tree } | undefined>;
  readonly serial: string;
  readonly platform: Platform;
  /** An emulator or simulator: numbers compare only with the same kind of device. */
  readonly virtual: boolean;
  readonly hello: Hello | undefined;
  /** Whether the last connect started a new agent. */
  lastStartWasCold: boolean;
  open(): Promise<Hello>;
  /**
   * What a first read and a first touch need, started in the background, and what a launch of `app` will ask: nothing
   * waits on it, nothing is refused by it.
   */
  warm?(app?: string): void;
  close(): void;
  /** `asItIs`: a look that leaves a dark or locked screen so, for what reads with no one asking it to. */
  tree(opts?: TreeOptions): Promise<Tree>;
  act(action: ActParams, opts?: ActOptions): Promise<ActResult>;
  tap(p: Point, opts?: ActOptions): Promise<ActResult>;
  longPress(p: Point, durationMs?: number, opts?: ActOptions): Promise<ActResult>;
  swipe(from: Point, to: Point, durationMs?: number, opts?: ActOptions): Promise<ActResult>;
  /** A key by its name, or a letter or digit, with what is held during it. */
  key(key: string, opts?: ActOptions, modifiers?: Modifier[]): Promise<ActResult>;
  /** The words of what the system shows over the app and no read of the app has: none where a read has them all. */
  systemWords?(): Promise<string[]>;
  /** The read of the system's own app that draws over the app (iOS's home screen app), with what it shows there. */
  systemTree?(): Promise<Tree | undefined>;
  /** One of the system's own views, over what is on the screen. */
  openView(view: SystemView): Promise<void>;
  /** The pages of Settings this device opens by name, and no other. */
  readonly settingsPages: readonly SettingsPage[];
  /** Settings at a page or at an app's own; `row`: no link goes there, and this row of the page it opened does. */
  openSettings(to: { page: SettingsPage } | { app: string }): Promise<{ row?: string }>;
  typeText(
    text: string,
    opts?: { at?: Point; replace?: boolean; submit?: boolean } & ActOptions,
  ): Promise<TextResult>;
  screenshot(
    opts?: ParamsOf<'screenshot'>,
  ): Promise<{ meta: ResultOf<'screenshot'>; data: Buffer }>;
  audit(opts?: { types?: AuditType[]; maxIssues?: number }): Promise<AuditResult>;
  foreground(): Promise<string | undefined>;
  /** What is in front among all of a person's apps, where `foreground` can tell only of the one it was given; it may take seconds. */
  frontApp?(): Promise<string | undefined>;
  setClipboard(text: string): Promise<void>;
  getClipboard(): Promise<string | undefined>;
  /** `kept`: the host wrote the rotation lock down, and puts it back itself. */
  setOrientation(rotation: 0 | 1 | 2 | 3, kept?: boolean): Promise<void>;
  openUrl(url: string, pkg?: string): Promise<void>;
  launch(pkg: string): Promise<void>;
  /** Before `open`, when a first call is to launch this app: `launch` then takes up what began here. */
  launchAlongside(pkg: string): void;
  terminate(pkg: string): Promise<void>;
  setLocation(lat: number, lon: number): Promise<void>;
  /** The device goes back to its real position. */
  clearLocation(): Promise<void>;
  /** Up now: a simulator starts its agent only for what needs it, and what is read goes another way once it is. */
  readonly agentUp: boolean;
  stopAgent(): Promise<void>;
  logs(q: LogsQuery): Promise<LogsAnswer>;
  crashes(q: CrashesQuery): Promise<CrashesAnswer>;
  /** Its wall clock now, in ms since the epoch, read once: `measureClock` makes an offset of it, for any kind of device. */
  wallClock(): Promise<number>;
  /** Whether the app has a live process. */
  appRunning(app: string): Promise<boolean>;
  /** Its process id, where reading it is cheap enough to do on every action. */
  appPid?(app: string): Promise<string | undefined>;
  /** Whether the system holds the app's process for a crash dialog it shows, alive until that is answered. */
  appCrashing?(app: string): Promise<boolean>;
  readonly measure: MeasureSource;
};

/** A doctor's finding. */
export type Check = { name: string; ok: boolean; warn?: boolean; detail: string; fix?: string };

export type ListedDevice = {
  serial: string;
  state: string;
  ready: boolean;
  model?: string;
  /** How a phone is joined to this Mac. */
  link?: 'USB' | 'Wi-Fi';
  /** The serial it has on a cable, where this way in names it: a person has one phone, whatever the ways to it. */
  sameAs?: string;
};

/** What a listed device is: Android names an emulator by its port, and only a simulator is listed booted. */
export const kindOf = (
  d: Pick<ListedDevice, 'serial' | 'state'>,
): 'phone' | 'simulator' | 'emulator' =>
  d.serial.startsWith('emulator-') ? 'emulator' : d.state === 'booted' ? 'simulator' : 'phone';

/** The devices of one driver. */
export type DeviceProvider = {
  /** `state` is the driver's own word; `ready` says whether the device can be driven now. */
  list(): Promise<ListedDevice[]>;
  handles(serial: string): boolean;
  /** What a person must do before a listed device can be driven, by reads that change nothing. */
  need?(device: { serial: string; state: string }): Promise<Need | undefined>;
  open(serial: string): Device;
  readonly virtual?: VirtualDevices;
  /** What this driver needs of this machine and, with `serial`, of that device. */
  doctor?(serial?: string): Promise<Check[]>;
  /** What a person does for a phone of this kind in their hand: undefined for a phone of another kind. */
  guide?(look: PhoneLook): PhoneSteps | undefined;
  /** A bounded table from a kept trace of this driver's kind: no device needed. */
  queryTrace?(
    tracePath: string,
    q: { sql?: string; table?: string; limit: number },
  ): Promise<TraceDigest | undefined>;
};
