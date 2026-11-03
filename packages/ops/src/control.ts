import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  deviceStateFile,
  reportProgress,
  SETTINGS,
  stateDir,
  type SettingName,
  type Startable,
  type VirtualDevices,
} from '@appdyno/core';
import { z } from 'zod';
import type { Answers } from './answers.js';
import { holder } from './claims.js';
import type { ServerContext } from './context.js';
import { checkApp, checkDevice } from './policy.js';
import { AppOut, DoneOut, SettingOut, VirtualOut } from './schemas.js';
import { refused, type Session } from './session.js';
import { Read } from './step-schemas.js';
import { ACT, defineOp, DESTRUCTIVE, reply, ToolError, type Op } from './tool.js';

const NO_APP = 'give app (or select one with use_device)';
const PHONE_NUMBER = /^\+?\d{3,20}$/;
const DEFAULT_SENDER = '5551234';

/** The conditions this tool changed on a device and what to put back. Survives its process. */
type Changes = Record<string, { was: string; app?: string }>;

const changesFile = (serial: string) => deviceStateFile('conditions', serial);

function readChanges(serial: string): Changes {
  try {
    return JSON.parse(readFileSync(changesFile(serial), 'utf8')) as Changes;
  } catch {
    return {};
  }
}

function writeChanges(serial: string, c: Changes) {
  const file = changesFile(serial);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(c), { mode: 0o600 });
}

/** Sets a condition, the old value written down first so a crash cannot lose it. */
export async function setCondition(s: Session, name: SettingName, value: string, app?: string) {
  const settings = s.device.settings;
  if (!settings) throw new ToolError('this device has no settings to change', 'UNSUPPORTED');
  const serial = s.device.serial;
  const changes = readChanges(serial);
  const first = !changes[name];
  if (first) {
    await settings.willChange?.(name);
    changes[name] = { was: await settings.get(name, app), ...(app && { app }) };
    writeChanges(serial, changes);
  }
  try {
    await settings.set(name, value, app);
  } catch (e) {
    // nothing changed, so nothing to put back
    if (first) {
      delete changes[name];
      writeChanges(serial, changes);
    }
    throw e;
  }
}

/** Puts back one condition, if this tool changed it. */
export async function restoreCondition(s: Session, name: SettingName) {
  const changes = readChanges(s.device.serial);
  const c = changes[name];
  if (!c) return;
  await s.device.settings!.set(name, c.was, c.app);
  delete changes[name];
  writeChanges(s.device.serial, changes);
}

/** Puts back what this tool changed; the names it could not, with why, stay written down. */
export async function restoreConditions(s: Session) {
  const serial = s.device.serial;
  const changes = readChanges(serial);
  const restored: string[] = [];
  const failed: string[] = [];
  // the newest first: two names can hold one thing (Android's animations and reduce_motion), and the older holds the user's value
  for (const [name, c] of Object.entries(changes).reverse()) {
    try {
      await s.device.settings!.set(name as SettingName, c.was, c.app);
      delete changes[name];
      restored.push(`${name}: ${c.was}`);
    } catch (e) {
      failed.push(`${name} (was ${c.was}): ${(e as Error).message}`);
    }
  }
  if (restored.length > 0) writeChanges(serial, changes);
  return { restored, failed };
}

const startedFile = () => join(stateDir(), 'started.json');
function startedHere(): string[] {
  try {
    return JSON.parse(readFileSync(startedFile(), 'utf8')) as string[];
  } catch {
    return [];
  }
}
function writeStarted(ids: string[]) {
  mkdirSync(dirname(startedFile()), { recursive: true, mode: 0o700 });
  writeFileSync(startedFile(), JSON.stringify(ids), { mode: 0o600 });
}

