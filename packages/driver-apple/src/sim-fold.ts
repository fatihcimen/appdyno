import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run, sleep } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { SIM_CANNOT } from './sim-events.js';
import { startSimHid } from './simhelper.js';
import { assertUdid, xcodeEnv, xcodeTool } from './simctl.js';

/** One built-in display of a simulator: its screen id, and its size in points and in pixels as its panel stands. */
export type SimDisplay = {
  id: number;
  active: boolean;
  main: boolean;
  w: number;
  h: number;
  px: string;
  scale: number;
};

type Listed = {
  displayId?: number;
  active?: boolean;
  primary?: boolean;
  nativeSize?: [number, number];
  pointScale?: number;
  type?: { integrated?: unknown };
};

/** The built-in displays in what `devicectl device info displays` answers: a foldable has two, one of them active. */
export function displaysOf(answer: unknown): SimDisplay[] {
  const listed = (answer as { result?: { displays?: Listed[] } } | undefined)?.result?.displays;
  return (listed ?? []).flatMap((d) => {
    const [w, h] = d.nativeSize ?? [];
    const scale = d.pointScale ?? 1;
    if (!d.type?.integrated || d.displayId === undefined || !w || !h) return [];
    return [
      {
        id: d.displayId,
        active: d.active === true,
        main: d.primary === true,
        w: Math.round(w / scale),
        h: Math.round(h / scale),
        px: `${String(w)}x${String(h)}`,
        scale,
      },
    ];
  });
}

/** A simulator's built-in displays, by devicectl (Xcode 27); none where it cannot say, as an older one's for a simulator. */
export async function simDisplays(udid: string): Promise<SimDisplay[]> {
  // devicectl looks 2 s for a device this Mac has not got
  if (!existsSync(join(homedir(), 'Library/Developer/CoreSimulator/Devices', assertUdid(udid))))
    return [];
  const env = xcodeEnv();
  const args = ['device', 'info', 'displays', '--device', udid];
  try {
    const { stdout } = await run(
      ...xcodeTool('devicectl', ['--json-output', '-', '--quiet', ...args], env),
      { timeout: 20_000, env },
    );
    return displaysOf(JSON.parse(stdout));
  } catch {
    return [];
  }
}

/** How long a devicectl that could not say is left alone: each ask is a process, and a touch waits for it. */
const QUIET_MS = 60_000;

/**
 * Which display a foldable simulator shows, told from what the read helper says with each look: the system's frame,
 * `screen`, the main display's size, `main`, and how the app in front lies. Open, the frame's short side is not the main
 * display's. The frame follows the display 0.6 to 0.8 s late, and the app lies on its side at once: an upright frame of
 * the main display under an app on its side is the moment between, and the display is asked of devicectl. A person or
 * another process may fold the device at any time, so nothing here goes by what this process set.
 */
export class ShownDisplay {
  /** The other display, while it is the one shown: touches go to it by its id. */
  inner: SimDisplay | undefined;
  /** A simulator found with one built-in display, which is never asked again. */
  private single = false;
  /** When devicectl, which had nothing to say, may be asked again: an older Xcode's says nothing of a simulator. */
  private askAfter = 0;

  constructor(
    private readonly udid: string,
    private readonly displays: (udid: string) => Promise<SimDisplay[]> = simDisplays,
  ) {}

  /** Whether the other display is shown, as this look has it; a look that says no sizes leaves it as it was. */
  async seen(screen: unknown, main: unknown, orientation?: unknown) {
    const [a, b] = Array.isArray(screen) ? (screen as number[]) : [];
    const [c, d] = Array.isArray(main) ? (main as number[]) : [];
    if (!a || !b || !c || !d) return !!this.inner;
    const other = Math.abs(Math.min(a, b) - Math.min(c, d)) >= 1;
    const between = !other && a < b && (orientation === 3 || orientation === 4);
    if (this.single || !(other || between)) this.inner = undefined;
    else if ((between || !this.inner) && Date.now() >= this.askAfter) {
      const all = await this.displays(this.udid);
      this.single = all.length === 1;
      if (all.length === 0) this.askAfter = Date.now() + QUIET_MS;
      this.inner = all.find((x) => x.active && !x.main);
    }
    return !!this.inner;
  }
}

