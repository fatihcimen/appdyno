import { join } from 'node:path';
import { endInBackground, run, type Backgrounds } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertBundle, type Simctl } from './simctl.js';

/** The notification a simulator's UIKit takes for a shake, as Simulator's own menu sends it. */
const SHAKE = 'com.apple.UIKit.SimulatorShake';

/**
 * The file each process of a simulator watches for memory pressure, by the name its environment gives it: one change of
 * its times is one warning to every process that runs there.
 */
const MEMORY_FILE = 'SIMULATOR_MEMORY_WARNINGS';

/** Photos' own rows of what its library holds, those in its trash aside. */
const PHOTOS_HELD = 'select count(*) from ZASSET where ZTRASHEDSTATE = 0';

/** What a simulator's memory warning reaches. */
export const EVERY_APP = 'every app that runs on the simulator gets it, as from its own menu';

/** What a simulator's Photos keeps of what was added. */
export const PHOTOS_KEEP = "a simulator's Photos has no delete: restore leaves them there";

/** What may help a file Photos did not take: one of each of these went in on an iOS 26.5 simulator, which proves no other. */
const MEDIA_TAKEN =
  'another format may go in, as an H.264 video in an .mp4 or a .mov, or a .png or .jpg photo: convert the file, then add it again';

/** iOS warns of memory at one level: a level asked for is Android's, refused. */
export function noLevel(level: string | undefined) {
  if (level)
    throw new DeviceError(
      'INVALID_ARGUMENT',
      `an iOS memory warning has no level: ${level} is one of Android's trim levels`,
    );
}

/** A simulator's memory warnings, shakes, photos and the end the system makes of an app in the background. */
export class SimulatorLifecycle {
  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
    private readonly device: Backgrounds,
  ) {}

  private spawn = (...words: string[]) => this.simctl.exec(['spawn', this.udid, ...words]);

  async memoryWarning(app: string, level?: string) {
    noLevel(level);
    if (!(await this.device.appRunning(app)))
      throw new DeviceError(
        'APP_NOT_RUNNING',
        `${app} is not running: a memory warning reaches only an app that runs`,
      );
    const file = (
      await this.simctl.exec(['getenv', this.udid, MEMORY_FILE]).catch(() => '')
    ).trim();
    if (!file)
      throw new DeviceError(
        'UNSUPPORTED',
        `this simulator's runtime names no file for its memory warnings (${MEMORY_FILE})`,
      );
    // the simulator's own call writes the file from this Mac, and the first write of it by a process the Mac tracks adds
    // an attribute beside its times: two warnings on that call. The runtime's own truncate, inside it, changes the times
    // alone, one warning each call, the first too
    await this.spawn('truncate', '-s', '0', file).catch((e: unknown) => {
      throw new DeviceError(
        'UNSUPPORTED',
        `this simulator's runtime cannot change its memory warning file: ${(e as Error).message}`,
      );
    });
    return EVERY_APP;
  }

  async shake() {
    await this.spawn('notifyutil', '-p', SHAKE);
    return 'the app in front gets it';
  }

  endInBackground(app: string) {
    return endInBackground(this.device, app, async () => {
      // the process is this Mac's, found in the app's own folder of this simulator
      process.kill(await this.simctl.pid(this.udid, assertBundle(app)), 'SIGKILL');
    });
  }

  /** What Photos holds, by its own rows: none where they cannot be read, as its tables are its own to change. */
  private async photosHeld() {
    const home = (await this.simctl.exec(['getenv', this.udid, 'HOME'])).trim();
    const db = join(home, 'Media/PhotoData/Photos.sqlite');
    const n = await run('sqlite3', ['-readonly', db, PHOTOS_HELD]).then(
      ({ stdout }) => Number(stdout.trim()),
      () => NaN,
    );
    return Number.isInteger(n) ? n : undefined;
  }

  /**
   * Each file by a call of its own: simctl imports the files it can of several and then ends on an exception that
   * names none, so one call a file is what tells which did not go in.
   */
  async addMedia(files: string[]) {
    const refused: string[] = [];
    let said = '';
    for (const file of files)
      await this.simctl.exec(['addmedia', this.udid, file]).catch((e: unknown) => {
        // a simulator that is gone, a call that ran out of time: not the file's
        if (!(e instanceof DeviceError) || e.code !== 'INTERNAL') throw e;
        refused.push(file);
        said = e.message;
      });
    if (refused.length > 0) {
      const added = files.length - refused.length;
      throw new DeviceError(
        'INVALID_ARGUMENT',
        [
          `the simulator's Photos could not import ${refused.join(', ')}${added > 0 ? `; the other ${added} of ${files.length} went in` : ''}`,
          said,
        ].join('\n'),
        MEDIA_TAKEN,
      );
    }
    const held = await this.photosHeld().catch(() => undefined);
    return [...(held === undefined ? [] : [`Photos holds ${held}`]), PHOTOS_KEEP].join('; ');
  }
}
