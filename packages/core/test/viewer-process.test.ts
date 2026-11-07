import { spawn } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ViewerProcess } from '../src/index.js';
import { COMPILE_MS, compiled, viewer, WAIT_MS } from './viewer-helpers.js';

const built = compiled();

const exited = (v: ViewerProcess) => new Promise<string>((r) => v.onExit(r));

describe('the viewer, compiled by its first-use path', () => {
  it(
    'says it is ready, and ends with its stdin',
    async () => {
      const { v, until } = viewer(built.binary);
      await until('ready');
      const end = exited(v);
      v.kill();
      await end;
    },
    COMPILE_MS,
  );

  it(
    'a parent that dies by SIGKILL takes its viewer with it',
    async () => {
      // a parent of its own, killed as a crash would: the viewer sees its stdin end. It goes with this test's process by
      // its own stdin, so a run that fails or is cut short before the kill leaves neither behind
      const parent = spawn(
        process.execPath,
        [
          '-e',
          `const {spawn}=require('node:child_process');const c=spawn(${JSON.stringify(built.binary)},['--headless'],{stdio:['pipe','inherit','inherit']});process.stdout.write(String(c.pid)+'\\n');process.stdin.on('end',()=>process.exit()).resume();`,
        ],
        { stdio: ['pipe', 'pipe', 'ignore'] },
      );
      // the viewer writes to this pipe too, and its first line may come before the parent's
      const pid = await new Promise<number>((r) => {
        let said = '';
        parent.stdout.on('data', (b: Buffer) => {
          said += b.toString();
          const line = /^(\d+)\n/m.exec(said)?.[1];
          if (line) r(Number(line));
        });
      });
      expect(pid).toBeGreaterThan(0);
      process.kill(parent.pid!, 'SIGKILL');
      const end = Date.now() + WAIT_MS;
      let alive = true;
      while (alive && Date.now() < end) {
        try {
          process.kill(pid, 0);
          await new Promise((r) => setTimeout(r, 100));
        } catch {
          alive = false;
        }
      }
      expect(alive).toBe(false);
    },
    COMPILE_MS,
  );

  it(
    'a kind it does not know is said so, and it stays',
    async () => {
      const { v, until } = viewer(built.binary);
      v.send({ op: 'attach', source: { kind: 'no-such' } });
      await expect(until('lost')).resolves.toMatchObject({ fatal: true });
      v.send({ op: 'status', state: 'live' });
      v.send('not json' as never);
      await until('stats');
      const end = exited(v);
      v.send({ op: 'quit' });
      await end;
    },
    COMPILE_MS,
  );

  it(
    'shows an emulator pixels on each tick, reports them, and lets go on detach',
    async () => {
      const file = join(built.dir, 'screen.rgba');
      writeFileSync(file, Buffer.alloc(64 * 32 * 4, 200));
      chmodSync(file, 0o600);
      const { v, until } = viewer(built.binary);
      v.send({ op: 'attach', source: { kind: 'pixels', file, w: 64, h: 32 } });
      v.send({ op: 'tick', w: 64, h: 32 });
      await expect(until('first')).resolves.toMatchObject({ w: 64, h: 32, codec: 'pixels' });
      for (let i = 0; i < 5; i++) v.send({ op: 'tick', w: 64, h: 32 });
      const stats = await until('stats', (m) => Number(m.arrived) > 0);
      expect(stats).toMatchObject({ source: 'pixels', w: 64, h: 32 });
      expect(Number(stats.rssMb)).toBeGreaterThan(0);
      v.send({ op: 'detach' });
      await until('stats', (m) => m.source === 'pixels' && Number(m.arrived) === 0);
      v.send({ op: 'tick', w: 64, h: 32 });
      v.kill();
    },
    COMPILE_MS,
  );

  it(
    'names a simulator that is not there',
    async () => {
      const { v, until } = viewer(built.binary);
      v.send({
        op: 'attach',
        source: { kind: 'surface', udid: '00000000-0000-0000-0000-000000000000' },
      });
      await expect(until('lost')).resolves.toMatchObject({ why: 'simulator-off' });
      v.kill();
    },
    COMPILE_MS,
  );
});