/** The hinge's angle for each pose: half open is past where the inner display takes over, as a tabletop stands. */
const DEGREES: Partial<Record<string, number>> = { closed: 0, half: 90, open: 180 };
const POSES = Object.keys(DEGREES);
/** A display took over up to 2.5 s after its event: the hinge moves for 0.3 s, and the system waits for it to settle. */
const FOLLOWS_MS = 8_000;
const READ_AGAIN_MS = 300;
/** What an app in front tells of its frame follows the display by up to 0.8 s: a touch sent before goes where it was. */
const TOLD_MS = 1_000;
/** An event the simulator took and did not follow is sent once more: the first after a boot was lost twice. */
const AGAIN_AFTER_MS = 4_000;

/** The hinge set to an angle through the input helper, which stays until `done`: an event of a helper gone at once is lost. */
async function hingeBy(udid: string, degrees: number, done: () => Promise<unknown>) {
  const helper = await startSimHid(udid);
  try {
    const sent = await helper.call({ op: 'hinge', degrees }, 10_000);
    if (!sent.ok)
      throw new DeviceError(
        'UNSUPPORTED',
        `the simulator's input helper could not move the hinge: ${sent.error ?? sent.refused ?? 'no reason given'}`,
      );
    await done();
  } finally {
    helper.close();
  }
}

/**
 * A foldable simulator's pose (the iPhone Duo's, Xcode 27.1+): read by which built-in display is active, set by the hinge
 * event Device Hub's slider sends, which is private. The simulator keeps no request to reset, so the pose found is the
 * condition written down, and putting it back sets it again.
 */
export class SimulatorFold {
  /** Half open and open show the same display, and nothing outside the simulator tells its angle: the last one set here. */
  private half = false;

  constructor(
    private readonly udid: string,
    private readonly displays: () => Promise<SimDisplay[]> = () => simDisplays(udid),
    private readonly hinge: (degrees: number, done: () => Promise<unknown>) => Promise<void> = (
      degrees,
      done,
    ) => hingeBy(udid, degrees, done),
  ) {}

  /** A simulator found with one built-in display, which has no more the next time a window reads its fold row. */
  private single = false;

  /** The active display; refused for a simulator with one display, in the words every other simulator refuses with. */
  private async active() {
    const displays = this.single ? [] : await this.displays();
    const active = displays.find((d) => d.active);
    this.single ||= displays.length === 1;
    if (displays.length < 2 || !active) throw new DeviceError('UNSUPPORTED', SIM_CANNOT.fold);
    return active;
  }

  async poses() {
    await this.active();
    return POSES;
  }

  async get() {
    const { main } = await this.active();
    if (main) this.half = false;
    return main ? 'closed' : this.half ? 'half' : 'open';
  }

  /** What the answer adds: the display now shown, and what an app sees of the change. */
  async set(value: string): Promise<string> {
    const pose = value.toLowerCase().replace(/[-_ ]?opened$/, '');
    const degrees = DEGREES[pose];
    if (degrees === undefined)
      throw new DeviceError('INVALID_ARGUMENT', `fold: ${POSES.join(', ')}, not ${value}`);
    let now = await this.active();
    const followed = () => now.main === (pose === 'closed');
    const follow = async (withinMs: number) => {
      const end = Date.now() + withinMs;
      while (!followed() && Date.now() < end) {
        await sleep(READ_AGAIN_MS);
        now = await this.active();
      }
    };
    await this.hinge(degrees, () => follow(AGAIN_AFTER_MS));
    if (!followed()) await this.hinge(degrees, () => follow(FOLLOWS_MS - AGAIN_AFTER_MS));
    if (!followed())
      throw new DeviceError(
        'UNSUPPORTED',
        `asked for fold ${value} and the simulator stays ${now.main ? 'closed' : 'open'}: its hinge took the angle and its display did not follow`,
        'boot the simulator again: one made a moment ago stayed so until it was',
      );
    this.half = pose === 'half';
    await sleep(TOLD_MS);
    return `display ${now.px} at ${String(now.scale)}x; an app keeps its process, and its scene moves to this display`;
  }
}
