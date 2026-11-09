import {
  deviceState,
  heldElsewhere,
  must,
  Owner,
  SETTINGS,
  type DeviceSettings,
  type SettingName,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';
import type { Answers } from './answers.js';
import { approve } from './approval.js';
import type { ServerContext } from './context.js';
import { checkApp } from './policy.js';
import { SettingOut } from './schemas.js';
import type { Session } from './session.js';
import { defineOp, DESTRUCTIVE, reply, ToolError } from './tool.js';

const PHONE_NUMBER = /^\+?\d{3,20}$/;
const DEFAULT_SENDER = '5551234';
const BIOMETRIC = ['match', 'nomatch', 'enroll'] as const;
const ONE_SHOT = ['restore', 'biometric', 'call', 'sms', 'keychain'] as const;

/** The conditions this tool changed on a device and what to put back. Survives its process. */
const Changes = z.record(
  z.string(),
  z.object({ was: z.string(), app: z.string().optional(), owner: Owner.optional() }),
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
      'device_setting restore first',
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
export async function turning(s: Session, turn: () => Promise<void>) {
  await s.conditions.run(async () => {
    const held = await writeDown(s, s.device.settings, 'orientation').catch((e: unknown) => {
      if (e instanceof DeviceError && e.code === 'UNSUPPORTED') return undefined;
      throw e;
    });
    try {
      await turn();
    } catch (e) {
      if (held?.first && (await readsAsItWas(s, 'orientation'))) forget(s, 'orientation');
      throw e;
    }
  });
}

/** Puts `was` back and reads it: what the device reads where that is not `was`, which then stays written down. */
async function putBack(
  s: Session,
  name: SettingName,
  c: { was: string; app?: string | undefined },
) {
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
    const changes = conditions.read(s.device.serial) ?? {};
    // the newest first: two names can hold one thing (Android's animations and reduce_motion), and the older holds the user's value
    for (const [name, c] of Object.entries(changes).reverse()) {
      if (!whose(c.owner)) {
        left.push(`${name} (pid ${String(c.owner?.pid)})`);
        continue;
      }
      try {
        const reads = await putBack(s, name as SettingName, c);
        if (reads === undefined) restored.push(`${name}: ${wordOf(name, c.was)}`);
        else failed.push(`${name} (was ${c.was}): it reads ${reads}`);
      } catch (e) {
        failed.push(`${name} (was ${c.was}): ${(e as Error).message}`);
      }
    }
    return { restored, failed, left };
  });
}

export function settingOps(ctx: ServerContext, { clean }: Answers) {
  const policy = ctx.policy;
  return [
    defineOp({
      name: 'device_setting',
      title: 'Device conditions',
      description:
        'Dark mode, text size, reduce motion, slow network, airplane mode, Wi-Fi, mobile data, Face ID, fingerprint, calls, SMS. No value reads one. Put back at the end or by restore.',
      input: z
        .object({
          name: z.enum([...SETTINGS, ...ONE_SHOT]),
          value: z
            .string()
            .max(500)
            .describe(
              'A switch: on, off; text_size: Android 1.3, iOS extra-large; locale: tr-TR; network: slow, full; thermal: serious; proxy: host:port, none; battery: 0-100; fold: open, closed. One-shot: biometric (match, nomatch, enroll), call (number; end number), sms (value; title: number), keychain (reset).',
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
        const { settings, events } = s.device;
        if (name === 'restore') {
          const { restored, failed, left } = await restoreConditions(
            s,
            (owner) => !heldElsewhere(owner),
          );
          const t =
            [
              ...(restored.length > 0 ? [`restored ${restored.join('; ')}`] : []),
              ...failed.map((f) => `could not restore ${f}`),
              ...left.map((l) => `left alone, as its process still runs: ${l}`),
            ].join('\n') || 'nothing was changed';
          return reply(t, { done: t, ...(failed.length > 0 && { notRestored: failed }) });
        }
        if (name === 'biometric') {
          const answer = BIOMETRIC.find((b) => b === value);
          if (!answer)
            throw new ToolError(
              `biometric needs value: ${BIOMETRIC.join(', ')}`,
              'INVALID_ARGUMENT',
            );
          // setting one up may leave the app, as Settings' enrolment on an emulator does
          const also = await events.biometric(
            answer,
            policy.allowHome
              ? async (n, v) => {
                  await setCondition(s, n, v);
                }
              : undefined,
          );
          const t = [`biometric: ${answer}`, also].filter(Boolean).join('; ');
          return reply(t, { done: t });
        }
        if (name === 'keychain') {
          if (value !== 'reset')
            throw new ToolError('keychain needs value: reset', 'INVALID_ARGUMENT');
          await approve(policy, s, 'device_setting keychain');
          const t = `the keychain is empty: it held ${await events.resetKeychain()} items`;
          return reply(t, { done: t });
        }
        if (name === 'call') {
          const m = /^(end )?(\+?\d{3,20})$/.exec(value ?? '');
          if (!m)
            throw new ToolError(
              'call needs value: a phone number; end and the number hangs up',
              'INVALID_ARGUMENT',
            );
          const number = must(m[2], 'the number');
          await events.call(number, !!m[1]);
          s.acted();
          const t = m[1] ? `the call from ${number} ended` : `a call from ${number} is coming in`;
          return reply(t, { done: t });
        }
        if (name === 'sms') {
          const from = title ?? DEFAULT_SENDER;
          if (!value) throw new ToolError('sms needs value: the text', 'INVALID_ARGUMENT');
          if (!PHONE_NUMBER.test(from))
            throw new ToolError(
              'sms needs title: the phone number it comes from',
              'INVALID_ARGUMENT',
            );
          await events.sms(from, value);
          s.acted();
          return reply(`an SMS came from ${from}`, { done: `an SMS came from ${from}` });
        }
        const pkg = app ?? (name === 'locale' ? s.appId : undefined);
        if (pkg) checkApp(policy, pkg);
        if (value === undefined) {
          const now = wordOf(name, await settings.get(name, pkg));
          const t = `${name}: ${now}`;
          return reply(clean(t), { done: clean(t), value: now });
        }
        const { also, moved, now } = await setCondition(s, name, value, pkg);
        s.acted();
        if (!moved) {
          const reads = wordOf(name, now);
          const t = clean(`${name} reads ${reads}, as before: nothing changed`);
          return reply(t, { done: t, value: reads });
        }
        const t = [`${name}: ${value}`, also].filter(Boolean).join('; ');
        return reply(t, { done: t, value, changed: { [name]: value } });
      },
    }),
  ];
}
