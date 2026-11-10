#!/usr/bin/env node
// appdyno: the MCP server (`appdyno mcp`), devices, doctor, bench. Output on stdout, diagnostics on stderr; in
// `mcp` stdout is the MCP channel, so logs go to stderr only.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  iosProducts,
  iphoneProvider,
  pruneIosBuilds,
  simulatorProvider,
} from '@appdyno/driver-apple';
import {
  askOnTerminal,
  clientNamed,
  cliSessionFile,
  commandsFor,
  deviceFlag,
  installCheck,
  listOf,
  manifestOf,
  serverOf,
  takeFlag,
} from '@appdyno/cli';
import { must } from '@appdyno/core';
import { writeComment, writeDashboard } from '@appdyno/perf';
import {
  ServerContext,
  envValues,
  flowFiles,
  flowsFor,
  flowsTagged,
  JOURNEY_ITERATIONS,
  opsFor,
  paramsOf,
  survey,
} from '@appdyno/ops';
import { runHub, runMirrors } from '@appdyno/hub';
import { endWithHub } from './lifetime.js';
import { alertOf } from './alert.js';
import { benchmark, appdynoDriver, table, type BenchResult } from './bench.js';
import { doctor } from './doctor.js';
import { hubServices } from './hub-services.js';
import { hubCommand, mirrorCommand } from './mirror-args.js';
import { pairCommand } from './pair.js';
import { pushCommand } from './push-setup.js';
import { deviceProviders as providers } from './providers.js';
import { COMMANDS, commandList, helpFor, usage } from './usage.js';
import { SERVER_INFO } from '@appdyno/mcp';
import { allowFlags, policyOf, serveCommand, type ServerFlags } from './serve.js';
import {
  devicesCommand,
  installCommand,
  pathCommand,
  toolsCommand,
  updateCommand,
} from './setup.js';
import { flightCommand, timelineCommand } from './timeline.js';

const [command, ...rest] = process.argv.slice(2);
const err = (s: string) => process.stderr.write(`${s}\n`);
/** The tool's own `mirror`, which `appdyno mirror` hands what is not a window's. */
const mirrorTool = (ctx: ServerContext, words: string[]) =>
  must(commandsFor(opsFor(ctx)).mirror, 'the mirror command').run(words, {
    out: (s) => console.log(s),
    err,
  });
/** This package's own folder: `dist` and `src` both sit in it. */
const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
/** The operations' context, from flags and the environment. */
function contextFrom(values: ServerFlags, remember?: string) {
  const env = process.env;
  const policy = policyOf(values, env);
  const device = values.device ?? env.APPDYNO_SERIAL;
  const app = values.app ?? env.APPDYNO_APP;
  const animations = values.animations ?? env.APPDYNO_ANIMATIONS;
  if (animations !== undefined && animations !== 'on' && animations !== 'off')
    throw new Error(`--animations takes on or off, not ${animations}`);
  const limit = values['trace-limit-gb'] ?? env.APPDYNO_TRACE_LIMIT_GB;
  const traceLimitGb = limit === undefined ? undefined : Number(limit);
  if (traceLimitGb !== undefined && !(traceLimitGb >= 0))
    throw new Error(`--trace-limit-gb takes a number of GB, not ${String(limit)}`);
  const flight = values['flight-seconds'] ?? env.APPDYNO_FLIGHT_SECONDS;
  const flightSeconds = flight === undefined ? undefined : Number(flight);
  if (flightSeconds !== undefined && !(flightSeconds > 0))
    throw new Error(`--flight-seconds takes a number of seconds, not ${String(flight)}`);
  const installAnswers = {
    prompts: !(values['no-install-consent'] || env.APPDYNO_NO_INSTALL_CONSENT === '1'),
    warnings:
      values['accept-install-warnings'] === true || env.APPDYNO_ACCEPT_INSTALL_WARNINGS === '1',
  };
  const alertPerson = alertOf(values.silent);
  return new ServerContext(policy, providers(values.takeover, animations, installAnswers), {
    ...(device && { device }),
    ...(app && { app }),
    ...(values.measurements && { measurements: values.measurements }),
    ...(traceLimitGb !== undefined && { traceLimitGb }),
    ...(flightSeconds !== undefined && { flightSeconds }),
    ...((values['full-urls'] || env.APPDYNO_FULL_URLS === '1') && { fullUrls: true }),
    // a run kept in a folder of its own says nothing of the traces here
    ...(!values.measurements && { autoPrune: true }),
    ...(remember && { remember }),
    claims: true,
    tool: remember ? 'appdyno cli' : 'appdyno mcp',
    ...((values.share || env.APPDYNO_SHARE === '1') && { share: true }),
    // a silent server sounds nowhere: a window that shows its request is told so
    ...(alertPerson ? { alertPerson } : { silent: true }),
    clientNamed,
    mirrorCommand: [
      process.execPath,
      fileURLToPath(import.meta.url),
      'mirror',
      ...(values.takeover ? ['--takeover'] : []),
    ],
  });
}

