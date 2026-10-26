#!/usr/bin/env node
// appdyno CLI: devices, doctor, bench. Output on stdout, diagnostics on stderr.
import { writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { parseArgs } from 'node:util';
import { Adb } from './adb.js';
import { benchmark, appdynoDriver, loadDriver, table, type BenchResult } from './bench.js';
import { doctor } from './doctor.js';
import { iosProducts, pruneIosBuilds } from './ios/runner.js';
import { installTools } from './tools.js';

const [command, ...rest] = process.argv.slice(2);
const err = (s: string) => process.stderr.write(`${s}\n`);

async function main(): Promise<number> {
  switch (command) {
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
      // both runners now, so a device session never waits for a build (install.sh calls this)
      for (const kind of ['simulator', 'device'] as const)
        console.log(`${kind}: ${(await iosProducts(kind)) ?? 'no packaged sources'}`);
      console.log(`older builds removed: ${await pruneIosBuilds()}`);
      return 0;
    }
    case 'doctor': {
      const { values } = parseArgs({ args: rest, options: { serial: { type: 'string' } } });
      const checks = await doctor({ ...(values.serial && { serial: values.serial }) });
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
        const driver =
          name === 'appdyno' ? appdynoDriver(serial) : await loadDriver(name, serial);
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
    default:
      err(
        'usage: appdyno <devices | doctor [--serial S] | ios build | tools install | bench --serial S [--driver appdyno|<module>]... [--n 50] [--out file]>',
      );
      return 2;
  }
}

process.exitCode = await main().catch((e: unknown) => {
  // a failure the user can act on: its message and hint, not a stack trace
  const d = e as { message?: string; hint?: string };
  err(`appdyno: ${d.message ?? String(e)}${d.hint ? `\n  ${d.hint}` : ''}`);
  return 1;
});
