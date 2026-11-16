import { z } from 'zod';

export const FlowOut = z.object({
  done: z.string(),
  /** `export` with `to`: the file it wrote. */
  file: z.string().optional(),
  steps: z.number().int().optional(),
  /** `test`: the run's verdict, its record and page, and the files that failed. */
  verdict: z.enum(['PASS', 'FAIL']).optional(),
  record: z.string().optional(),
  page: z.string().optional(),
  failed: z.array(z.string()).optional(),
  flagged: z.array(z.string()).optional(),
  timings: z
    .array(
      z.object({
        n: z.number().int(),
        line: z.number().int(),
        file: z.string().optional(),
        step: z.string(),
        ms: z.number(),
        settledMs: z.number().optional(),
        actMs: z.number().optional(),
        settled: z.boolean().optional(),
        changed: z.boolean().optional(),
        warnings: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  /** `run` with `iterations`: what each step read, the median of the iterations. */
  journey: z
    .object({
      id: z.string(),
      raw: z.string(),
      scenario: z.string(),
      iterations: z.number().int(),
      /** None where no iteration settled at every step. */
      totalMs: z.number().optional(),
      /** The whole of each iteration that has one, for a test against another run. */
      samples: z.array(z.number()),
      steps: z.array(
        z.object({
          step: z.string(),
          /** None where it never settled: what ended it was the tool's deadline. */
          ms: z.number().optional(),
          /** In how many iterations it never settled. */
          unsettled: z.number().int().optional(),
          framesP95Ms: z.number().optional(),
          framesWorstMs: z.number().optional(),
          memoryKb: z.number().optional(),
        }),
      ),
      note: z.string().optional(),
      noise: z.array(z.string()),
    })
    .optional(),
});