/** What the hub's AI Clients and Help ask of this Mac: the same checks and entries as `doctor` and `install`. */
const servicesOfHub = (ctx: ServerContext) => {
  const server = serverOf(root, manifestOf(root).name);
  return hubServices({
    home: homedir(),
    env: process.env,
    ...(server && { server }),
    // the hub's own lists, by flag or variable, hold for the server it starts for a tunnel
    mcpCommand: [
      process.execPath,
      fileURLToPath(import.meta.url),
      'mcp',
      ...allowFlags(ctx.policy),
    ],
    doctor: async () => [installCheck(root), ...(await doctor({ providers: providers() }))],
    self: [process.execPath, fileURLToPath(import.meta.url)],
    providers: providers(),
    measurements: ctx.measurementsDir,
    allowed: (serial) => ctx.allowed(serial),
  });
};

/** `perf dashboard`: no device; `--out` and `--open` are this command's alone, not the tool's. */
async function dashboardCommand(args: string[]) {
  const { values } = parseArgs({ args, options: COMMANDS['perf dashboard'].flags });
  const ctx = contextFrom(values);
  const file = await writeDashboard(ctx.measurementsDir, ctx.perfDir, {
    ...(values.app && { app: values.app }),
    ...(values.out && { out: resolve(values.out) }),
  });
  ctx.close();
  console.log(file);
  if (values.open) execFileSync('open', [file]);
  return 0;
}

/** `perf comment`: no device, and nothing is posted: what the gate kept, as a file for the person's own CI. */
async function commentCommand(args: string[]) {
  const { values } = parseArgs({ args, options: COMMANDS['perf comment'].flags });
  if (!values.out) {
    err(usage('perf comment'));
    return 2;
  }
  const ctx = contextFrom(values);
  const file = await writeComment(ctx.measurementsDir, ctx.perfDir, resolve(values.out), {
    ...(values.app && { app: values.app }),
    ...(values.scenario && { scenario: values.scenario }),
    ...(values['device-class'] && { deviceClass: values['device-class'] }),
  });
  ctx.close();
  console.log(file);
  return 0;
}

/** `perf survey`: every measure on one device, then the page; exit 1 only when nothing could be read. */
async function surveyCommand(args: string[]) {
  const { values } = parseArgs({ args, options: COMMANDS['perf survey'].flags });
  if (!values.app) {
    err(usage('perf survey'));
    return 2;
  }
  const ctx = contextFrom(values, cliSessionFile());
  try {
    const { read } = await survey(ctx, values.app, (line) => console.log(line));
    return read > 0 ? 0 : 1;
  } finally {
    await ctx.end().catch(() => []);
    ctx.close();
  }
}

