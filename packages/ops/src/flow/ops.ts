import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { toMaestro, FlowError, namesOf, type Recording } from '@appdyno/flows';
import type { ErrorCode } from '@appdyno/protocol';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { FlowOut } from './schemas.js';
import { Scenario } from '../perf/shared.js';
import { beyond, ToolError, reply, defineOp, DESTRUCTIVE } from '../tool.js';
import { journeyText, measureJourney } from './journey.js';
import type { FlowRunner } from './runner.js';
import {
  FLOW_FILE,
  envValues,
  flagged,
  keepRecording,
  loadRecording,
  readFlow,
  saveRecording,
  startRecording,
} from './shared.js';
import { inside, writeInside } from '../writes.js';
import { flowFiles, flowsTagged, runTests } from './test-run.js';

/** `NAME=value` words as a record. */
export function paramsOf(words: string[] = []): Record<string, string> {
  return Object.fromEntries(
    words.map((w) => {
      const at = w.indexOf('=');
      if (at < 1)
        throw new ToolError(
          `a parameter is NAME=value: ${must(w.split('=')[0], 'its name')}`,
          'INVALID_ARGUMENT',
        );
      return [w.slice(0, at), w.slice(at + 1)];
    }),
  );
}

/**
 * `params` on record, stop or save: each value named in the recording, as a param. At stop and save a name no step holds
 * is refused, as it would name nothing; what it says is where each is.
 */
function nameParams(r: Recording, params: string[] | undefined, held: boolean): string[] {
  const named = Object.entries(paramsOf(params));
  try {
    for (const [name, value] of named) r.nameParam(name, value);
  } catch (e) {
    if (e instanceof FlowError) throw new ToolError(e.message, 'INVALID_ARGUMENT');
    throw e;
  }
  if (!held) return [];
  return named.map(([name]) => {
    const at = r.state.steps.flatMap((st, i) => (namesOf(st).includes(name) ? [i + 1] : []));
    if (at.length === 0)
      throw new ToolError(
        `no recorded step holds the value of ${name}: it would name nothing`,
        'INVALID_ARGUMENT',
        'give the value as it was typed or read, NAME=value',
      );
    return `param ${name}: step${at.length > 1 ? 's' : ''} ${at.join(', ')}`;
  });
}

/** A recording written to its file, and the answer that shows it, as a client with no file tools reads it only here. */
function saved(
  held: Recording,
  path: string,
  overwrite: boolean | undefined,
  named: string[],
  stopped: boolean,
) {
  let notes: string[];
  try {
    notes = saveRecording(held, path, overwrite);
  } catch (e) {
    if (stopped && e instanceof ToolError)
      e.message += `; the recording stopped, and its ${held.state.steps.length} steps are kept: run_flow save writes them`;
    throw e;
  }
  keepRecording(held);
  const t = `${stopped ? 'stopped, and saved' : 'saved'} ${held.state.steps.length} steps to ${path}`;
  return reply([t, '', held.text(), ...named, ...notes.map((n) => `look at ${n}`)].join('\n'), {
    done: t,
    steps: held.state.steps.length,
    flagged: notes,
  });
}

/**
 * `test`: a file or a folder of flows on the selected device, as `appdyno test` runs them, with the report in a folder
 * this server may write in. A run that fails is an answer, not a refusal: its verdict and each failure are what was asked.
 */
async function tested(
  ctx: ServerContext,
  runner: FlowRunner,
  o: {
    file?: string;
    to?: string;
    params?: string[];
    envFile?: string;
    retries?: number;
    tags?: string[];
  },
) {
  if (!o.file)
    throw new ToolError('test needs file: a .flow file, or a folder of them', 'INVALID_ARGUMENT');
  const artifacts = inside(ctx.policy, o.to ?? 'appdyno-artifacts');
  const { record } = await runTests(ctx, runner, {
    files: flowsTagged(flowFiles([o.file]), o.tags),
    devices: [],
    artifacts,
    params: paramsOf(o.params),
    ...(o.envFile && { fromFile: envValues(o.envFile), envFile: o.envFile }),
    ...(o.retries && { retries: o.retries }),
    command: ['run_flow', 'test', o.file],
  });
  return reply(readFileSync(join(artifacts, 'verdict.txt'), 'utf8').trimEnd(), {
    done: record.verdict,
    verdict: record.verdict,
    record: join(artifacts, 'run.json'),
    page: join(artifacts, 'index.html'),
    failed: record.cases.filter((c) => c.outcome === 'failed').map((c) => c.label),
  });
}

