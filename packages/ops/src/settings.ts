import {
  deviceState,
  heldElsewhere,
  Owner,
  SETTINGS,
  type DeviceSettings,
  type SettingName,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { checkApp } from './policy.js';
import { askLanguage } from './power.js';
import { mediaRestored } from './media.js';
import { capturingApp } from './network-capture.js';
import { SettingOut } from './schemas.js';
import { isOneShot, oneShot, ONE_SHOT } from './setting-events.js';
import type { Session } from './session.js';
import { definePart, DESTRUCTIVE, reply, ToolError } from './tool.js';

/** The conditions this tool changed on a device and what to put back. Survives its process. */
const Changes = z.record(
  z.string(),
  z.object({
    was: z.string(),
    app: z.string().optional(),
    owner: Owner.optional(),
    /** What it was set to, where the device does not tell it back: a fixed location. */
    now: z.string().optional(),
  }),
);

export const conditions = deviceState('conditions', Changes);

/** A switch reads as it is set, on or off: iOS says light and dark, Android yes and no. */
const SWITCH_WORDS: Partial<Record<string, string>> = {
  dark: 'on',
  yes: 'on',
  light: 'off',
  no: 'off',
};
const wordOf = (name: string, value: string) =>
  name === 'dark_mode' ? (SWITCH_WORDS[value] ?? value) : value;

/** What a device reads of a condition, as an answer says it: what refuses it says why, as a refusal. */
export const readCondition = async (s: Session, name: SettingName, app?: string) =>
  wordOf(name, await s.device.settings.get(name, app));

/** Whose entries a restore takes, by their owner. */
export type Whose = (owner: Owner | undefined) => boolean;

/**
 * Writes a condition's old value down, once: `first` when this call did, and what it reads now. One held for another app
 * is refused, as its own could not be put back.
 */
async function writeDown(s: Session, settings: DeviceSettings, name: SettingName, app?: string) {
  const serial = s.device.serial;
  const held = conditions.read(serial)?.[name];
  if (held && (held.app ?? '') !== (app ?? ''))
    throw new ToolError(
      `${name} is held for ${held.app ?? 'the whole device'} until it is put back`,
      'INVALID_ARGUMENT',
      'set_device restore first',
    );
  if (held) return { first: false, now: await settings.get(name, app) };
  await settings.willChange?.(name);
  const was = await settings.get(name, app);
  let first = false;
  // another process may have written it down during the read
  conditions.update(serial, (now = {}) => {
    if (now[name]) return now;
    first = true;
    return { ...now, [name]: { was, ...(app && { app }), owner: s.owner } };
  });
  return { first, now: was };
}

const forget = (s: Session, name: string) =>
  conditions.update(s.device.serial, (now = {}) => {
    const { [name]: _, ...rest } = now;
    return Object.keys(rest).length > 0 ? rest : undefined;
  });

/** When a change goes back: a command line's stays for the next command, as each command is a process. */
const back = (s: Session) =>
  s.owner
    ? 'put back when this session ends, or by restore; it cannot be kept past the session'
    : 'it stays until restore';

/** What a device reads of a condition, as `set` takes it: what follows "(now" is its state of the moment (a battery's level). */
const asSet = (value: string) => value.replace(/ \(now [^)]*\)$/, '');
const same = (a: string, b: string | undefined) => b !== undefined && asSet(a) === asSet(b);

/**
 * Sets a condition, the old value written down first so a crash cannot lose it, and reads it back: `moved` only when it
 * reads otherwise than before, and one that did not move is not left written down. `also`: what the answer should add.
 */
export async function setCondition(s: Session, name: SettingName, value: string, app?: string) {
  const settings = s.device.settings;
  return s.conditions.run(async () => {
    const { first, now: before } = await writeDown(s, settings, name, app);
    let said: string | undefined;
    try {
      said = await settings.set(name, value, app);
    } catch (e) {
      // what went out stays written down until the device reads as it was: a refusal may come after the change
      if (first && (await readsAsItWas(s, name, app))) forget(s, name);
      throw e;
    }
    // a device's command may take what it cannot do and exit 0, saying "Invalid argument" and changing nothing
    const now = await settings.get(name, app);
    const moved = !same(now, before);
    if (first && !moved) forget(s, name);
    // what did not move is not written down, so nothing goes back
    const also = [said, ...(moved ? [back(s)] : [])].filter(Boolean).join('; ');
    return { also, moved, now };
  });
}