export function controlOps(ctx: ServerContext, { afterChange, clean }: Answers): Op[] {
  const policy = ctx.policy;
  const appOf = (s: Session, app?: string) => {
    const pkg = checkApp(policy, app ?? s.appId ?? '');
    if (!pkg) throw new ToolError(NO_APP);
    return pkg;
  };
  const appsOf = (s: Session) => {
    if (!s.device.apps) throw new ToolError('this device has no app management', 'UNSUPPORTED');
    return s.device.apps;
  };

  /** Every virtual device of every driver, with the driver that has it. */
  const virtuals = async () => {
    const out: { d: Startable; on: VirtualDevices }[] = [];
    for (const p of ctx.providers) {
      if (!p.virtual) continue;
      const found = await p.virtual.startable().catch(() => [] as Startable[]);
      out.push(...found.map((d) => ({ d, on: p.virtual! })));
    }
    return out;
  };
  const named = async (id: string) => {
    const all = await virtuals();
    const hits = all.filter(
      (x) =>
        x.d.id === id || x.d.serial === id || x.d.name === id || x.d.name.startsWith(`${id} (`),
    );
    if (hits.length === 1) return hits[0]!;
    throw new ToolError(
      hits.length === 0
        ? `no simulator or emulator is named ${id} (action list)`
        : `more than one is named ${id}: ${hits.map((x) => x.d.id).join(', ')}`,
      hits.length === 0 ? 'NOT_FOUND' : 'AMBIGUOUS',
    );
  };

  return [
    defineOp({
      name: 'app',
      title: 'App management',
      description:
        'list (all: with system apps), state, install (path: local .apk or .app), uninstall, clear (its data), grant, revoke (service: such as camera), launch (restarts it with args, env; Android args are key=value extras). Default app: the selected one.',
      input: z
        .object({
          action: z.enum([
            'list',
            'state',
            'install',
            'uninstall',
            'clear',
            'grant',
            'revoke',
            'launch',
          ]),
          app: z.string().max(200).optional(),
          path: z.string().max(1_000).optional(),
          service: z.string().max(80).optional(),
          args: z.array(z.string().max(500)).max(50).optional(),
          env: z.record(z.string(), z.string().max(1_000)).optional(),
          all: z.boolean().default(false),
          read: Read,
        })
        .strict(),
      output: AppOut,
      annotations: DESTRUCTIVE,
      run: async ({ action, app, path, service, args, env, all, read }) => {
        const s = await ctx.session();
        const apps = appsOf(s);
        const done = (t: string, extra: Record<string, unknown> = {}) =>
          reply(t, { done: t, ...extra });
        switch (action) {
          case 'list': {
            const list = await apps.listApps(all).catch(refused);
            return done(
              list
                .map(
                  (a) =>
                    `${a.id}${a.name ? ` "${a.name}"` : ''}${a.version ? ` ${a.version}` : ''}`,
                )
                .join('\n') || 'no apps',
              { apps: list },
            );
          }
          case 'state': {
            const pkg = appOf(s, app);
            const state =
              (await s.device.foreground().catch(() => undefined)) === pkg
                ? 'foreground'
                : await apps.appState(pkg).catch(refused);
            return done(`${pkg}: ${state}`, { state });
          }
          case 'install': {
            if (!path) throw new ToolError('install needs path');
            // the allowlist names apps, and a file's app is not known before it is installed
            if (policy.apps.length > 0)
              throw new ToolError(
                'install is off while this server has an app allowlist',
                'POLICY_DENIED',
              );
            reportProgress(`installing ${path}`);
            const said = await apps.install(path).catch(refused);
            if (said.length > 0) s.acted();
            // what it answered on the device is part of what happened: no read mode shortens this
            return done([`installed ${path}`, ...said].join('\n'));
          }
          case 'launch': {
            const pkg = appOf(s, app);
            reportProgress(`launching ${pkg}`);
            await apps
              .launchWith(pkg, { ...(args && { args }), ...(env && { env }) })
              .catch(refused);
            return afterChange(s, `launched ${pkg}`, read);
          }
          case 'grant':
          case 'revoke': {
            const pkg = appOf(s, app);
            if (!service) throw new ToolError(`${action} needs service`);
            await apps.permission(pkg, action === 'grant', service).catch(refused);
            return done(`${action === 'grant' ? 'granted' : 'revoked'} ${service} for ${pkg}`);
          }
          case 'uninstall':
          case 'clear': {
            const pkg = appOf(s, app);
            await (action === 'clear' ? apps.clearData(pkg) : apps.uninstall(pkg)).catch(refused);
            s.acted();
            s.appPid = undefined;
            return done(`${action === 'clear' ? 'cleared the data of' : 'uninstalled'} ${pkg}`);
          }
        }
      },
    }),
    defineOp({
      name: 'simulator',
      title: 'Simulators and emulators',
      description:
        'Only on request. list (what can be started), boot (name: its id or name), shutdown (name; none: only those this tool started).',
      input: z
        .object({
          action: z.enum(['list', 'boot', 'shutdown']),
          name: z.string().max(100).optional(),
        })
        .strict(),
      output: VirtualOut,
      annotations: DESTRUCTIVE,
      run: async ({ action, name: device }) => {
        const mine = startedHere();
        if (action === 'list') {
          const devices = (await virtuals()).map(({ d }) => ({
            ...d,
            startedHere: mine.includes(d.id),
          }));
          const t =
            devices
              .map(
                (d) =>
                  `${d.id} "${d.name}" ${d.state}${d.serial && d.serial !== d.id ? ` as ${d.serial}` : ''}${d.startedHere ? ' (started by this tool)' : ''}`,
              )
              .join('\n') || 'none can be started';
          return reply(t, { done: t, devices });
        }
        if (action === 'boot') {
          if (!device) throw new ToolError('boot needs name: its id or name (action list)');
          const { d, on } = await named(device);
          checkDevice(policy, d.id);
          reportProgress(`starting ${d.name}`);
          const wasStopped = d.state === 'stopped';
          const serial = await on.boot(d.id).catch(refused);
          // an emulator is listed by its serial once it runs
          if (wasStopped) writeStarted([...mine, d.id, serial]);
          const t = `${d.name} is up as ${serial}`;
          return reply(t, { done: t, serial });
        }
        const targets = device
          ? [await named(device)]
          : (await virtuals()).filter((x) => mine.includes(x.d.id) && x.d.state === 'running');
        if (targets.length === 0) {
          const t = 'none to shut down: this tool started none that still runs';
          return reply(t, { done: t });
        }
        for (const { d, on } of targets) {
          checkDevice(policy, d.id);
          const h = holder(d.serial ?? d.id);
          if (h && h.pid !== process.pid)
            throw new ToolError(
              `${d.id} is held by pid ${h.pid} (${h.tool}) since ${h.since}`,
              'DEVICE_CLAIMED',
            );
          reportProgress(`shutting down ${d.name}`);
          await ctx.forget(d.serial ?? d.id);
          await on.shutdown(d.id).catch(refused);
        }
        writeStarted(mine.filter((id) => !targets.some((x) => x.d.id === id || x.d.name === id)));
        const t = `shut down ${targets.map((x) => x.d.name).join(', ')}`;
        return reply(t, { done: t });
      },
    }),
    defineOp({
      name: 'device_setting',
      title: 'Device conditions',
      description:
        "No value reads one. dark_mode, reduce_motion, animations: on, off; text_size: 1.3, iOS large; locale: tr-TR; network (emulator): slow, full; proxy: host:port, none; battery: 0-100. Put back at the session's end or by restore. One-shot: push (value; title), biometric (match, nomatch), fold (open, closed), call (number; end number), sms (value; title: number).",
      input: z
        .object({
          name: z.enum([...SETTINGS, 'restore', 'push', 'biometric', 'fold', 'call', 'sms']),
          value: z.string().max(500).optional(),
          title: z.string().max(200).optional(),
          app: z.string().max(200).optional(),
        })
        .strict(),
      output: SettingOut,
      annotations: DESTRUCTIVE,
      run: async ({ name, value, title, app }) => {
        const s = await ctx.session();
        const settings = s.device.settings;
        if (!settings) throw new ToolError('this device has no settings to change', 'UNSUPPORTED');
        if (name === 'restore') {
          const { restored, failed } = await restoreConditions(s);
          const t = [
            restored.length > 0 ? `restored ${restored.join('; ')}` : 'nothing was changed',
            ...failed.map((f) => `could not restore ${f}`),
          ].join('\n');
          return reply(t, { done: t, ...(failed.length > 0 && { notRestored: failed }) });
        }
        if (name === 'push') {
          if (!value) throw new ToolError('push needs value: the text');
          const pkg = app ?? s.appId;
          if (pkg) checkApp(policy, pkg);
          await settings.push(pkg, title ?? 'appdyno', value).catch(refused);
          return reply(`posted a notification`, { done: 'posted a notification' });
        }
        if (name === 'biometric') {
          if (value !== 'match' && value !== 'nomatch')
            throw new ToolError('biometric needs value: match or nomatch');
          await settings.biometric(value === 'match').catch(refused);
          return reply(`biometric: ${value}`, { done: `biometric: ${value}` });
        }
        if (name === 'fold') {
          if (value !== 'open' && value !== 'closed')
            throw new ToolError('fold needs value: open or closed');
          await settings.fold(value === 'closed').catch(refused);
          s.acted();
          return reply(`fold: ${value}`, { done: `fold: ${value}` });
        }
        if (name === 'call') {
          const m = /^(end )?(\+?\d{3,20})$/.exec(value ?? '');
          if (!m)
            throw new ToolError('call needs value: a phone number; end and the number hangs up');
          await settings.call(m[2]!, !!m[1]).catch(refused);
          s.acted();
          const t = m[1] ? `the call from ${m[2]} ended` : `a call from ${m[2]} is coming in`;
          return reply(t, { done: t });
        }
        if (name === 'sms') {
          const from = title ?? DEFAULT_SENDER;
          if (!value) throw new ToolError('sms needs value: the text');
          if (!PHONE_NUMBER.test(from))
            throw new ToolError('sms needs title: the phone number it comes from');
          await settings.sms(from, value).catch(refused);
          s.acted();
          return reply(`an SMS came from ${from}`, { done: `an SMS came from ${from}` });
        }
        const pkg = app ?? (name === 'locale' ? s.appId : undefined);
        if (pkg) checkApp(policy, pkg);
        if (value === undefined) {
          const now = await settings.get(name, pkg).catch(refused);
          const t = `${name}: ${now}`;
          return reply(clean(t), { done: clean(t), value: now });
        }
        await setCondition(s, name, value, pkg).catch(refused);
        s.acted();
        const t = `${name}: ${value}`;
        return reply(t, { done: t, value, changed: { [name]: value } });
      },
    }),
    defineOp({
      name: 'clipboard',
      title: 'Clipboard',
      description: 'Read the clipboard; with text, put it there (for paste tests).',
      input: z.object({ text: z.string().min(1).max(2_000).optional() }).strict(),
      output: DoneOut,
      annotations: ACT,
      run: async ({ text: value }) => {
        const s = await ctx.session();
        if (value === undefined) {
          const now = await s.device.getClipboard().catch(refused);
          const shown = now === undefined ? 'the clipboard is empty' : clean(now);
          return reply(shown, { done: shown });
        }
        if (policy.secrets.some((x) => x && value.includes(x)))
          throw new ToolError('a secret is never put on the clipboard');
        await s.device.setClipboard(value).catch(refused);
        const done = `on the clipboard (${Array.from(value).length} characters)`;
        return reply(done, { done });
      },
    }),
  ];
}
