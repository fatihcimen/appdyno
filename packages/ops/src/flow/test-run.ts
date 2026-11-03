import { existsSync, statSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, basename, dirname } from 'node:path';
import { safeName } from '@appdyno/core';
import { type TestSuite, type TestCase, type RunResult, junitXml } from '@appdyno/flows';
import type { ServerContext } from '../context.js';
import type { Session } from '../session.js';
import { ToolError } from '../tool.js';
import type { FlowRunner } from './runner.js';
import { readFlow } from './shared.js';

/** The `.flow` files the words name: a file, or every one under a directory, in name order. */
export function flowFiles(paths: string[]): string[] {
  const files = paths.flatMap((p) => {
    if (!existsSync(p)) throw new ToolError(`no such file or directory: ${p}`, 'NOT_FOUND');
    if (!statSync(p).isDirectory()) return [p];
    return (readdirSync(p, { recursive: true }) as string[])
      .filter((f) => extname(f) === '.flow')
      .sort()
      .map((f) => join(p, f));
  });
  // a CI job that found nothing to run has not passed
  if (files.length === 0) throw new ToolError(`no .flow files in ${paths.join(', ')}`, 'NOT_FOUND');
  return files;
}

export type TestOptions = {
  files: string[];
  /** In order; none: the context's default device. */
  devices: string[];
  artifacts: string;
  junit: string;
  params?: Record<string, string>;
  log?: (line: string) => void;
};

/** A path's part from a serial or a file's name, which may hold any character. */
const firstLine = (s: string) => s.split('\n')[0]!;

/**
 * Every file on every device, one after another. A failure leaves the screenshot and tree of its moment
 * under `artifacts`, and the next file still runs. A screenshot shows what the screen shows, a secret
 * typed into a plain field included.
 */
export async function runTests(
  ctx: ServerContext,
  runner: FlowRunner,
  o: TestOptions,
): Promise<{ passed: boolean; suites: TestSuite[] }> {
  const log = o.log ?? (() => undefined);
  const suites: TestSuite[] = [];
  for (const device of o.devices.length > 0 ? o.devices : [undefined]) {
    const cases: TestCase[] = [];
    let s: Session | undefined;
    let openError: Error | undefined;
    try {
      s = device ? await ctx.use(device) : await ctx.session();
    } catch (e) {
      openError = e as Error;
    }
    const name = s?.device.serial ?? device ?? 'device';
    log(`${name}:`);
    for (const file of o.files) {
      const t0 = Date.now();
      const label = basename(file);
      let result: RunResult | undefined;
      let error = openError;
      if (s) {
        try {
          result = await runner.run(s, readFlow(file), file, {
            evidence: join(o.artifacts, safeName(name), safeName(label)),
            ...(o.params && { params: o.params }),
          });
        } catch (e) {
          // a file that does not parse, a value missing: this file's failure, not the run's
          error = e as Error;
        }
      }
      const ms = Date.now() - t0;
      const out = result?.steps.map(runner.lineOf).join('\n');
      if (result?.passed) {
        log(`  ok   ${label} (${result.steps.length} steps, ${ms} ms)`);
        cases.push({ name: label, ms, ...(out && { out }) });
        continue;
      }
      const f = result?.failure;
      const message = f
        ? `line ${f.line}, step ${f.n}: ${firstLine(f.message)}`
        : firstLine(error?.message ?? 'failed');
      const detail = [
        f ? runner.failureText(file, f) : (error?.message ?? ''),
        ...(f?.saved ?? []).map((x) => `saved ${x}`),
      ].join('\n');
      log(`  FAIL ${label}: ${message}`);
      for (const x of f?.saved ?? []) log(`       ${x}`);
      cases.push({ name: label, ms, failure: { message, detail }, ...(out && { out }) });
    }
    suites.push({ name, cases });
  }
  mkdirSync(dirname(o.junit), { recursive: true });
  writeFileSync(o.junit, junitXml(suites));
  return { passed: suites.every((x) => x.cases.every((c) => !c.failure)), suites };
}
