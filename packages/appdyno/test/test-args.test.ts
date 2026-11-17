import { describe, expect, it } from 'vitest';
import { testCommand } from '../src/test-command.js';

/** No device is opened for words that are wrong. */
const open = (): never => {
  throw new Error('a device was opened');
};

const run = async (...words: string[]) => {
  const said: string[] = [];
  const code = await testCommand(words, open, (line) => said.push(line));
  return { code, said: said.join('\n') };
};

describe('appdyno test, given wrong words', () => {
  it('exits 2 for a flag it does not take, with the flag and its usage, before a device is opened', async () => {
    for (const words of [
      ['flows', '--nope'],
      ['merge', 'a', '--out', 'b', '--nope'],
      ['share', 'a', '--nope'],
      ['comment', 'a', '--nope'],
    ]) {
      const { code, said } = await run(...words);
      expect(code, words.join(' ')).toBe(2);
      expect(said, words.join(' ')).toContain("'--nope'");
      expect(said, words.join(' ')).toContain('usage: appdyno test');
    }
  });

  it('exits 2 for --measure with --retries, as the gate takes no retried go', async () => {
    const { code, said } = await run('flows', '--measure', '--retries', '1');
    expect(code).toBe(2);
    expect(said).toMatch(/^--measure takes no --retries/);
  });
});
