import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll } from 'vitest';
import {
  ViewerProcess,
  viewerBinary,
  viewerTestBinary,
  type ViewerMessage,
  type ViewerSaid,
} from '../src/index.js';

export const run = promisify(execFile);
export const VIEWER = join(import.meta.dirname, '../../../mac/Viewer');
/** The first use compiles it, on a Mac that may be busy. */
export const COMPILE_MS = 300_000;
/** A hang, not a slow machine: how long a word from a viewer is waited for. */
export const WAIT_MS = 240_000;

/** The viewer and its test build, compiled before the file's tests, and a folder for them. */
export function compiled() {
  const built = { binary: '', testBinary: '', dir: mkdtempSync(join(tmpdir(), 'appdyno-viewer-')) };
  beforeAll(async () => {
    built.binary = await viewerBinary();
    built.testBinary = await viewerTestBinary();
  }, COMPILE_MS);
  afterAll(() => rmSync(built.dir, { recursive: true, force: true }));
  return built;
}

/** A running headless viewer and what it has said. */
export function viewer(binary: string) {
  const v = new ViewerProcess(binary, ['--headless']);
  const said: ViewerMessage[] = [];
  const waiting: {
    op: string;
    test: (m: ViewerMessage) => boolean;
    done: (m: ViewerMessage) => void;
  }[] = [];
  v.onMessage((m) => {
    said.push(m);
    for (const w of [...waiting])
      if (w.op === m.op && w.test(m)) {
        waiting.splice(waiting.indexOf(w), 1);
        w.done(m);
      }
  });
  const until = <K extends ViewerMessage['op']>(
    op: K,
    test: (m: ViewerSaid<K>) => boolean = () => true,
  ) =>
    new Promise<ViewerSaid<K>>((done, fail) => {
      const mine = (m: ViewerMessage): m is ViewerSaid<K> => m.op === op;
      const old = said.find((m) => mine(m) && test(m));
      if (old) {
        done(old as ViewerSaid<K>);
        return;
      }
      waiting.push({
        op,
        test: (m) => mine(m) && test(m),
        done: (m) => done(m as ViewerSaid<K>),
      });
      setTimeout(() => fail(new Error(`no ${op}: ${JSON.stringify(said).slice(-400)}`)), WAIT_MS);
    });
  return { v, said, until };
}
