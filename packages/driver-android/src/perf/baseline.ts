import { must, type BaselineReading, type Measured } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg, shq } from '../adb.js';
import { buildType } from './app.js';
import { dexoptState, launch, type LaunchStats } from './launch.js';
import { parseCompileStatus } from './parse.js';
import { at, sh, type PerfDevice } from './shared.js';

const PROFILE = 'assets/dexopt/baseline.prof';
/** In turns, so that what the device or the Mac drifts by falls on both. */
const ROUNDS = 3;
const COMPILED = 'status=speed-profile';

const coldStarts = (m: Measured<LaunchStats>) =>
  m.value.samples.flatMap((s) =>
    s.totalMs !== undefined && s.state === 'COLD' ? [s.totalMs] : [],
  );

/** The rules of the profile the device holds for the app, from API 34; nothing where it cannot say. */
async function profileRules(d: PerfDevice, pkg: string) {
  await sh(d, `pm dump-profiles --dump-classes-and-methods ${pkg}`);
  const lines = /^\d+/.exec(
    (await sh(d, `wc -l /data/misc/profman/${pkg}-primary.prof.txt`)).trim(),
  );
  return lines ? Number(lines[0]) : undefined;
}

/**
 * What a Baseline Profile does for an app: in its APK, compiled on the device, and cold starts with it and
 * without, in turns. Each `launch` here ends with `compile --reset`, which takes a profile written by the
 * broadcast with it and leaves one from a `.dm`, so the profile is installed again before each round and
 * each round's own status is read: a compile with no profile says Success and stays at `verify`. The app
 * ends as an install leaves it, and what it gathered in use goes with that.
 */
export async function baselineProfile(
  d: PerfDevice,
  pkg: string,
  { repeats }: { repeats: number },
): Promise<Measured<BaselineReading>> {
  await d.readyToMeasure();
  assertPkg(pkg);
  if ((await buildType(d, pkg)) === 'debug')
    throw new DeviceError(
      'UNSUPPORTED',
      `${pkg} is debuggable, which stays at verify whatever is asked: measure a release build`,
    );
  const apk = /package:(\S+\.apk)/.exec(await sh(d, `pm path ${pkg}`))?.[1];
  if (!apk) throw new DeviceError('NOT_FOUND', `${pkg} is not installed`);
  const listing = await sh(d, `unzip -l ${shq(apk)} ${shq(PROFILE)}`);
  if (!listing.includes('Archive:'))
    throw new DeviceError(
      'UNSUPPORTED',
      `this device cannot list an APK: ${must(listing.trim().split('\n')[0], 'a line')}`,
    );
  const state = parseCompileStatus(await dexoptState(d, pkg));
  const found = {
    present: listing.includes(PROFILE),
    ...(state && { state }),
    applied: (state ?? '').includes(COMPILED),
  };
  const raws = [listing, state ?? ''];
  const without: number[] = [];
  const withProfile: number[] = [];
  let rules: number | undefined;
  for (let i = 0; found.present && i < ROUNDS; i++) {
    const off = await launch(d, pkg, { mode: 'cold', repeats, compile: 'verify' });
    const said = await sh(
      d,
      `am broadcast -a androidx.profileinstaller.action.INSTALL_PROFILE ${pkg}/androidx.profileinstaller.ProfileInstallReceiver`,
    );
    rules ??= await profileRules(d, pkg);
    const on = await launch(d, pkg, { mode: 'cold', repeats, compile: 'speed-profile' });
    if (!(on.value.compile?.status ?? '').includes(COMPILED))
      throw new DeviceError(
        'UNSUPPORTED',
        `the profile compiled nothing here (${String(on.value.compile?.status)}): ProfileInstaller answered ${/result=\d+/.exec(said)?.[0] ?? said.trim()}, where 0 is none in the app and 3 an Android newer than it knows: install the APK with its .dm`,
      );
    without.push(...coldStarts(off));
    withProfile.push(...coldStarts(on));
    raws.push(off.raw, said, on.raw);
  }
  return {
    value: { ...found, ...(rules && { rules }), without, with: withProfile },
    raw: raws.join('\n---\n'),
    at: at(),
  };
}
