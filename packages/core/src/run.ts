import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** A program on this Mac, to its end: its stdout and stderr, or a rejection with them. */
export const run = promisify(execFile);