/** Whether the device reads what was written down for `name`; not when it cannot be read. */
async function readsAsItWas(s: Session, name: SettingName, app?: string) {
  const was = conditions.read(s.device.serial)?.[name]?.was;
  return s.device.settings.get(name, app).then(
    (now) => same(now, was),
    () => false,
  );
}

/** `during` changes a condition for its time and puts it back itself: only a process dying meanwhile leaves it. */
export async function holdingCondition<T>(s: Session, name: SettingName, during: () => Promise<T>) {
  const settings = s.device.settings;
  const { first } = await s.conditions.run(() => writeDown(s, settings, name));
  try {
    return await during();
  } finally {
    if (first) forget(s, name);
  }
}

/**
 * `turn` turns the screen, which sets the rotation lock: what it found is written down first and put back as any
 * condition, at restore and the session's end. A device that has none to read (iOS) turns all the same.
 */
export async function turning(s: Session, turn: (kept: boolean) => Promise<void>) {
  await s.conditions.run(async () => {
    const held = await writeDown(s, s.device.settings, 'orientation').catch((e: unknown) => {
      if (e instanceof DeviceError && e.code === 'UNSUPPORTED') return undefined;
      throw e;
    });
    try {
      await turn(held !== undefined);
    } catch (e) {
      if (held?.first && (await readsAsItWas(s, 'orientation'))) forget(s, 'orientation');
      throw e;
    }
  });
}

/** A fixed location is written down as a condition, so that it ends as one does: it has nothing to read, and was the real one. */
const LOCATION = 'location';
const REAL_PLACE = 'the real one';

