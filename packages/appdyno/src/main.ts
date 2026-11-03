#!/usr/bin/env node
// appdyno: the MCP server over stdio (`appdyno mcp`), devices, doctor, bench. Output on stdout, diagnostics
// on stderr; in `mcp` stdout is the MCP channel, so logs go to stderr only.
import { writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Adb, androidProvider, installTools } from '@appdyno/driver-android';
import { appleProvider, iosProducts, pruneIosBuilds } from '@appdyno/driver-apple';
import { createServer } from '@appdyno/mcp';
import { commandsFor, deviceFlag, listOf, takeFlag } from '@appdyno/cli';
import { stateDir } from '@appdyno/core';
import { DEFAULT_POLICY, ServerContext, opsFor, type Policy } from '@appdyno/ops';
import { benchmark, appdynoDriver, loadDriver, table, type BenchResult } from './bench.js';
import { doctor } from './doctor.js';

const [command, ...rest] = process.argv.slice(2);
const err = (s: string) => process.stderr.write(`${s}\n`);
const providers = (takeover = false) => [androidProvider(new Adb(), { takeover }), appleProvider()];

type Settings = {
  device?: string;
  app?: string;
  'allow-devices'?: string;
  'allow-apps'?: string;
  'allow-urls'?: string;
  'no-home'?: boolean;
  takeover?: boolean;
  measurements?: string;
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
  return new ServerContext(policy, providers(values.takeover), {
    ...(device && { device }),
    ...(app && { app }),
    ...(values.measurements && { measurements: values.measurements }),
    ...(remember && { remember }),
  });
}

/** The MCP server over stdio, until its client closes stdin. */
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
      measurements: { type: 'string' },
    },
  });
  const ctx = contextFrom(values);
  const log = (line: object) =>
    process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), ...line })}\n`);
  process.stdin.once('close', () => {
    ctx.close();
    process.exit(0);
  });
  await createServer(opsFor(ctx), log).connect(new StdioServerTransport());
}

async function main(): Promise<number> {
  switch (command) {
    case 'mcp': {
      await serveMcp(rest);
      return 0;
    }
    case 'devices': {
      for (const d of await new Adb().devices())
        console.log(`${d.serial}\t${d.state}\t${d.props.model ?? ''}`);
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
      // `perf compare|baseline|budget [flags]`: the gate's names for one operation
      const gate = command === 'perf' ? rest.shift() : undefined;
      if (command === 'perf' && !['compare', 'baseline', 'budget'].includes(gate ?? '')) {
        err(
          'usage: appdyno perf compare|baseline|budget [--app A] [--scenario S] [--device-class C] [--last N] [--replace] [--format text|json|junit]',
        );
        return 2;
      }
      if (gate) rest.push('--action', gate);
      const name = gate ? 'perf-compare' : command;
      const device = deviceFlag(command, rest);
      const measurements = takeFlag(rest, 'measurements');
      const ctx = contextFrom(
        { ...(device && { device }), ...(measurements && { measurements }) },
        join(stateDir(), 'cli-session.json'),
      );
      const ops = opsFor(ctx);
      const commands = commandsFor(ops);
      const op = name === undefined ? undefined : commands[name];
      if (!op) {
        const asked = command === undefined || ['--help', '-h', 'help'].includes(command);
        (asked ? console.log : err)(
          `usage: appdyno <command> [flags]; appdyno <command> --help for its flags

commands:
  mcp [--device S] [--app A] [--allow-devices RE] [--allow-apps a,b] [--allow-urls RE] [--no-home] [--takeover] [--measurements dir]
                   the MCP server over stdio
  devices          the connected Android devices
  doctor [--serial S]
                   what this machine and that device lack
  ios build        build the iOS runners now
  tools install    download the trace tools
  bench --serial S [--driver appdyno|<module>]... [--n 50] [--out file]
  perf compare|baseline|budget [--app A] [--scenario S] [--format text|json|junit] [--measurements dir]
                   the performance gate: non-zero on a regression or a broken budget

operations (--device S selects the device, also for the next commands):
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
