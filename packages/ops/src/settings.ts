import {
  deviceState,
  heldElsewhere,
  Owner,
  SETTINGS,
  type DeviceSettings,
  type SettingName,
} from '@appdyno/core';
import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { checkApp } from './policy.js';
import { SettingOut } from './schemas.js';
import type { Session } from './session.js';
import { defineOp, DESTRUCTIVE, reply, ToolError } from './tool.js';

const PHONE_NUMBER = /^\+?\d{3,20}$/;
const DEFAULT_SENDER = '5551234';
const BIOMETRIC = ['match', 'nomatch', 'enroll'] as const;
const ONE_SHOT = ['restore', 'push', 'biometric', 'fold', 'call', 'sms', 'keychain'] as const;

/** The conditions this tool changed on a device and what to put back. Survives its process. */
const Changes = z.record(
  z.string(),
  z.object({ was: z.string(), app: z.string().optional(), owner: Owner.optional() }),
);

export const conditions = deviceState('conditions', Changes);

/** Whose entries a restore takes, by their owner. */
export type Whose = (owner: Owner | undefined) => boolean;

/** Writes a condition's old value down, once: true when this call did. */
async function writeDown(s: Session, settings: DeviceSettings, name: SettingName, app?: string) {
  const serial = s.device.serial;
  if (conditions.read(serial)?.[name]) return false;
  await settings.willChange?.(name);
  const was = await settings.get(name, app);
  let first = false;
  // another process may have written it down during the read
  conditions.update(serial, (now = {}) => {
    if (now[name]) return now;
    first = true;
    return { ...now, [name]: { was, ...(app && { app }), owner: s.owner } };
  });
  return first;
}

const forget = (s: Session, name: string) =>
  conditions.update(s.device.serial, (now = {}) => {
    const { [name]: _, ...rest } = now;
    return Object.keys(rest).length > 0 ? rest : undefined;
  });

/** Sets a condition, the old value written down first so a crash cannot lose it. */
export async function setCondition(s: Session, name: SettingName, value: string, app?: string) {
  const settings = s.device.settings;
  await s.conditions.run(async () => {
    const first = await writeDown(s, settings, name, app);
    try {
      await settings.set(name, value, app);
    } catch (e) {
      // nothing changed, so nothing to put back
      if (first) forget(s, name);
      throw e;
    }
  });
}

/** `during` changes a condition for its time and puts it back itself: only a process dying meanwhile leaves it. */
export async function holdingCondition<T>(s: Session, name: SettingName, during: () => Promise<T>) {
  const settings = s.device.settings;
  const first = await s.conditions.run(() => writeDown(s, settings, name));
  try {
    return await during();
  } finally {
    if (first) forget(s, name);
  }
}

/** Puts back one condition, if this tool changed it and no other live process did. */
export async function restoreCondition(s: Session, name: SettingName) {
  await s.conditions.run(async () => {
    const c = conditions.read(s.device.serial)?.[name];
    if (!c || heldElsewhere(c.owner)) return;
    await s.device.settings.set(name, c.was, c.app);
    forget(s, name);
  });
}

/** Puts back the entries `whose` takes; the names it could not, with why, stay written down. */
export function restoreConditions(s: Session, whose: Whose) {
  return s.conditions.run(async () => {
    const restored: string[] = [];
    const failed: string[] = [];
    const left: string[] = [];
    const settings = s.device.settings;
    const changes = conditions.read(s.device.serial) ?? {};
    // the newest first: two names can hold one thing (Android's animations and reduce_motion), and the older holds the user's value
    for (const [name, c] of Object.entries(changes).reverse()) {
      if (!whose(c.owner)) {
        left.push(`${name} (pid ${c.owner?.pid})`);
        continue;
      }
      try {
        await settings.set(name as SettingName, c.was, c.app);
        forget(s, name);
        restored.push(`${name}: ${c.was}`);
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
        'No value reads one. A switch takes on, off; text_size: 1.3, iOS large; locale: tr-TR; network: slow, full; proxy: host:port, none; battery: 0-100. Put back at the end or by restore. One-shot: push (value; title), biometric (match, nomatch, enroll), fold (open, closed), call (number; end number), sms (value; title: number), keychain (reset).',
      input: z
        .object({
          name: z.enum([...SETTINGS, ...ONE_SHOT]),
          value: z.string().max(500).optional(),
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
        if (name === 'push') {
          if (!value) throw new ToolError('push needs value: the text', 'INVALID_ARGUMENT');
          const pkg = app ?? s.appId;
          if (pkg) checkApp(policy, pkg);
          await events.push(pkg, title ?? 'appdyno', value);
          return reply(`posted a notification`, { done: 'posted a notification' });
        }
        if (name === 'biometric') {
          const answer = BIOMETRIC.find((b) => b === value);
          if (!answer)
            throw new ToolError(
              `biometric needs value: ${BIOMETRIC.join(', ')}`,
              'INVALID_ARGUMENT',
            );
          await events.biometric(answer);
          return reply(`biometric: ${value}`, { done: `biometric: ${value}` });
        }
        if (name === 'keychain') {
          if (value !== 'reset')
            throw new ToolError('keychain needs value: reset', 'INVALID_ARGUMENT');
          const t = `the keychain is empty: it held ${await events.resetKeychain()} items`;
          return reply(t, { done: t });
        }
        if (name === 'fold') {
          if (value !== 'open' && value !== 'closed')
            throw new ToolError('fold needs value: open or closed', 'INVALID_ARGUMENT');
          await events.fold(value === 'closed');
          s.acted();
          return reply(`fold: ${value}`, { done: `fold: ${value}` });
        }
        if (name === 'call') {
          const m = /^(end )?(\+?\d{3,20})$/.exec(value ?? '');
          if (!m)
            throw new ToolError(
              'call needs value: a phone number; end and the number hangs up',
              'INVALID_ARGUMENT',
            );
          await events.call(m[2]!, !!m[1]);
          s.acted();
          const t = m[1] ? `the call from ${m[2]} ended` : `a call from ${m[2]} is coming in`;
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
          const now = await settings.get(name, pkg);
          const t = `${name}: ${now}`;
          return reply(clean(t), { done: clean(t), value: now });
        }
        await setCondition(s, name, value, pkg);
        s.acted();
        const t = `${name}: ${value}`;
        return reply(t, { done: t, value, changed: { [name]: value } });
      },
    }),
  ];
}
