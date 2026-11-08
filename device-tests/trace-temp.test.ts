import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, assert, describe, expect, it } from 'vitest';
import { recordTrace, run, sleep, stateDir, traceTable, xcodeEnv } from './workspace.js';

/**
 * What `xctrace` leaves, on a real recording and a real kill. APPDYNO_TRACE_DEVICE names a device of yours, and no other
 * recording or Instruments may run: with one, a run takes only what it held, and a killed run's line waits for it to end.
 * The ktrace of each is found from outside: what the tool holds while it records.
 */
const device = process.env.APPDYNO_TRACE_DEVICE ?? '';

const toolOf = async (output: string) => {
  const { stdout } = await run('ps', ['-axo', 'pid=,command=']);
  const line = stdout.split('\n').find((l) => l.includes('xctrace record') && l.includes(output));
  return line ? Number(line.trim().split(/\s+/)[0]) : undefined;
};

const heldBy = async (pid: number) => {
  const { stdout } = await run('lsof', ['-Fn', '-p', String(pid)]).catch(() => ({ stdout: '' }));
  return stdout
    .split('\n')
    .flatMap((l) => (/^n.*instruments.*\.ktrace$/.test(l) ? [l.slice(1)] : []));
};

/** Clearing goes on behind a recording: what wrote the file holds it for some seconds after the tool has gone. */
const gone = async (paths: Set<string>) => {
  const giveUp = Date.now() + 150_000;
  while ([...paths].some(existsSync) && Date.now() < giveUp) await sleep(1_000);
  for (const path of paths) expect(existsSync(path), path).toBe(false);
};

/** What the recording writing into `dir` holds, until `stop`. */
const watching = (dir: string) => {
  const held = new Set<string>();
  let tool: number | undefined;
  // set by stop, which the compiler does not follow into the loop
  let over = false as boolean;
  const seen = (async () => {
    while (!over) {
      tool = (await toolOf(dir)) ?? tool;
      if (tool) for (const path of await heldBy(tool)) held.add(path);
      await sleep(500);
    }
  })();
  return {
    held,
    tool: () => tool,
    stop: async () => {
      over = true;
      await seen;
    },
    /** Once the tool holds a ktrace. */
    holding: async () => {
      while (held.size === 0) await sleep(250);
    },
  };
};

describe.skipIf(!device)('what a recording leaves in the temp folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'appdyno-trace-temp-'));
  /** What a whole recording left, to be gone by the end. */
  const whole = new Set<string>();
  const fresh = (name: string) => {
    const dir = join(root, name);
    mkdirSync(dir);
    return dir;
  };
  afterAll(() => run('rm', ['-rf', root]));

  it('takes away what a recording left, and its trace still reads', async () => {
    const dir = fresh('whole');
    const w = watching(dir);
    const trace = await recordTrace({
      template: 'Time Profiler',
      device,
      seconds: 3,
      dir,
    });
    await w.stop();
    expect(w.held.size).toBeGreaterThan(0);
    // what wrote it held it past 150 s on a recording of this Mac: open it stays, and it goes at a later recording
    for (const path of w.held) whole.add(path);
    expect(await traceTable(trace, 'time-profile')).toContain('<row>');
  }, 420_000);

  it('takes away what a recording left when its tool was killed', async () => {
    const dir = fresh('killed');
    const w = watching(dir);
    await recordTrace({
      template: 'Time Profiler',
      device,
      seconds: 30,
      dir,
      during: async () => {
        await w.holding();
        const tool = w.tool();
        assert(tool !== undefined, 'the tool');
        process.kill(tool, 'SIGKILL');
      },
    }).catch((e: unknown) => console.log(`it said: ${e instanceof Error ? e.message : String(e)}`));
    await w.stop();
    expect(w.held.size).toBeGreaterThan(0);
    await gone(w.held);
  }, 420_000);

  it('takes away at the next recording what a run killed with its process left', async () => {
    const dir = fresh('orphan');
    const w = watching(dir);
    const from = Date.now();
    // the tool alone: nothing watches it, as nothing would after appdyno itself was killed
    const tool = spawn(
      'xcrun',
      [
        'xctrace',
        'record',
        '--template',
        'Time Profiler',
        '--device',
        device,
        '--time-limit',
        '30s',
        '--all-processes',
        '--output',
        join(dir, 'orphan.trace'),
        '--no-prompt',
      ],
      { env: xcodeEnv(), stdio: 'ignore' },
    );
    await w.holding();
    const exited = new Promise((r) => tool.once('exit', r));
    tool.kill('SIGKILL');
    await exited;
    await w.stop();
    expect(w.held.size).toBeGreaterThan(0);
    // the fault itself: a killed tool leaves it behind
    for (const path of w.held) expect(existsSync(path), path).toBe(true);

    const dead = spawn('true');
    await new Promise((r) => dead.once('exit', r));
    mkdirSync(join(stateDir(), 'trace-temp'), { recursive: true });
    writeFileSync(join(stateDir(), 'trace-temp', `${String(dead.pid)}-${from}`), '');
    await recordTrace({
      template: 'Time Profiler',
      device,
      seconds: 2,
      dir: fresh('next'),
    });
    await gone(w.held);
    await gone(whole);
  }, 420_000);
});
