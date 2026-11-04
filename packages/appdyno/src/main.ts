#!/usr/bin/env node
// appdyno: the MCP server over stdio (`appdyno mcp`), devices, doctor, bench. Output on stdout, diagnostics
// on stderr; in `mcp` stdout is the MCP channel, so logs go to stderr only.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { homedir, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Adb, androidProvider, installTools, type InstallAnswers } from '@appdyno/driver-android';
import { appleProvider, iosProducts, pruneIosBuilds } from '@appdyno/driver-apple';
import { createServer } from '@appdyno/mcp';
import { cliSessionFile, commandsFor, deviceFlag, install, listOf, takeFlag } from '@appdyno/cli';
import { writeDashboard } from '@appdyno/perf';
import {
  DEFAULT_POLICY,
  ServerContext,
  envValues,
  flowFiles,
  flowsFor,
  flowsTagged,
  JOURNEY_ITERATIONS,
  opsFor,
  paramsOf,
  survey,
  type Policy,
} from '@appdyno/ops';
import { benchmark, appdynoDriver, loadDriver, table, type BenchResult } from './bench.js';
import { doctor } from './doctor.js';
import { endWithClient } from './lifetime.js';

const [command, ...rest] = process.argv.slice(2);
const err = (s: string) => process.stderr.write(`${s}\n`);
const providers = (
  takeover = false,
  animations?: 'on' | 'off',
  installAnswers?: InstallAnswers,
) => [
  androidProvider(new Adb(), {
    takeover,
    ...(animations && { animations }),
    ...(installAnswers && { installAnswers }),
  }),
  appleProvider(),
];

type Settings = {
  device?: string;
  app?: string;
  'allow-devices'?: string;
  'allow-apps'?: string;
  'allow-urls'?: string;
  'no-home'?: boolean;
  takeover?: boolean;
  share?: boolean;
  measurements?: string;
  'trace-limit-gb'?: string;
  animations?: string;
  'no-install-consent'?: boolean;
  'accept-install-warnings'?: boolean;
};

