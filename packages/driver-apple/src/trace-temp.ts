import { mkdir, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { processAlive, run, stateDir } from '@appdyno/core';

/**
 * Each `xctrace record` leaves an `instruments*.ktrace` of up to 0.7 GB in the user's temp folder, and a few hundred fill a
 * Mac. It takes no `TMPDIR`: on Xcode 27.1 a recording given a folder of its own still wrote there, and an `export` makes
 * none. So a recording's files are found by when they were made, and by what its tool held: for the length of a recording
 * (16 s of a 26 s run). What any process has open stays. With another recording or a person's Instruments running, only
 * what this run was seen to hold goes, as a file of theirs can stand closed between its writing and its reading.
 * `DTServiceHub` writes the file and keeps it open after the tool has gone: 4-12 s at load 60, past 150 s once on a recording
 * of this Mac. No measure waits for that: clearing goes on behind it, and what stays open, or a process that ends first,
 * leaves a line for the next recording.
 */
const KTRACE = /^instruments.*\.ktrace$/;
const TOOL = /\/(xctrace|Instruments)$/;
const SEEN_EVERY_MS = 2_000;
const CLOSE_MS = 120_000;
const CLOSE_EVERY_MS = 1_000;

export type TempOptions = {
  /** How long after its start a killed run can have made a file. */
  spanMs: number;
  /** The folder the tool writes in. */
  dir?: string;
  /** Whether another recording, or Instruments, runs. */
  others?: () => Promise<boolean>;
  seenEveryMs?: number;
  /** How long a run waits for what holds its files to let go, before the next recording sees to them. */
  closeMs?: number;
};

const toolsRunning = async () =>
  (await run('ps', ['-axo', 'comm='])).stdout.split('\n').some((l) => TOOL.test(l.trim()));

const userTemp = async () =>
  realpath((await run('getconf', ['DARWIN_USER_TEMP_DIR'])).stdout.trim());

const ktraces = async (dir: string) => {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => KTRACE.test(n));
  const read = await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      const s = await stat(path).catch(() => undefined);
      return s ? [{ path, born: s.birthtimeMs }] : [];
    }),
  );
  return read.flat();
};

/** What of these any process has open. An `lsof` that cannot say answers that all are: nothing goes on a guess. */
async function openOf(paths: string[]) {
  if (paths.length === 0) return new Set<string>();
  try {
    const { stdout } = await run('lsof', ['-Fn', '--', ...paths]);
    return new Set(stdout.split('\n').flatMap((l) => (l.startsWith('n') ? [l.slice(1)] : [])));
  } catch (e) {
    return (e as { code?: number }).code === 1 ? new Set<string>() : new Set(paths);
  }
}

const heldBy = async (pid: number, dir: string) => {
  const { stdout } = await run('lsof', ['-Fn', '-p', String(pid)]).catch(() => ({ stdout: '' }));
  return stdout.split('\n').flatMap((l) => {
    const path = l.slice(1);
    return l.startsWith('n') && path.startsWith(`${dir}/`) && path.endsWith('.ktrace')
      ? [path]
      : [];
  });
};

const ledger = () => join(stateDir(), 'trace-temp');

/** What goes of a run's files, and how many stay open: all that was made, or with others at work what it held. */
async function clear(dir: string, window: { from: number; to: number }, kept: Set<string> | false) {
  const made = (await ktraces(dir)).filter((f) => f.born >= window.from && f.born <= window.to);
  const ours = kept ? made.filter((f) => kept.has(f.path)) : made;
  const open = await openOf(ours.map((f) => f.path));
  await Promise.all(ours.filter((f) => !open.has(f.path)).map((f) => rm(f.path, { force: true })));
  return ours.filter((f) => open.has(f.path)).length;
}

/** Lines of the runs still at work in this process. */
const working = new Set<string>();

/**
 * A run killed with its process, or whose files stayed open too long, left its line: it is finished once nothing else may be
 * at work. What is asked now is whether that may be; the clearing, whose listing of the temp folder is slow (1.5 million
 * names took 4.5 s on this Mac, once for each line), is what is handed back, to go on beside the recording that begins at
 * `before`, and it takes nothing born since then.
 */
async function sweep(
  dir: string,
  spanMs: number,
  others: () => Promise<boolean>,
  before: number,
): Promise<{ cleared: Promise<void> }> {
  const left = (await readdir(ledger()).catch(() => [] as string[])).flatMap((line) => {
    // a line of no run of this tool reads as no process and no time
    const [pid = NaN, from = NaN] = line.split('-').map(Number);
    return working.has(line) || (pid !== process.pid && processAlive(pid)) ? [] : [{ line, from }];
  });
  if (left.length === 0 || (await others())) return { cleared: Promise.resolve() };
  const cleared = (async () => {
    for (const { line, from } of left) {
      const open = await clear(dir, { from, to: Math.min(from + spanMs, before) }, false);
      if (open === 0) await rm(join(ledger(), line), { force: true });
    }
  })().catch(() => undefined);
  return { cleared };
}

/**
 * Keeps what one recording leaves out of the temp folder: `follow` its tool, and `done` when that has exited, however it
 * ended, which ends once its files have gone. A process that ends before that leaves a line that the next recording acts on.
 */
export async function watchKtraces({
  spanMs,
  dir,
  others = toolsRunning,
  seenEveryMs = SEEN_EVERY_MS,
  closeMs = CLOSE_MS,
}: TempOptions) {
  const temp = dir ?? (await userTemp());
  const from = Date.now();
  const { cleared } = await sweep(temp, spanMs, others, from);
  const line = `${process.pid}-${from}`;
  working.add(line);
  await mkdir(ledger(), { recursive: true });
  await writeFile(join(ledger(), line), '');
  const seen = new Set<string>();
  let tool: number | undefined;
  // set by `done`, where the compiler does not follow it
  let over = false as boolean;
  void (async () => {
    while (!over) {
      if (tool) for (const path of await heldBy(tool, temp)) seen.add(path);
      await new Promise((r) => setTimeout(r, seenEveryMs).unref());
    }
  })();
  return {
    follow: (pid: number) => void (tool = pid),
    done: async () => {
      over = true;
      const clearing = async () =>
        clear(temp, { from, to: Infinity }, (await others()) ? seen : false);
      const giveUp = Date.now() + closeMs;
      let open = await clearing();
      while (open > 0 && Date.now() < giveUp) {
        await new Promise((r) => setTimeout(r, CLOSE_EVERY_MS).unref());
        open = await clearing();
      }
      // what came before this run is cleared beside it, from windows apart from its own
      await cleared;
      working.delete(line);
      if (open === 0) await rm(join(ledger(), line), { force: true });
    },
  };
}
