import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { recordTimeline } from '../src/timeline.js';
import { line } from '../src/usage.js';

/** An op that only says it was called. */
const op = (calls: string[], name: string) => ({
  name,
  input: z.object({ action: z.string() }),
  handler: async (args: { action: string }) => {
    calls.push(`${name} ${args.action}`);
    return { blocks: [{ type: 'text', text: `${name} ${args.action} done` }], data: {} };
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const opsWith = (calls: string[]): any => ({ report: op(calls, 'report') });

describe('a timeline from the command line', () => {
  it('starts, runs what it is given, and stops, in that order', async () => {
    const calls: string[] = [];
    const log: string[] = [];
    await recordTimeline(opsWith(calls), {
      during: async () => calls.push('journey'),
      log: (l) => log.push(l),
    });
    expect(calls).toEqual(['report timeline', 'journey', 'report stop']);
    expect(log).toEqual(['report timeline done', 'report stop done']);
  });

  it('still writes the page of a journey that failed, and then says so', async () => {
    const calls: string[] = [];
    await expect(
      recordTimeline(opsWith(calls), {
        during: () => Promise.reject(new Error('step 3 failed')),
        log: () => undefined,
      }),
    ).rejects.toThrow('step 3 failed');
    expect(calls).toEqual(['report timeline', 'report stop']);
  });

  it('is listed with what it takes', () => {
    expect(line('timeline')).toContain('--app A');
    expect(line('timeline')).toContain('--flow file');
    expect(line('timeline')).toContain('--seconds N');
  });
});
