import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { onLine, quoted, readState, reportProgress, stateDir, updateState } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';
import type { Answers } from './answers.js';
import { approve, approveBuild } from './approval.js';
import { heldText, holder } from './claims.js';
import type { ServerContext } from './context.js';
import { checkVirtual, namedVirtual, RanAs, ranAsFile, virtuals } from './device-names.js';
import { byPerson, checkApp, checkCreate, noApp, type Policy } from './policy.js';
import { AppOut, DoneOut, VirtualOut } from './schemas.js';
import type { Session } from './session.js';
import { Read } from './step-schemas.js';
import { ACT, defineOp, definePart, DESTRUCTIVE, reply, ToolError } from './tool.js';
import { inside } from './writes.js';

/** App data can hold secrets, and a copy must not land among a person's files: a new or empty folder, for this user alone. */
function emptyFolder(policy: Policy, path: string | undefined) {
  if (!path) throw new ToolError('download_data needs path', 'INVALID_ARGUMENT');
  const to = inside(policy, path);
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
function appOp(ctx: ServerContext, { changing, afterChange }: Answers) {
  const { policy } = ctx;
  const appOf = (s: Session, app?: string) => {
    const pkg = checkApp(policy, app ?? s.appId ?? '');
    if (!pkg) throw noApp();
    return pkg;
  };
  return definePart({
    name: 'app',
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
          'download_data',
          'replace_data',
          'build_and_run',
        ]),
        app: z.string().max(200).optional(),
        path: z.string().max(1_000).optional(),
        files: z.array(z.string().max(1_000)).min(1).max(50).optional(),
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
    run: async ({
      action,
      app,
      path,
      files,
      service,
      scheme,
      configuration,
      args,
      env,
      all,
      read,
    }) => {
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
                (a) =>
                  `${a.id}${a.name ? ` ${quoted(a.name)}` : ''}${a.version ? ` ${onLine(a.version)}` : ''}`,
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
          if (path && files)
            throw new ToolError('install takes path or files, not both', 'INVALID_ARGUMENT');
          // a list of one is the file by itself
          const given = files && files.length > 1 ? files : (files?.[0] ?? path);
          if (!given) throw new ToolError('install needs path, or files', 'INVALID_ARGUMENT');
          const named = [given].flat().join(', ');
          reportProgress(`installing ${named}`);
          // the driver reads the file's own id before it installs anything: the answer names it, an allowlist holds it
          let installed: string | undefined;
          const said = await apps.install(given, (id) => {
            installed = policy.apps.length > 0 ? checkApp(policy, id) : id;
          });
          if (said.length > 0) s.acted();
          // what it answered on the device is part of what happened: no read mode shortens this
          return done(
            [`installed ${installed ? `${installed} from ` : ''}${named}`, ...said].join('\n'),
            { ...(installed && { app: installed }) },
          );
        }
        case 'build_and_run': {
          if (!path) throw new ToolError('build_and_run needs path', 'INVALID_ARGUMENT');
          // a project's build runs its own scripts, and what it installs is not known before
          if (policy.apps.length > 0)
            throw new ToolError(
              'build_and_run is off while this server has an app allowlist',
              'POLICY_DENIED',
              byPerson('by starting it without --allow-apps'),
            );
          const project = inside(policy, path, true);
          await approveBuild(policy, s, project);
          reportProgress(`building ${project}`);
          const pkg = await apps.buildAndInstall({
            project,
            ...(scheme && { scheme }),
            ...(configuration && { configuration }),
          });
          reportProgress(`launching ${pkg}`);
          const { was } = await changing(s, () =>
            apps.launchWith(pkg, { ...(args && { args }), ...(env && { env }) }),
          );
          return afterChange(s, was, `built and launched ${pkg}`, read, pkg);
        }
        case 'grant':
        case 'revoke': {
          const pkg = appOf(s, app);
          if (!service) throw new ToolError(`${action} needs service`, 'INVALID_ARGUMENT');
          if (action === 'revoke' || apps.grantResets)
            await approve(policy, s, `manage_app ${action}`, pkg, service);
          const said = await apps.permission(pkg, action === 'grant', service);
          return done(
            said ?? `${action === 'grant' ? 'granted' : 'revoked'} ${service} for ${pkg}`,
          );
        }
        case 'download_data': {
          const pkg = appOf(s, app);
          const to = emptyFolder(policy, path);
          reportProgress(`copying the data of ${pkg}`);
          await apps.downloadData(pkg, to);
          return done(`the data of ${pkg} is in ${to}`);
        }
        case 'replace_data': {
          const pkg = appOf(s, app);
          const from = dataFolder(path);
          await approve(policy, s, 'transfer_files push', pkg);
          reportProgress(`replacing the data of ${pkg}`);
          await apps.replaceData(pkg, from);
          s.acted();
          s.forgetProcess();
          return done(`the data of ${pkg} is now what ${from} holds`);
        }
        case 'uninstall':
        case 'clear': {
          const pkg = appOf(s, app);
          await approve(policy, s, `manage_app ${action}`, pkg);
          await (action === 'clear' ? apps.clearData(pkg) : apps.uninstall(pkg));
          s.acted();
          s.forgetProcess();
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
  checkCreate(ctx.policy);
  reportProgress(`creating a ${device}`);
  const id = await maker.create({ name: device, model: device, system: '' });
  const removal = maker.removedBy ? `: ${maker.removedBy(id)} removes it` : '';
  try {
    reportProgress(`starting ${device}`);
    const serial = await maker.boot(id);
    updateState(startedFile(), Started, (ids = []) => [...ids, id]);
    await ctx.use(serial);
    const t = `a new ${device} is up and selected as ${serial}${removal}`;
    return reply(t, { done: t, serial });
  } catch (e) {
    // nothing here deletes a simulator: what failed says how a person removes the one it made
    throw new ToolError(
      `the new ${device} ${id} did not start: ${e instanceof Error ? e.message : String(e)}`,
      e instanceof ToolError || e instanceof DeviceError ? e.code : 'INTERNAL',
      `it stays on this Mac${removal}`,
    );
  }
}

async function bootVirtual(ctx: ServerContext, device: string | undefined) {
  if (!device)
    throw new ToolError('boot needs name: its id or name (action list)', 'INVALID_ARGUMENT');
  const x = await namedVirtual(ctx, device);
  const { d, on } = x;
  checkVirtual(ctx, x);
  reportProgress(`starting ${d.name}`);
  const wasStopped = d.state === 'stopped';
  const serial = await on.boot(d.id, x.ranAs);
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
  // what a boot would refuse is refused here, all of it before any goes off: none is left off that cannot come back
  for (const x of targets) {
    const { d } = x;
    checkVirtual(ctx, x);
    if (d.bootable === false)
      throw new ToolError(
        `${d.id} runs ${d.name}, which this Mac's emulator does not list, so boot could not start it again: it stays on`,
        'NOT_FOUND',
        'start the server with ANDROID_HOME and ANDROID_AVD_HOME naming the SDK and AVD folder it runs from',
      );
    const h = holder(d.serial ?? d.id);
    if (h && h.pid !== process.pid) throw new ToolError(heldText(d.id, h), 'DEVICE_CLAIMED');
  }
  updateState(ranAsFile(), RanAs, (was = {}) => ({
    ...was,
    ...Object.fromEntries(targets.flatMap(({ d }) => (d.serial ? [[d.name, d.serial]] : []))),
  }));
  // the selected device's session and its apps' state go with it: said before, as the description says it to the model
  const selected = targets
    .filter(({ d }) => (d.serial ?? d.id) === ctx.selected)
    .map(({ d }) => d.name);
  const restored: string[] = [];
  const failed: string[] = [];
  for (const { d, on } of targets) {
    const loses = selected.includes(d.name)
      ? ': the session on it ends, and what its apps hold'
      : '';
    reportProgress(`shutting down ${d.name}${loses}`);
    const back = await ctx.forget(d.serial ?? d.id);
    restored.push(...(back?.restored ?? []));
    failed.push(...(back?.failed ?? []));
    await on.shutdown(d.id);
  }
  updateState(startedFile(), Started, (ids = []) =>
    ids.filter((id) => !targets.some((x) => x.d.id === id || x.d.name === id)),
  );
  const lost = selected.join(', ');
  const t = [
    `shut down ${targets.map((x) => x.d.name).join(', ')}${lost && `: the session on ${lost} ended, and what its apps held with it`}`,
    ...(restored.length > 0
      ? [`what the session changed went back first: ${restored.join('; ')}`]
      : []),
    ...(failed.length > 0 ? [`could not put back ${failed.join('; ')}`] : []),
  ].join('; ');
  return reply(t, { done: t });
}

function simulatorOp(ctx: ServerContext) {
  return defineOp({
    name: 'manage_simulator',
    title: 'Simulators and emulators',
    description:
      'Start or stop an iOS simulator or Android emulator, only on request. list: what can be started; boot (name: id or name); create (name: an iOS model; boots and selects it); shutdown (name; none: those this tool started). Connected devices: list_devices. Returns the device.',
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
  return definePart({
    name: 'clipboard',
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
