import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  readState,
  reportProgress,
  stateDir,
  updateState,
  type Startable,
  type VirtualDevices,
} from '@appdyno/core';
import { z } from 'zod';
import type { Answers } from './answers.js';
import { holder } from './claims.js';
import type { ServerContext } from './context.js';
import { checkApp, checkDevice } from './policy.js';
import { AppOut, DoneOut, VirtualOut } from './schemas.js';
import type { Session } from './session.js';
import { Read } from './step-schemas.js';
import { ACT, defineOp, DESTRUCTIVE, reply, ToolError } from './tool.js';

const NO_APP = 'give app (or select one with use_device)';

/** App data can hold secrets, and a copy must not land among a person's files: a new or empty folder, for this user alone. */
function emptyFolder(path: string | undefined) {
  if (!path) throw new ToolError('download_data needs path', 'INVALID_ARGUMENT');
  const to = resolve(path);
  if (existsSync(to) && (!statSync(to).isDirectory() || readdirSync(to).length > 0))
    throw new ToolError(`${to} must be a new or empty folder`, 'INVALID_ARGUMENT');
  mkdirSync(to, { recursive: true, mode: 0o700 });
  return to;
}

function dataFolder(path: string | undefined) {
  if (!path) throw new ToolError('replace_data needs path', 'INVALID_ARGUMENT');
  const from = resolve(path);
  if (!existsSync(from) || !statSync(from).isDirectory())
    throw new ToolError(`${from} is not a folder`, 'INVALID_ARGUMENT');
  return from;
}

const Started = z.array(z.string());
const startedFile = () => join(stateDir(), 'started.json');

/** Every virtual device of every driver, with the driver that has it. */
async function virtuals(ctx: ServerContext) {
  const out: { d: Startable; on: VirtualDevices }[] = [];
  for (const p of ctx.providers) {
    if (!p.virtual) continue;
    const found = await p.virtual.startable().catch(() => [] as Startable[]);
    out.push(...found.map((d) => ({ d, on: p.virtual! })));
  }
  return out;
}

async function namedVirtual(ctx: ServerContext, id: string) {
  const all = await virtuals(ctx);
  const hits = all.filter(
    (x) => x.d.id === id || x.d.serial === id || x.d.name === id || x.d.name.startsWith(`${id} (`),
  );
  if (hits.length === 1) return hits[0]!;
  throw new ToolError(
    hits.length === 0
      ? `no simulator or emulator is named ${id} (action list)`
      : `more than one is named ${id}: ${hits.map((x) => x.d.id).join(', ')}`,
    hits.length === 0 ? 'NOT_FOUND' : 'AMBIGUOUS',
  );
}

