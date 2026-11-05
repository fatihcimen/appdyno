import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deviceState, Owner } from '@appdyno/core';
import { z } from 'zod';

/** The device's open report. */
export const openReports = deviceState(
  'reports',
  z.object({ dir: z.string(), since: z.number(), owner: Owner.optional() }),
);

/** The open report's folder for videos, so that a report is one folder. */
export const reportVideoDir = (serial: string) => {
  const o = openReports.read(serial);
  return o && join(o.dir, 'video');
};

/** One call kept for a report. */
export type Step = {
  /** When it was called, in ms since the epoch by this Mac; none in a journal of an older build. */
  began?: number;
  at: string;
  op: string;
  args: unknown;
  ok: boolean;
  answer: string;
  screen?: string;
  shot?: string;
  /** Videos this call made. */
  files?: string[];
};

export const journalOf = (dir: string) => join(dir, 'steps.jsonl');

/** A folder's journal: none is no steps. */
export const stepsIn = (dir: string): Step[] => {
  const journal = journalOf(dir);
  return existsSync(journal)
    ? readFileSync(journal, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Step)
    : [];
};
