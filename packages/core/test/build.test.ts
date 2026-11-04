import { describe, expect, it } from 'vitest';
import { inCall, runBuild } from '../src/index.js';

const WORDS = { step: /^STEP \w+/, error: /^bad/ };
const shell = (script: string) => runBuild('sh', ['-c', script], WORDS);

describe('runBuild', () => {
  it('tells each step once, in order', async () => {
    const said: string[] = [];
    await inCall({ progress: (m) => said.push(m) }, () =>
      shell('echo STEP one; echo STEP one; echo noise; echo STEP two 1>&2'),
    );
    expect(said).toEqual(['STEP one', 'STEP two']);
  });

  it('says what the build said was wrong, or how it ended', async () => {
    await expect(shell('echo bad thing; exit 3')).rejects.toMatchObject({
      code: 'BUILD_FAILED',
      message: 'the build failed:\nbad thing',
    });
    await expect(shell('exit 3')).rejects.toMatchObject({
      code: 'BUILD_FAILED',
      message: 'the build failed:\nsh ended with 3',
    });
  });

  it('stops the build when the client cancels', async () => {
    const stop = new AbortController();
    const running = inCall({ signal: stop.signal }, () => shell('exec sleep 30'));
    stop.abort();
    await expect(running).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('says so when the tool is not there', async () => {
    await expect(runBuild('/no/such/tool', [], WORDS)).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  });
});