/** A place as an answer says it. */
export const placeOf = (lat: number, lon: number) => `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

export function fixLocation(s: Session, lat: number, lon: number) {
  return s.conditions.run(async () => {
    conditions.update(s.device.serial, (now = {}) =>
      now[LOCATION] ? now : { ...now, [LOCATION]: { was: REAL_PLACE, owner: s.owner } },
    );
    await s.device.setLocation(lat, lon);
    conditions.update(s.device.serial, (now = {}) => {
      const held = now[LOCATION];
      return held ? { ...now, [LOCATION]: { ...held, now: placeOf(lat, lon) } } : now;
    });
  });
}

/** A read of the location: the place this tool fixed, as a device does not tell its location back, or that it fixed none. */
export function locationNow(s: Session) {
  const held = conditions.read(s.device.serial)?.[LOCATION];
  if (!held)
    return 'location: the real one: none is fixed here, and a device does not tell where it is';
  return `location: ${held.now ?? 'fixed, at a place not kept'}; none puts back the real one`;
}

export function endLocation(s: Session) {
  return s.conditions.run(async () => {
    await s.device.clearLocation();
    forget(s, LOCATION);
  });
}

/** Puts `was` back and reads it: what the device reads where that is not `was`, which then stays written down. */
async function putBack(
  s: Session,
  name: SettingName | typeof LOCATION,
  c: { was: string; app?: string | undefined },
) {
  if (name === LOCATION) {
    await s.device.clearLocation();
    forget(s, name);
    return undefined;
  }
  await s.device.settings.set(name, c.was, c.app);
  const now = await s.device.settings.get(name, c.app);
  if (!same(now, c.was)) return now;
  forget(s, name);
  return undefined;
}

/** Puts back one condition, if this tool changed it and no other live process did. */
export async function restoreCondition(s: Session, name: SettingName) {
  await s.conditions.run(async () => {
    const c = conditions.read(s.device.serial)?.[name];
    if (!c || heldElsewhere(c.owner)) return;
    await putBack(s, name, c);
  });
}

/** Puts back the entries `whose` takes; the names it could not, with why, stay written down. */
export function restoreConditions(s: Session, whose: Whose) {
  return s.conditions.run(async () => {
    const restored: string[] = [];
    const failed: string[] = [];
    const left: string[] = [];
    /** What each condition put back reads now, as its read-back found it. */
    const now: Record<string, string> = {};
    const changes = conditions.read(s.device.serial) ?? {};
    // the newest first: two names can hold one thing (Android's animations and reduce_motion), and the older holds the user's value
    for (const [name, c] of Object.entries(changes).reverse()) {
      if (!whose(c.owner)) {
        left.push(`${name} (pid ${String(c.owner?.pid)})`);
        continue;
      }
      try {
        const reads = await putBack(s, name as SettingName, c);
        // one that read empty, as a locale no app had set, is named alone
        if (reads === undefined) restored.push(c.was ? `${name}: ${wordOf(name, c.was)}` : name);
        else failed.push(`${name} (was ${c.was}): it reads ${reads}`);
        if (name !== LOCATION) now[name] = wordOf(name, reads ?? c.was);
      } catch (e) {
        failed.push(`${name} (was ${c.was}): ${(e as Error).message}`);
      }
    }
    return { restored, failed, left, reads: now };
  });
}

/**
 * `restore`: the conditions this tool changed put back, the probes its launches hold let go, and the photos and videos
 * it added taken out, each where no other live process holds it.
 */
async function restoreAll(s: Session) {
  const { restored, failed, left, reads } = await restoreConditions(
    s,
    (owner) => !heldElsewhere(owner),
  );
  const holds = s.device.holds;
  // a capture that runs on reads its probe in the app's next start too: its stop lets that one go
  const capturing = capturingApp(s.device.serial);
  const held = holds && !heldElsewhere(holds.holder()?.owner) ? holds.letGo(capturing) : [];
  const out = await mediaRestored(s.device.addedMedia, (owner) => !heldElsewhere(owner));
  const notRestored = [...failed, ...out.failed];
  const t =
    [
      ...(restored.length > 0 ? [`restored ${restored.join('; ')}`] : []),
      ...out.done,
      ...(held.length > 0
        ? [`let go of ${held.join('; ')}: a probe stays in its app until the app next starts`]
        : []),
      ...(capturing && holds?.holder()
        ? [
            `kept the network probe in ${capturing}, whose capture still runs: capture_network stop ends it`,
          ]
        : []),
      ...notRestored.map((f) => `could not restore ${f}`),
      ...left.map((l) => `left alone, as its process still runs: ${l}`),
    ].join('\n') || 'nothing was changed';
  return reply(t, {
    done: t,
    ...(notRestored.length > 0 && { notRestored }),
    ...(Object.keys(reads).length > 0 && { reads }),
  });
}

export function settingOps(ctx: ServerContext, { clean }: Answers) {
  const policy = ctx.policy;
  return [
    definePart({
      name: 'device_setting',
      input: z
        .object({
          name: z.enum([...SETTINGS, 'restore', ...ONE_SHOT]),
          value: z
            .string()
            .max(500)
            .describe(
              'Switch: on, off; text_size: Android 1.3, iOS extra-large; locale: tr-TR; network: slow, full; thermal: serious; proxy: host:port, none; battery: 0-100; fold: closed, half, open. One-shot: biometric (match, nomatch, enroll), call (number; end number), sms (value; title: number), keychain (reset), memory_warning (Android: trim level), shake.',
            )
            .optional(),
          title: z.string().max(200).optional(),
          app: z.string().max(200).optional(),
        })
        .strict(),
      output: SettingOut,
      annotations: DESTRUCTIVE,
      run: async ({ name, value, title, app }) => {
        const s = await ctx.session();
        if (name === 'restore') return restoreAll(s);
        if (isOneShot(name))
          return oneShot(name, {
            policy,
            s,
            value,
            title,
            app,
            setUp: policy.allowHome
              ? async (n, v) => {
                  await setCondition(s, n, v);
                }
              : undefined,
          });
        const pkg = app ?? (name === 'locale' ? s.appId : undefined);
        if (pkg) checkApp(policy, pkg);
        if (name === 'locale' && value) await askLanguage(policy, s, value, pkg);
        if (value === undefined) {
          const now = await readCondition(s, name, pkg);
          // an app's locale none holds it in reads as nothing
          const choices = await s.device.settings.choices?.(name);
          const t = `${name}: ${now || 'none set'}${choices ? `; of ${choices.join(', ')}` : ''}`;
          return reply(clean(t), { done: clean(t), value: now });
        }
        const { also, moved, now } = await setCondition(s, name, value, pkg);
        s.acted();
        // the read-back that tells whether it took, so that no one need read it again
        const reads = wordOf(name, now);
        if (!moved) {
          const t = clean(`${name} reads ${reads}, as before: nothing changed`);
          return reply(t, { done: t, value: reads, reads: { [name]: reads } });
        }
        const t = [`${name}: ${value}`, also].filter(Boolean).join('; ');
        return reply(t, { done: t, value, changed: { [name]: value }, reads: { [name]: reads } });
      },
    }),
  ];
}