/** The operations' context, from flags and the environment. */
function contextFrom(values: Settings, remember?: string) {
  const env = process.env;
  const list = (s: string | undefined) =>
    (s ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const regex = (s: string | undefined) => (s ? new RegExp(s) : undefined);
  const devices = regex(values['allow-devices'] ?? env.APPDYNO_ALLOW_DEVICES);
  const urls = regex(values['allow-urls'] ?? env.APPDYNO_ALLOW_URLS);
  const policy: Policy = {
    ...DEFAULT_POLICY,
    ...(devices && { devices }),
    ...(urls && { urls }),
    apps: list(values['allow-apps'] ?? env.APPDYNO_ALLOW_APPS),
    allowHome: !values['no-home'],
    secrets: list(env.APPDYNO_SECRETS),
  };
  const device = values.device ?? env.APPDYNO_SERIAL;
  const app = values.app ?? env.APPDYNO_APP;
  const animations = values.animations ?? env.APPDYNO_ANIMATIONS;
  if (animations !== undefined && animations !== 'on' && animations !== 'off')
    throw new Error(`--animations takes on or off, not ${animations}`);
  const limit = values['trace-limit-gb'] ?? env.APPDYNO_TRACE_LIMIT_GB;
  const traceLimitGb = limit === undefined ? undefined : Number(limit);
  if (traceLimitGb !== undefined && !(traceLimitGb >= 0))
    throw new Error(`--trace-limit-gb takes a number of GB, not ${limit}`);
  const installAnswers = {
    prompts: !(values['no-install-consent'] || env.APPDYNO_NO_INSTALL_CONSENT === '1'),
    warnings:
      values['accept-install-warnings'] === true || env.APPDYNO_ACCEPT_INSTALL_WARNINGS === '1',
  };
  return new ServerContext(policy, providers(values.takeover, animations, installAnswers), {
    ...(device && { device }),
    ...(app && { app }),
    ...(values.measurements && { measurements: values.measurements }),
    ...(traceLimitGb !== undefined && { traceLimitGb }),
    // a run kept in a folder of its own says nothing of the traces here
    ...(!values.measurements && { autoPrune: true }),
    ...(remember && { remember }),
    claims: true,
    tool: remember ? 'appdyno cli' : 'appdyno mcp',
    ...((values.share || env.APPDYNO_SHARE === '1') && { share: true }),
  });
}

/** The MCP server over stdio, until its client closes stdin or a signal ends it. */
async function serveMcp(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      device: { type: 'string' },
      app: { type: 'string' },
      'allow-devices': { type: 'string' },
      'allow-apps': { type: 'string' },
      'allow-urls': { type: 'string' },
      'no-home': { type: 'boolean' },
      takeover: { type: 'boolean' },
      share: { type: 'boolean' },
      animations: { type: 'string' },
      measurements: { type: 'string' },
      'trace-limit-gb': { type: 'string' },
      'no-install-consent': { type: 'boolean' },
      'accept-install-warnings': { type: 'boolean' },
    },
  });
  const ctx = contextFrom(values);
  const log = (line: object) =>
    process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), ...line })}\n`);
  endWithClient(ctx, log);
  await createServer(opsFor(ctx), log).connect(new StdioServerTransport());
}

/** `perf dashboard`: no device; `--out` and `--open` are this command's alone, not the tool's. */
async function dashboardCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      app: { type: 'string' },
      out: { type: 'string' },
      open: { type: 'boolean' },
      measurements: { type: 'string' },
    },
  });
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

/** `perf survey`: every measure on one device, then the page; exit 1 only when nothing could be read. */
async function surveyCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      app: { type: 'string' },
      device: { type: 'string' },
      measurements: { type: 'string' },
      share: { type: 'boolean' },
    },
  });
  if (!values.app) {
    err('usage: appdyno perf survey --app A [--device S] [--measurements dir] [--share]');
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
  switch (command) {
    case 'mcp': {
      await serveMcp(rest);
      return 0;
    }
    case 'devices': {
      for (const provider of providers())
        for (const d of await provider.list())
          console.log(`${d.serial}\t${d.state}\t${d.model ?? ''}`);
      return 0;
    }
    case 'tools': {
      if (rest[0] !== 'install') {
        err('usage: appdyno tools install');
        return 2;
      }
      console.log(await installTools(err));
      return 0;
    }
    case 'ios': {
      if (rest[0] !== 'build') {
        err('usage: appdyno ios build');
        return 2;
      }
      // both runners now, so a device session never waits for a build
      for (const kind of ['simulator', 'device'] as const)
        console.log(`${kind}: ${(await iosProducts(kind)) ?? 'no packaged sources'}`);
      console.log(`older builds removed: ${await pruneIosBuilds()}`);
      return 0;
    }
    case 'install': {
      const { values } = parseArgs({
        args: rest,
        options: {
          yes: { type: 'boolean', short: 'y' },
          remove: { type: 'boolean' },
          'dry-run': { type: 'boolean' },
        },
      });
      const { stdin: input, stdout: output } = process;
      const terminal = input.isTTY ? createInterface({ input, output }) : undefined;
      try {
        return await install({
          home: homedir(),
          env: process.env,
          yes: values.yes,
          remove: values.remove,
          dryRun: values['dry-run'],
          ask: terminal && ((question) => terminal.question(question)),
          out: (line) => console.log(line),
          err,
        });
      } finally {
        terminal?.close();
      }
    }
    case 'doctor': {
      const { values } = parseArgs({ args: rest, options: { serial: { type: 'string' } } });
      const checks = await doctor({
        providers: providers(),
        ...(values.serial && { serial: values.serial }),
      });
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
        options: {
          device: { type: 'string', multiple: true },
          param: { type: 'string', multiple: true },
          'env-file': { type: 'string' },
          tag: { type: 'string', multiple: true },
          'exclude-tag': { type: 'string', multiple: true },
          artifacts: { type: 'string' },
          junit: { type: 'string' },
          share: { type: 'boolean' },
          measure: { type: 'boolean' },
          iterations: { type: 'string' },
          retries: { type: 'string' },
          measurements: { type: 'string' },
        },
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
        err(
          'usage: appdyno test <dir or files> [--device S]... [--param NAME=value]... [--env-file F] [--tag T]... [--exclude-tag T]... [--artifacts dir] [--junit file] [--retries N] [--measure [--iterations N] [--measurements dir]]',
        );
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
      const { values } = parseArgs({
        args: rest,
        options: {
          serial: { type: 'string' },
          driver: { type: 'string', multiple: true },
          n: { type: 'string' },
          out: { type: 'string' },
          'max-load': { type: 'string' },
        },
      });
      const serial = values.serial;
      if (!serial) {
        err('--serial is required (never a default: other devices may be attached)');
        return 2;
      }
      const maxLoad = Number(values['max-load'] ?? 4);
      if (loadavg()[0]! > maxLoad) {
        err(
          `host load ${loadavg()[0]!.toFixed(2)} is over ${maxLoad}: run the benchmark on a quiet machine`,
        );
        return 3;
      }
      const results: BenchResult[] = [];
      const drivers = values.driver?.length ? values.driver : ['appdyno'];
      for (const name of drivers) {
        const driver = name === 'appdyno' ? appdynoDriver(serial) : await loadDriver(name, serial);
        err(`driver ${driver.name}`);
        results.push(await benchmark(driver, serial, { n: Number(values.n ?? 50), log: err }));
      }
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
      // `perf compare|baseline|budget [flags]`: the gate's names for one operation
      const gate = command === 'perf' ? rest.shift() : undefined;
      if (
        command === 'perf' &&
        !['compare', 'baseline', 'budget', 'functions', 'prune'].includes(gate ?? '')
      ) {
        err(
          'usage: appdyno perf compare|baseline|budget [--app A] [--scenario S] [--device-class C] [--last N] [--replace] [--format text|json|junit]\n       appdyno perf functions --from pm-a --to pm-b\n       appdyno perf prune [--limit-gb N] [--dry-run]\n       appdyno perf dashboard [--app A] [--out dir] [--open]\n       appdyno perf survey --app A [--device S]',
        );
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
  mcp [--device S] [--app A] [--allow-devices RE] [--allow-apps a,b] [--allow-urls RE] [--no-home] [--takeover] [--share] [--animations on|off] [--measurements dir] [--trace-limit-gb N] [--no-install-consent] [--accept-install-warnings]
                   the MCP server over stdio
  install [--yes] [--dry-run] [--remove]
                   add this server to the MCP clients on this Mac, or take it out
  devices          the connected Android devices
  test <dir or files> [--device S]... [--param NAME=value]... [--env-file F] [--tag T]... [--exclude-tag T]... [--artifacts dir] [--junit file] [--retries N] [--measure [--iterations N]]
                   replay flows, one after another, on each device; --retries runs a failed file again and calls it flaky; --measure keeps each as a scenario, by step
  doctor [--serial S]
                   what this machine and that device lack
  ios build        build the iOS runners now
  tools install    download the trace tools
  bench --serial S [--driver appdyno|<module>]... [--n 50] [--out file]
  perf compare|baseline|budget [--app A] [--scenario S] [--format text|json|junit] [--measurements dir]
                   the performance gate: non-zero on a regression or a broken budget
  perf functions --from pm-a --to pm-b [--measurements dir]
                   which functions moved between two kept profiles
  perf prune [--limit-gb N] [--dry-run] [--measurements dir]
                   kept traces and heap dumps down to the limit, 10 GB by default
  perf dashboard [--app A] [--out dir] [--open] [--measurements dir]
                   one page: what can be read on each device, what changed, what needs attention
  perf survey --app A [--device S] [--measurements dir]
                   every measure on that device in turn, then the page

operations (--device S selects the device, also for the next commands in this folder; flow: appdyno flow run a.flow --from 3 --param NAME=value --env-file F):
${listOf(ops)}`,
        );
        return asked ? 0 : 2;
      }
      try {
        return await op.run(rest, { out: (s) => console.log(s), err });
      } finally {
        ctx.close();
      }
    }
  }
}

process.exitCode = await main().catch((e: unknown) => {
  // a failure the user can act on: its message and hint, not a stack trace
  const d = e as { message?: string; hint?: string };
  err(`appdyno: ${d.message ?? String(e)}${d.hint ? `\n  ${d.hint}` : ''}`);
  return 1;
});
