import {
  buildScreen,
  DeviceError,
  type AndroidDevice,
  type IosSimulatorPerf,
  type Screen,
  type ScreenElement,
  type Tree,
} from 'appdyno';
import { ToolError } from './tool.js';

/** What the tools need of a device: an Android device or an iOS simulator (no perf tools there yet). */
export type DriveableDevice = Pick<
  AndroidDevice,
  | 'serial'
  | 'hello'
  | 'lastStartWasCold'
  | 'open'
  | 'tree'
  | 'act'
  | 'tap'
  | 'longPress'
  | 'swipe'
  | 'key'
  | 'typeText'
  | 'screenshot'
  | 'foreground'
  | 'setClipboard'
  | 'setOrientation'
  | 'openUrl'
  | 'launch'
  | 'terminate'
  | 'setLocation'
  | 'close'
> & {
  readonly platform: 'android' | 'ios';
  readonly perf?: AndroidDevice['perf'];
  /** iOS simulator: measured from the Mac. */
  readonly iosPerf?: IosSimulatorPerf;
};

/**
 * One device the server drives and what its agent was shown: the screen the diffs are against, the
 * newest read (refs resolve on it while no action came after it) and a count of actions.
 */
export class Session {
  /** The screen the agent was shown last: diffs are against it. */
  shown: ScreenElement[] | undefined;
  /** Device actions so far. */
  version = 0;
  private latest: { screen: Screen; at: number } | undefined;
  /** The version and layout of the last screenshot sent. */
  shot: { at: number; hash: string } | undefined;

  constructor(
    readonly device: DriveableDevice,
    public appId: string | undefined,
  ) {}

  screenOf(tree: Tree): Screen {
    return buildScreen(tree, {
      platform: this.device.platform,
      ...(this.appId && { appId: this.appId }),
    });
  }

  /** A fresh read of the device, remembered as the newest. */
  async read(): Promise<Screen> {
    const screen = this.screenOf(await this.device.tree().catch(refused));
    this.remember(screen);
    return screen;
  }

  remember(screen: Screen) {
    this.latest = { screen, at: this.version };
  }

  /** The newest read when no action came after it, else a fresh one. */
  async current(): Promise<Screen> {
    if (this.latest && this.latest.at === this.version) return this.latest.screen;
    return this.read();
  }

  /** The newest read when it is still the device's screen (no action since), else undefined. */
  get fresh(): Screen | undefined {
    return this.latest && this.latest.at === this.version ? this.latest.screen : undefined;
  }

  /** A device action happened: refs read before it are resolved on a new read. */
  acted() {
    this.version++;
  }
}

/** A device failure as the agent's error: what failed and what to do. */
export function refused(err: unknown): never {
  if (err instanceof ToolError) throw err;
  if (err instanceof DeviceError) {
    const hint =
      err.code === 'TIMEOUT'
        ? 'cihaz yanıt vermedi; ekranı oku ve tekrar dene'
        : err.code === 'DEVICE_GONE' || err.code === 'AGENT_UNAVAILABLE'
          ? 'cihaz bağlı değil ya da ajan durdu; bir kez tekrar dene'
          : err.code === 'NO_FOCUS'
            ? 'odakta yazılabilir alan yok: önce alana dokun (ya da type_text ile ref ver)'
            : (err.hint ?? 'cihaz komutu reddetti');
    throw new ToolError(`${err.message} (${err.code}): ${hint}`);
  }
  throw err;
}
