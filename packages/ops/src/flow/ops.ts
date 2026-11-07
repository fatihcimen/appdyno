import { toMaestro, FlowError } from '@appdyno/flows';
import type { ErrorCode } from '@appdyno/protocol';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { FlowOut } from '../schemas.js';
import { Scenario } from '../perf/shared.js';
import { ToolError, reply, defineOp, DESTRUCTIVE } from '../tool.js';
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

/** `NAME=value` words as a record. */
export function paramsOf(words: string[] = []): Record<string, string> {
  return Object.fromEntries(
    words.map((w) => {
      const at = w.indexOf('=');
      if (at < 1)
        throw new ToolError(`a parameter is NAME=value: ${w.split('=')[0]}`, 'INVALID_ARGUMENT');
      return [w.slice(0, at), w.slice(at + 1)];
    }),
  );
}

export function flowOps(ctx: ServerContext, runner: FlowRunner) {
  const done = (t: string, data: Record<string, unknown> = {}) => reply(t, { done: t, ...data });
  return [
    defineOp({
      name: 'flow',
      title: 'Flow',
      description:
        'Record your actions as a repeatable test; replay them with no model. run (from: a step; params: NAME=value; iterations: a journey timed by step, kept for perf_compare), export (to Maestro YAML).',
      input: z
        .object({
          action: z.enum(['start', 'stop', 'save', 'run', 'export']),
          file: z.string().max(1_000).optional(),
          from: z.number().refine(Number.isInteger, 'a step number').optional(),
          params: z.array(z.string().max(2_000)).optional(),
          envFile: z.string().max(1_000).optional(),
          overwrite: z.boolean().optional(),
          iterations: z.number().int().min(1).max(50).optional(),
          scenario: Scenario,
        })
        .strict(),
      output: FlowOut,
      annotations: DESTRUCTIVE,
      run: async ({ action, file, from, params, envFile, overwrite, iterations, scenario }) => {
        const need = () => {
          if (!file)
            throw new ToolError(`${action} needs file: a path ending in .flow`, 'INVALID_ARGUMENT');
          if (!FLOW_FILE.test(file))
            throw new ToolError(`a flow's file ends in .flow: ${file}`, 'INVALID_ARGUMENT');
          return file;
        };
        if (action === 'export') {
          try {
            const yaml = toMaestro(readFlow(need()));
            return reply(yaml, { done: 'exported' });
          } catch (e) {
            if (e instanceof FlowError) throw new ToolError(e.message, 'INVALID_ARGUMENT');
            throw e;
          }
        }
        const s = await ctx.session();
        const serial = s.device.serial;
        const held = loadRecording(ctx, serial);
        switch (action) {
          case 'start': {
            if (held?.state.running)
              throw new ToolError(
                `a recording is running on ${serial}: stop it first`,
                'INVALID_ARGUMENT',
              );
            const pkg = s.appId;
            startRecording(ctx, serial, pkg, s.owner);
            return done(`recording on ${serial}${pkg ? ` (${pkg})` : ''}`);
          }
          case 'stop': {
            if (!held)
              throw new ToolError('no recording to stop: flow start begins one', 'NOT_FOUND');
            held.state.running = false;
            keepRecording(held);
            const notes = flagged(held.flow());
            return reply(
              [
                held.state.steps.length > 0 ? held.text() : 'nothing was recorded',
                ...notes.map((n) => `look at ${n}`),
              ].join('\n'),
              { done: 'stopped', steps: held.state.steps.length, flagged: notes },
            );
          }
          case 'save': {
            if (!held)
              throw new ToolError('no recording to save: flow start begins one', 'NOT_FOUND');
            if (held.state.steps.length === 0)
              throw new ToolError('nothing was recorded yet', 'NOT_FOUND');
            const path = need();
            const notes = saveRecording(held, path, overwrite);
            const t = `saved ${held.state.steps.length} steps to ${path}`;
            return reply([t, ...notes.map((n) => `look at ${n}`)].join('\n'), {
              done: t,
              steps: held.state.steps.length,
              flagged: notes,
            });
          }
          case 'run': {
            const path = need();
            const replay = {
              params: { ...(envFile && envValues(envFile)), ...paramsOf(params) },
              ...(from !== undefined && { from }),
            };
            const { result, journey } = iterations
              ? await measureJourney(ctx, runner, s, readFlow(path), path, {
                  ...replay,
                  iterations,
                  ...(scenario && { scenario }),
                })
              : { result: await runner.run(s, readFlow(path), path, replay), journey: undefined };
            if (result.failure)
              throw new ToolError(
                [
                  runner.failureText(path, result.failure),
                  ...(journey ? [`what passed before it is kept: ${journeyText(journey)}`] : []),
                ].join('\n'),
                (result.failure.code ?? 'NOT_FOUND') as ErrorCode,
                result.failure.hint,
              );
            const t = result.steps.map(runner.lineOf).join('\n');
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
