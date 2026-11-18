import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach } from 'vitest';
import { stateDir } from './workspace.js';

/**
 * Every suite on a device, by the config: where a run keeps what it leaves (`APPDYNO_SMOKE_OUT`, as the simulator smoke
 * on a hosted Mac does, which no one watches), the simulator's screen as a case failed on it and the runner's log as it
 * stood then, named by the case: each start of a runner begins its log again.
 */
const out = process.env.APPDYNO_SMOKE_OUT;
const udid = process.env.APPDYNO_IOS_UDID;

if (out && udid)
  beforeEach(({ task, onTestFailed }) => {
    onTestFailed(() => {
      const named = join(out, task.name.replace(/[^\w.-]+/g, '-').slice(0, 80));
      try {
        execFileSync('xcrun', ['simctl', 'io', udid, 'screenshot', `${named}.png`], {
          stdio: 'ignore',
          timeout: 30_000,
        });
        copyFileSync(join(stateDir(), `ios-${udid}.log`), `${named}.runner.log`);
      } catch {
        // a screen or a log that cannot be taken leaves the failure as it was
      }
    });
  });