function appOp(ctx: ServerContext, { afterChange }: Answers) {
  const { policy } = ctx;
  const appOf = (s: Session, app?: string) => {
    const pkg = checkApp(policy, app ?? s.appId ?? '');
    if (!pkg) throw new ToolError(NO_APP, 'INVALID_ARGUMENT');
    return pkg;
  };
  return defineOp({
    name: 'app',
    title: 'App management',
    description:
      'list (all: with system apps), state, install (path: .apk, .app or .ipa), uninstall, clear, grant, revoke (service), launch (restarts it with args, env; Android args: key=value extras), download_data, replace_data (path: a folder; stops the app), build_and_run (path: Xcode project or Gradle folder; scheme, or Gradle module; configuration, or variant).',
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
          'download_data',
          'replace_data',
          'build_and_run',
        ]),
        app: z.string().max(200).optional(),
        path: z.string().max(1_000).optional(),
        service: z.string().max(80).optional(),
        scheme: z.string().max(200).optional(),
        configuration: z.string().max(100).optional(),
        args: z.array(z.string().max(500)).max(50).optional(),
        env: z.record(z.string(), z.string().max(1_000)).optional(),
        all: z.boolean().default(false),
        read: Read,
      })
      .strict(),
    output: AppOut,
    annotations: DESTRUCTIVE,
    run: async ({ action, app, path, service, scheme, configuration, args, env, all, read }) => {
      const s = await ctx.session();
      const { apps } = s.device;
      const done = (t: string, extra: Record<string, unknown> = {}) =>
        reply(t, { done: t, ...extra });
      switch (action) {
        case 'list': {
          const list = await apps.listApps(all);
          return done(
            list
              .map(
                (a) => `${a.id}${a.name ? ` "${a.name}"` : ''}${a.version ? ` ${a.version}` : ''}`,
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
              : await apps.appState(pkg);
          return done(`${pkg}: ${state}`, { state });
        }
        case 'install': {
          if (!path) throw new ToolError('install needs path', 'INVALID_ARGUMENT');
          // the allowlist names apps, and a file's app is not known before it is installed
          if (policy.apps.length > 0)
            throw new ToolError(
              'install is off while this server has an app allowlist',
              'POLICY_DENIED',
            );
          reportProgress(`installing ${path}`);
          const said = await apps.install(path);
          if (said.length > 0) s.acted();
          // what it answered on the device is part of what happened: no read mode shortens this
          return done([`installed ${path}`, ...said].join('\n'));
        }
        case 'build_and_run': {
          if (!path) throw new ToolError('build_and_run needs path', 'INVALID_ARGUMENT');
          // a project's build runs its own scripts, and what it installs is not known before
          if (policy.apps.length > 0)
            throw new ToolError(
              'build_and_run is off while this server has an app allowlist',
              'POLICY_DENIED',
            );
          reportProgress(`building ${path}`);
          const pkg = await apps.buildAndInstall({
            project: path,
            ...(scheme && { scheme }),
            ...(configuration && { configuration }),
          });
          reportProgress(`launching ${pkg}`);
          await apps.launchWith(pkg, { ...(args && { args }), ...(env && { env }) });
          return afterChange(s, `built and launched ${pkg}`, read, true);
        }
        case 'launch': {
          const pkg = appOf(s, app);
          reportProgress(`launching ${pkg}`);
          await apps.launchWith(pkg, { ...(args && { args }), ...(env && { env }) });
          return afterChange(s, `launched ${pkg}`, read, true);
        }
        case 'grant':
        case 'revoke': {
          const pkg = appOf(s, app);
          if (!service) throw new ToolError(`${action} needs service`, 'INVALID_ARGUMENT');
          await apps.permission(pkg, action === 'grant', service);
          return done(`${action === 'grant' ? 'granted' : 'revoked'} ${service} for ${pkg}`);
        }
        case 'download_data': {
          const pkg = appOf(s, app);
          const to = emptyFolder(path);
          reportProgress(`copying the data of ${pkg}`);
          await apps.downloadData(pkg, to);
          return done(`the data of ${pkg} is in ${to}`);
        }
        case 'replace_data': {
          const pkg = appOf(s, app);
          const from = dataFolder(path);
          reportProgress(`replacing the data of ${pkg}`);
          await apps.replaceData(pkg, from);
          s.acted();
          s.appPid = undefined;
          return done(`the data of ${pkg} is now what ${from} holds`);
        }
        case 'uninstall':
        case 'clear': {
          const pkg = appOf(s, app);
          await (action === 'clear' ? apps.clearData(pkg) : apps.uninstall(pkg));
          s.acted();
          s.appPid = undefined;
          return done(`${action === 'clear' ? 'cleared the data of' : 'uninstalled'} ${pkg}`);
        }
      }
    },
  });
}

