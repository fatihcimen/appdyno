import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/usage.js';

/** A file people copy and nothing here runs: what can rot in it is held to the command table. */
const file = readFileSync(join(import.meta.dirname, '../../../docs/perf-gate.yml'), 'utf8');
const code = file
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');

const calls = [...code.matchAll(/\$APPDYNO (.+)$/gm)].map((m) => m[1]!.split(' '));

const tableEntry = (words: string[]) =>
  Object.keys(COMMANDS).find((name) => {
    const [first, second] = name.split(' ');
    return first === words[0] && (!second || second.split('|').includes(words[1]!));
  }) as keyof typeof COMMANDS | undefined;

describe('the workflow file', () => {
  it('calls the gate from its base to its comment', () => {
    expect(calls.map((c) => c.slice(0, 2).join(' '))).toEqual([
      'test "$FLOW"',
      'perf baseline',
      'perf reference',
      'test "$FLOW"',
      'perf why',
      'perf comment',
    ]);
  });

  it.each(calls.map((c) => [c.join(' '), c] as const))(
    '%s is a command, with its flags',
    (_, c) => {
      const name = tableEntry(c);
      expect(name).toBeDefined();
      const args = c.slice(name!.split(' ').length);
      const { flags } = COMMANDS[name!] as { flags?: ParseArgsConfig['options'] };
      expect(() => parseArgs({ args, options: flags ?? {}, allowPositionals: true })).not.toThrow();
    },
  );

  it('says what it cannot do, as the dashboard does', () => {
    expect(file).toContain('REAL MEASUREMENT NEEDS A REAL DEVICE');
    expect(file).toContain('real frame rates, frozen frames, hitches and energy need a phone');
    expect(file).toContain("GitHub's arm64 macOS runners");
  });

  it('holds no token but the repository’s own, and never runs a fork with a writing one', () => {
    expect(code.match(/\$\{\{[^}]*\}\}/g)!.filter((x) => /token|secret/i.test(x))).toEqual([
      '${{ github.token }}',
    ]);
    expect(code).not.toContain('pull_request_target');
    expect(code).toContain('gh pr comment "$PR" --repo "$GITHUB_REPOSITORY" --body-file');
  });

  it('takes the baseline as ready by its own exit, which is non-zero until it can call a change', () => {
    const steps = code.split('- name: ');
    const base = steps.find((s) => s.startsWith('The base'))!;
    expect(base).toContain('if $APPDYNO perf baseline --app "$APP"; then ready=yes; break; fi');
    expect(base).toContain('[ "$ready" = yes ]');
    expect(base).not.toContain('added');
  });

  it('writes the comment and fails the job whatever the gate said', () => {
    const steps = code.split('- name: ');
    const named = (start: string) => steps.find((s) => s.startsWith(start))!;
    expect(named('The gate')).toContain('continue-on-error: true');
    expect(named('The comment')).toContain('if: always()');
    expect(named('Fail on')).toContain("steps.gate.outcome == 'failure'");
  });
});
