import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { must } from '@appdyno/core';
import { watchKtraces } from '../src/trace-temp.js';

const SPAN = 60_000;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ktrace = (dir: string, name: string) => {
  const path = join(dir, `instruments${name}.ktrace`);
  writeFileSync(path, 'x');
  return path;
};
/** A process with the file open, as a recording's tool has. */
const holding = async (path: string) => {
  const tail = spawn('tail', ['-f', path], { stdio: 'ignore' });
  await pause(300);
  return tail;
};
const ended = (p: ReturnType<typeof spawn>) =>
  new Promise((r) => {
    p.once('exit', r);
    p.kill('SIGKILL');
  });

describe('what a recording leaves in the temp folder', () => {
  let dir: string;
  const alone = { spanMs: SPAN, others: () => Promise.resolve(false) };

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'appdyno-temp-')));
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-temp-state-')));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('removes what was made during the run, and nothing older or of another name', async () => {
    const older = ktrace(dir, 'Older');
    await pause(20);
    const watch = await watchKtraces({ ...alone, dir });
    await pause(20);
    const made = ktrace(dir, 'Made');
    const other = join(dir, 'other.ktrace');
    writeFileSync(other, 'x');
    await watch.done();
    expect(existsSync(made)).toBe(false);
    expect(existsSync(older)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it('waits for what holds a file to let go, as the service that wrote it outlives the tool', async () => {
    const watch = await watchKtraces({ ...alone, dir });
    await pause(20);
    const open = ktrace(dir, 'Open');
    const tail = await holding(open);
    const done = watch.done();
    await pause(1_200);
    expect(existsSync(open)).toBe(true);
    await ended(tail);
    await done;
    expect(existsSync(open)).toBe(false);
  });

  it('leaves what stays open, and the next recording sees to it', async () => {
    const lines = join(must(process.env.APPDYNO_STATE_DIR, 'the state folder'), 'trace-temp');
    const watch = await watchKtraces({ ...alone, dir, closeMs: 0 });
    await pause(20);
    const open = ktrace(dir, 'Open');
    const tail = await holding(open);
    await watch.done();
    expect(existsSync(open)).toBe(true);
    expect(readdirSync(lines)).toHaveLength(1);
    await ended(tail);
    const next = await watchKtraces({ ...alone, dir });
    expect(existsSync(open)).toBe(false);
    await next.done();
    expect(readdirSync(lines)).toEqual([]);
  });

  it('with another recording running takes only what its own tool was seen to hold', async () => {
    const watch = await watchKtraces({
      spanMs: SPAN,
      dir,
      others: () => Promise.resolve(true),
      seenEveryMs: 50,
    });
    await pause(20);
    const mine = ktrace(dir, 'Mine');
    const theirs = ktrace(dir, 'Theirs');
    const tail = await holding(mine);
    watch.follow(must(tail.pid, 'its pid'));
    await pause(800);
    await ended(tail);
    await watch.done();
    expect(existsSync(mine)).toBe(false);
    expect(existsSync(theirs)).toBe(true);
  });

  /** The line of a run whose process is gone. */
  const killedRun = async () => {
    const dead = spawn('true');
    await new Promise((r) => dead.once('exit', r));
    const lines = join(must(process.env.APPDYNO_STATE_DIR, 'the state folder'), 'trace-temp');
    mkdirSync(lines, { recursive: true });
    writeFileSync(join(lines, `${must(dead.pid, 'its pid')}-${Date.now() - 1_000}`), '');
    return lines;
  };

  it('clears after a run whose process was killed, at the next recording', async () => {
    const left = ktrace(dir, 'Left');
    const lines = await killedRun();
    const next = await watchKtraces({ ...alone, dir });
    expect(existsSync(left)).toBe(false);
    expect(readdirSync(lines)).toHaveLength(1);
    await next.done();
    expect(readdirSync(lines)).toEqual([]);
  });

  it('waits with a killed run while another recording may be at work', async () => {
    const left = ktrace(dir, 'Left');
    const lines = await killedRun();
    const next = await watchKtraces({ spanMs: SPAN, dir, others: () => Promise.resolve(true) });
    expect(existsSync(left)).toBe(true);
    await next.done();
    expect(readdirSync(lines)).toHaveLength(1);
  });
});