async function listVirtual(ctx: ServerContext, mine: string[]) {
  const devices = (await virtuals(ctx)).map(({ d }) => ({
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

async function createVirtual(ctx: ServerContext, device: string | undefined) {
  if (!device) throw new ToolError('create needs name: an iOS model', 'INVALID_ARGUMENT');
  const maker = ctx.providers.find((p) => p.virtual?.kind === 'simulator')?.virtual;
  if (!maker?.create)
    throw new ToolError(
      'this Mac has no driver that creates a simulator',
      'UNSUPPORTED',
      'an Android emulator is made with avdmanager or in Android Studio',
    );
  reportProgress(`creating a ${device}`);
  const id = await maker.create({ name: device, model: device, system: '' });
  checkDevice(ctx.policy, id);
  reportProgress(`starting ${device}`);
  const serial = await maker.boot(id);
  updateState(startedFile(), Started, (ids = []) => [...ids, id]);
  await ctx.use(serial);
  const removal = maker.removedBy ? `: ${maker.removedBy(id)} removes it` : '';
  const t = `a new ${device} is up and selected as ${serial}${removal}`;
  return reply(t, { done: t, serial });
}

async function bootVirtual(ctx: ServerContext, device: string | undefined) {
  if (!device)
    throw new ToolError('boot needs name: its id or name (action list)', 'INVALID_ARGUMENT');
  const { d, on } = await namedVirtual(ctx, device);
  checkDevice(ctx.policy, d.id);
  reportProgress(`starting ${d.name}`);
  const wasStopped = d.state === 'stopped';
  const serial = await on.boot(d.id);
  // an emulator is listed by its serial once it runs
  if (wasStopped) updateState(startedFile(), Started, (ids = []) => [...ids, d.id, serial]);
  const t = `${d.name} is up as ${serial}`;
  return reply(t, { done: t, serial });
}

async function shutDownVirtual(ctx: ServerContext, device: string | undefined, mine: string[]) {
  const targets = device
    ? [await namedVirtual(ctx, device)]
    : (await virtuals(ctx)).filter((x) => mine.includes(x.d.id) && x.d.state === 'running');
  if (targets.length === 0) {
    const t = 'none to shut down: this tool started none that still runs';
    return reply(t, { done: t });
  }
  for (const { d, on } of targets) {
    checkDevice(ctx.policy, d.id);
    const h = holder(d.serial ?? d.id);
    if (h && h.pid !== process.pid)
      throw new ToolError(
        `${d.id} is held by pid ${h.pid} (${h.tool}) since ${h.since}`,
        'DEVICE_CLAIMED',
      );
    reportProgress(`shutting down ${d.name}`);
    await ctx.forget(d.serial ?? d.id);
    await on.shutdown(d.id);
  }
  updateState(startedFile(), Started, (ids = []) =>
    ids.filter((id) => !targets.some((x) => x.d.id === id || x.d.name === id)),
  );
  const t = `shut down ${targets.map((x) => x.d.name).join(', ')}`;
  return reply(t, { done: t });
}

function simulatorOp(ctx: ServerContext) {
  return defineOp({
    name: 'simulator',
    title: 'Simulators and emulators',
    description:
      'Only on request. list (what can be started), boot (name: its id or name), create (name: an iOS model; starts and selects it), shutdown (name; none: those this tool started).',
    input: z
      .object({
        action: z.enum(['list', 'boot', 'create', 'shutdown']),
        name: z.string().max(100).optional(),
      })
      .strict(),
    output: VirtualOut,
    annotations: DESTRUCTIVE,
    run: async ({ action, name: device }) => {
      const mine = readState(startedFile(), Started) ?? [];
      if (action === 'list') return listVirtual(ctx, mine);
      if (action === 'create') return createVirtual(ctx, device);
      if (action === 'boot') return bootVirtual(ctx, device);
      return shutDownVirtual(ctx, device, mine);
    },
  });
}

function clipboardOp(ctx: ServerContext, { clean }: Answers) {
  return defineOp({
    name: 'clipboard',
    title: 'Clipboard',
    description: 'Read the clipboard; with text, put it there.',
    input: z.object({ text: z.string().min(1).max(2_000).optional() }).strict(),
    output: DoneOut,
    annotations: ACT,
    run: async ({ text: value }) => {
      const s = await ctx.session();
      if (value === undefined) {
        const now = await s.device.getClipboard();
        const shown = now === undefined ? 'the clipboard is empty' : clean(now);
        return reply(shown, { done: shown });
      }
      if (ctx.policy.secrets.some((x) => x && value.includes(x)))
        throw new ToolError('a secret is never put on the clipboard', 'POLICY_DENIED');
      await s.device.setClipboard(value);
      const done = `on the clipboard (${Array.from(value).length} characters)`;
      return reply(done, { done });
    },
  });
}

export const controlOps = (ctx: ServerContext, answers: Answers) => [
  appOp(ctx, answers),
  simulatorOp(ctx),
  clipboardOp(ctx, answers),
];