export function flowOps(ctx: ServerContext, runner: FlowRunner) {
  const done = (t: string, data: Record<string, unknown> = {}) => reply(t, { done: t, ...data });
  return [
    defineOp({
      name: 'run_flow',
      title: 'Record and replay a flow',
      description:
        'Record your calls as a repeatable test, a .flow file replayed with no model: record, then stop to write it to file (save: later); run replays file (from: a step; iterations: per step for compare_performance); test: a file or folder to one verdict, report in to; export: Maestro YAML. params NAME=value: recorded, a value becomes ${NAME}; run fills it. One-off calls: run_steps. Returns the steps, times or verdict.',
      input: z
        .object({
          action: z.enum(['record', 'stop', 'save', 'run', 'test', 'export']),
          file: z.string().max(1_000).optional(),
          to: z.string().max(1_000).optional(),
          from: z.number().refine(Number.isInteger, 'a step number').optional(),
          params: z.array(z.string().max(2_000)).optional(),
          envFile: z.string().max(1_000).optional(),
          overwrite: z.boolean().optional(),
          iterations: z.number().int().min(1).max(50).optional(),
          retries: z.number().int().min(0).max(5).optional(),
          tags: z.array(z.string().max(100)).optional(),
          scenario: Scenario,
        })
        .strict(),
      output: FlowOut,
      // as far as the steps of a flow reach
      annotations: beyond(DESTRUCTIVE),
      run: async (input) => {
        const { action, file, to, from, params, envFile, overwrite, iterations, scenario } = input;
        const need = () => {
          if (!file)
            throw new ToolError(`${action} needs file: a path ending in .flow`, 'INVALID_ARGUMENT');
          if (!FLOW_FILE.test(file))
            throw new ToolError(`a flow's file ends in .flow: ${file}`, 'INVALID_ARGUMENT');
          return file;
        };
        if (action === 'export') {
          if (params)
            throw new ToolError(
              'export takes no params: a flow holds its names, and a run takes their values',
              'INVALID_ARGUMENT',
            );
          if (to !== undefined && !/\.ya?ml$/.test(to))
            throw new ToolError(`to is a .yaml file: ${to}`, 'INVALID_ARGUMENT');
          try {
            const yaml = toMaestro(readFlow(need(), ctx.policy));
            if (to === undefined) return reply(yaml, { done: 'exported' });
            const written = writeInside(ctx.policy, to, yaml, overwrite);
            return reply(`${yaml}\nwritten to ${written}`, { done: 'exported', file: written });
          } catch (e) {
            if (e instanceof FlowError) throw new ToolError(e.message, 'INVALID_ARGUMENT');
            throw e;
          }
        }
        if (action === 'test') return tested(ctx, runner, input);
        const s = await ctx.session();
        const serial = s.device.serial;
        const held = loadRecording(ctx, serial);
        switch (action) {
          case 'record': {
            if (held?.state.running)
              throw new ToolError(
                `a recording is running on ${serial}: stop it first`,
                'INVALID_ARGUMENT',
              );
            const pkg = s.appId;
            startRecording(ctx, serial, pkg, s.owner, (r) => nameParams(r, params, false));
            return done(`recording on ${serial}${pkg ? ` (${pkg})` : ''}`);
          }
          case 'stop': {
            if (!held)
              throw new ToolError('no recording to stop: run_flow record begins one', 'NOT_FOUND');
            // a file refused before anything stops leaves the recording running, as it was
            const path = file === undefined ? undefined : inside(ctx.policy, need());
            const named = nameParams(held, params, true);
            held.state.running = false;
            keepRecording(held);
            const n = held.state.steps.length;
            if (path && n > 0) return saved(held, path, overwrite, named, true);
            const notes = flagged(held.flow());
            const t =
              n > 0
                ? `stopped: ${n} steps, kept until the next record; run_flow save with file writes them`
                : 'stopped: nothing was recorded';
            return reply(
              [
                t,
                ...(n > 0 ? [held.text()] : []),
                ...named,
                ...notes.map((x) => `look at ${x}`),
              ].join('\n'),
              { done: t, steps: n, flagged: notes },
            );
          }
          case 'save': {
            if (!held)
              throw new ToolError('no recording to save: run_flow record begins one', 'NOT_FOUND');
            if (held.state.steps.length === 0)
              throw new ToolError('nothing was recorded yet', 'NOT_FOUND');
            const path = inside(ctx.policy, need());
            return saved(held, path, overwrite, nameParams(held, params, true), false);
          }
          case 'run': {
            const path = need();
            const replay = {
              params: paramsOf(params),
              ...(envFile && { fromFile: envValues(envFile) }),
              ...(from !== undefined && { from }),
            };
            const { result, journey } = iterations
              ? await measureJourney(ctx, runner, s, readFlow(path, ctx.policy), path, {
                  ...replay,
                  iterations,
                  ...(scenario && { scenario }),
                })
              : {
                  result: await runner.run(s, readFlow(path, ctx.policy), path, replay),
                  journey: undefined,
                };
            // what a teardown or the run could not clean up is said beside the failure, and is the refusal after a pass
            const left = [runner.teardownText(path, result), ...(result.cleanup ?? [])]
              .filter(Boolean)
              .join('\n');
            if (result.failure)
              throw new ToolError(
                [
                  runner.failureText(path, result.failure),
                  ...(left ? [left] : []),
                  ...(journey ? [`what passed before it is kept: ${journeyText(journey)}`] : []),
                ].join('\n'),
                (result.failure.code ?? 'NOT_FOUND') as ErrorCode,
                result.failure.hint,
              );
            if (left)
              throw new ToolError(
                `passed: ${result.steps.length} steps\n${left}`,
                'CHECK_FAILED',
                'the next run starts from what was left: put that right first',
              );
            const t = runner.linesOf(result).join('\n');
            return reply(
              journey ? journeyText(journey) : `${t}\npassed: ${result.steps.length} steps`,
              {
                done: 'passed',
                steps: result.steps.length,
                timings: result.steps,
                ...(journey && { journey }),
              },
            );
          }
        }
      },
    }),
  ];
}