async function main(): Promise<number> {
  if (['version', '--version', '-v'].includes(command ?? '')) {
    console.log(SERVER_INFO.version);
    return 0;
  }
  const help = helpFor(command, rest);
  if (help) {
    console.log(help);
    return 0;
  }
  switch (command) {
    case 'mirror':
      return mirrorCommand(rest, {
        context: contextFrom,
        tool: mirrorTool,
        windows: runMirrors,
      });
    case 'hub':
      return hubCommand(rest, {
        context: contextFrom,
        hub: (ctx, run) => runHub(ctx, { ...run, services: servicesOfHub(ctx) }),
      });
    case 'pair':
      return pairCommand(rest);
    case 'timeline':
      return timelineCommand(rest, contextFrom);
    case 'flight':
      return flightCommand(rest, contextFrom);
    case 'mcp': {
      await serveCommand(rest, contextFrom);
      return 0;
    }
    case 'devices':
      return devicesCommand(rest, providers());
    case 'path':
      return pathCommand(rest, root, err);
    case 'tools':
      return toolsCommand(rest, err);
    case 'ios': {
      if (rest[0] !== 'build') {
        err(usage('ios build'));
        return 2;
      }
      // both runners now, so a device session never waits for a build
      for (const kind of ['simulator', 'device'] as const)
        console.log(`${kind}: ${(await iosProducts(kind)) ?? 'no packaged sources'}`);
      console.log(`older builds removed: ${await pruneIosBuilds()}`);
      return 0;
    }
    case 'install':
      return installCommand(rest, root, err);
    case 'update':
      return updateCommand(rest, root);
    case 'doctor': {
      const { values } = parseArgs({ args: rest, options: COMMANDS.doctor.flags });
      const checks = [
        installCheck(root),
        ...(await doctor({
          providers: providers(),
          ...(values.serial && { serial: values.serial }),
        })),
      ];
      for (const c of checks)
        console.log(
          `${c.ok ? 'ok  ' : c.warn ? 'warn' : 'FAIL'} ${c.name}: ${c.detail}${c.fix ? `\n     fix: ${c.fix}` : ''}`,
        );
      return checks.some((c) => !c.ok && !c.warn) ? 1 : 0;
    }
    case 'test': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: COMMANDS.test.flags,
      });
      const iterations = Number(values.iterations ?? JOURNEY_ITERATIONS);
      const retries = Number(values.retries ?? 0);
      if (
        positionals.length === 0 ||
        !Number.isInteger(iterations) ||
        iterations < 1 ||
        !Number.isInteger(retries) ||
        retries < 0
      ) {
        err(usage('test'));
        return 2;
      }
      const artifacts = values.artifacts ?? 'appdyno-artifacts';
      const ctx = contextFrom({
        ...(values.share && { share: true }),
        ...(values.measurements && { measurements: values.measurements }),
      });
      try {
        const { passed } = await flowsFor(ctx).test({
          files: flowsTagged(flowFiles(positionals), values.tag, values['exclude-tag']),
          devices: values.device ?? [],
          artifacts,
          junit: values.junit ?? join(artifacts, 'junit.xml'),
          params: {
            ...(values['env-file'] && envValues(values['env-file'])),
            ...paramsOf(values.param),
          },
          retries,
          ...(values.measure && { iterations }),
          log: (line) => console.log(line),
        });
        return passed ? 0 : 1;
      } finally {
        await ctx.end().catch(() => []);
        ctx.close();
      }
    }
    case 'bench': {
      const { values } = parseArgs({ args: rest, options: COMMANDS.bench.flags });
      const serial = values.serial;
      if (!serial) {
        err('--serial is required (never a default: other devices may be attached)');
        return 2;
      }
      if ([simulatorProvider(), iphoneProvider()].some((p) => p.handles(serial))) {
        err(`bench drives an Android device: ${serial} is an iOS one`);
        return 2;
      }
      const maxLoad = Number(values['max-load'] ?? 4);
      if (must(loadavg()[0], "the host's load") > maxLoad) {
        err(
          `host load ${must(loadavg()[0], "the host's load").toFixed(2)} is over ${maxLoad}: run the benchmark on a quiet machine`,
        );
        return 3;
      }
      const results: BenchResult[] = [
        await benchmark(appdynoDriver(serial), serial, { n: Number(values.n ?? 50), log: err }),
      ];
      if (values.out) await writeFile(values.out, JSON.stringify(results, null, 2));
      console.log(table(results));
      for (const r of results)
        console.log(
          `\n${r.driver}: before ${JSON.stringify(r.before)}\n${r.driver}: after ${JSON.stringify(r.after)}`,
        );
      return 0;
    }
    default: {
      if (command === 'perf' && rest[0] === 'dashboard') return dashboardCommand(rest.slice(1));
      if (command === 'perf' && rest[0] === 'survey') return surveyCommand(rest.slice(1));
      if (command === 'perf' && rest[0] === 'comment') return commentCommand(rest.slice(1));
      // `push setup` keeps a push service's credentials; any other `push` is the tool's
      if (command === 'push' && rest[0] === 'setup') return pushCommand(rest);
      // `perf compare|baseline|budget [flags]`: the gate's names for one operation
      const gate = command === 'perf' ? rest.shift() : undefined;
      if (
        command === 'perf' &&
        !['compare', 'why', 'reference', 'baseline', 'budget', 'functions', 'prune'].includes(
          gate ?? '',
        )
      ) {
        err(usage('perf '));
        return 2;
      }
      if (gate) rest.push('--action', gate);
      const name = gate ? 'perf-compare' : command;
      const device = deviceFlag(command, rest);
      // use-device has its own flag of that name
      const shareAt = command === 'use-device' ? -1 : rest.indexOf('--share');
      if (shareAt >= 0) rest.splice(shareAt, 1);
      const measurements = takeFlag(rest, 'measurements');
      const ctx = contextFrom(
        {
          ...(device && { device }),
          ...(shareAt >= 0 && { share: true }),
          ...(measurements && { measurements }),
        },
        cliSessionFile(),
      );
      const ops = opsFor(ctx);
      const commands = commandsFor(ops);
      const op = name === undefined ? undefined : commands[name];
      if (!op) {
        const asked = command === undefined || ['--help', '-h', 'help'].includes(command);
        (asked ? console.log : err)(
          `usage: appdyno <command> [flags]; appdyno <command> --help for its flags

commands:
${commandList()}

operations (--device S selects the device, also for the next commands in this folder; flow: appdyno flow run a.flow --from 3 --param NAME=value --env-file F):
${listOf(ops)}`,
        );
        return asked ? 0 : 2;
      }
      try {
        // piped words are no person: what would ask them is refused, but for --yes
        const ask = process.stdin.isTTY ? askOnTerminal : undefined;
        return await op.run(rest, { out: (s) => console.log(s), err, ...(ask && { ask }) });
      } finally {
        ctx.close();
      }
    }
  }
}

endWithHub();
process.exitCode = await main().catch((e: unknown) => {
  // a failure the user can act on: its message and hint, not a stack trace
  const d = e as { message?: string; hint?: string };
  err(`appdyno: ${d.message ?? String(e)}${d.hint ? `\n  ${d.hint}` : ''}`);
  return 1;
});
