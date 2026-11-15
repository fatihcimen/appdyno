import { endInBackground, sleep, type Backgrounds } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg, shq } from './adb.js';

/** The levels `am send-trim-memory` takes, by their numbers in ComponentCallbacks2. */
export const TRIM_LEVELS = {
  RUNNING_MODERATE: 5,
  RUNNING_LOW: 10,
  RUNNING_CRITICAL: 15,
  HIDDEN: 20,
  BACKGROUND: 40,
  MODERATE: 60,
  COMPLETE: 80,
} as const;
export type TrimLevel = keyof typeof TRIM_LEVELS;

/** What a memory warning is on Android when no level is asked for: the worst one an app in front can be told. */
export const DEFAULT_TRIM: TrimLevel = 'RUNNING_CRITICAL';

const isLevel = (v: string): v is TrimLevel => Object.hasOwn(TRIM_LEVELS, v);

/** A trim level as `am` takes it, from a client's words: in any case, and as ComponentCallbacks2 names it too. */
export function trimLevel(value: string | undefined): TrimLevel {
  if (value === undefined) return DEFAULT_TRIM;
  const v = value
    .trim()
    .toUpperCase()
    .replace(/^TRIM_MEMORY_/, '')
    .replace(/^UI_HIDDEN$/, 'HIDDEN');
  if (isLevel(v)) return v;
  throw new DeviceError(
    'INVALID_ARGUMENT',
    `memory_warning: an Android trim level is one of ${Object.keys(TRIM_LEVELS).join(', ')}, not ${value}`,
  );
}

/** What `am` says of a background level sent to an app in front. */
const FOREGROUND = /background trim level on a foreground/i;
/** How long an app sent home may still count as in front, and how often it is asked again meanwhile. */
const HOME_LAG_MS = 3_000;
const LOOK_MS = 100;

/** A level by its number, as `dumpsys` gives the one a process is at. */
const levelNamed = (n: number) =>
  Object.entries(TRIM_LEVELS).find(([, v]) => v === n)?.[0] ?? `level ${n}`;

/**
 * Why Android refused a trim level, by what `am` said: it takes only a level above the one it last gave the process,
 * which a new process starts at none of, and one of an app in the background (HIDDEN and above) only while it is.
 */
export function trimRefused(app: string, level: TrimLevel, said: string, at?: number) {
  if (/Unknown process/i.test(said))
    return new DeviceError(
      'APP_NOT_RUNNING',
      `${app} is not running: a trim level reaches only a process that runs`,
      'launch it, then ask again',
    );
  if (/higher trim level/i.test(said))
    return new DeviceError(
      'INVALID_ARGUMENT',
      `Android refused ${level}: ${app} is at ${at === undefined ? 'that level or a higher one' : levelNamed(at)} already, and takes only a higher level until it starts again`,
      'a higher level, or the app started again, a new process at none',
    );
  if (FOREGROUND.test(said))
    return new DeviceError(
      'INVALID_ARGUMENT',
      `Android refused ${level}: a background level (HIDDEN and above) reaches only an app in the background`,
      'the app sent home first, or a RUNNING_ level for the app in front',
    );
  return new DeviceError('INTERNAL', `am send-trim-memory: ${said.slice(0, 300)}`);
}

/** How hard a shake pulls, in m/s² beside gravity's reading: 2.7 g with it, as a hand's shake does. */
const PULL = 25;
/** Each way of the shake is held this long: a listener at the UI's rate (60 ms) sees each, and all four in 0.5 s. */
const WAY_MS = 80;

const PHONE_SHAKE =
  "a phone is shaken only by hand: nothing on this Mac moves its accelerometer, as an emulator's console does";

/** What am kill leaves running, said where it did. */
const KILL_SPARES =
  'am kill ends only a process the system could end itself: a foreground service, or another reason it holds the app important, keeps it running';

/** An Android device's memory warnings, shakes and the end the system makes of an app in the background. */
export class AndroidLifecycle {
  constructor(
    private readonly sh: (command: string) => Promise<string>,
    /** The emulator's console, refused on a phone; `what` names it in a refusal. */
    private readonly emu: (what: string, ...words: string[]) => Promise<string>,
    private readonly virtual: boolean,
    private readonly device: Backgrounds,
  ) {}

  async memoryWarning(app: string, value?: string) {
    const level = trimLevel(value);
    const pkg = shq(assertPkg(app));
    const send = async () => {
      const said = await this.sh(`am send-trim-memory ${pkg} ${level} 2>&1`);
      return /IllegalArgumentException: (.+)/.exec(said)?.[1] ?? /^Error: (.+)$/m.exec(said)?.[1];
    };
    let refused = await send();
    // the system holds an app sent home for one in front a while after, as a read of the screen does too: 0.7 s on an
    // API 35 emulator, 1.1 s on API 36. One in front indeed is refused once that has passed
    const end = Date.now() + HOME_LAG_MS;
    while (refused && FOREGROUND.test(refused) && Date.now() < end) {
      await sleep(LOOK_MS);
      refused = await send();
    }
    if (refused) {
      const at = /trimMemoryLevel=(\d+)/.exec(
        await this.sh(`dumpsys activity processes ${pkg}`).catch(() => ''),
      )?.[1];
      throw trimRefused(app, level, refused.trim(), at === undefined ? undefined : Number(at));
    }
    return `trim level ${level}; Android takes only a higher one until the app starts again`;
  }

  /** A shake from side to side, across gravity's axis, as the emulator's accelerometer reads it; the reading put back. */
  async shake() {
    if (!this.virtual) throw new DeviceError('UNSUPPORTED', PHONE_SHAKE);
    const read = await this.emu('a shake', 'sensor', 'get', 'acceleration');
    const was = /acceleration = (\S+:\S+:\S+)/.exec(read)?.[1];
    if (!was)
      throw new DeviceError('INTERNAL', `the emulator read no acceleration: ${read.trim()}`);
    const axes = was.split(':').map(Number);
    // the axis gravity is least on: a turned emulator reads it on x
    const across = Math.abs(axes[0] ?? 0) <= Math.abs(axes[1] ?? 0) ? 0 : 1;
    try {
      for (const way of [1, -1, 1, -1]) {
        const pulled = axes.map((a, i) => (i === across ? way * PULL : a));
        await this.emu('a shake', 'sensor', 'set', 'acceleration', pulled.join(':'));
        await sleep(WAY_MS);
      }
    } finally {
      await this.emu('a shake', 'sensor', 'set', 'acceleration', was);
    }
    return 'the app in front feels it as its accelerometer reads it';
  }

  endInBackground(app: string) {
    const pkg = shq(assertPkg(app));
    return endInBackground(
      this.device,
      app,
      async () => {
        await this.sh(`am kill ${pkg}`);
      },
      KILL_SPARES,
    );
  }
}
