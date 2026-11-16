import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { NetworkEntry, NetworkRule } from '@appdyno/core';
import { FlowError, mockRule, parseFlow, stepLine, type FlowStep } from '@appdyno/flows';
import { ToolError } from './tool.js';

export const MAX_RULES = 50;

/** A rule's line read as the flow step `mock` it is the words of; what is no rule is refused in a rule's words. */
export function ruleStep(line: string): FlowStep {
  try {
    const { steps } = parseFlow(`mock ${line.replace(/[\r\n]+/g, ' ')}`);
    const [step] = steps;
    if (!step || steps.length > 1 || step.action !== 'mock') throw new FlowError('one rule', 0);
    return step;
  } catch (e) {
    if (!(e instanceof FlowError)) throw e;
    throw new ToolError(
      `not a rule: ${line}: ${e.message.replace(/^line 1: (mock: )?/, '')}`,
      'INVALID_ARGUMENT',
      'host/path* then status=, body=, type=, header=, delayMs=, fail=offline|timeout|reset, to=host, method=, query=, regex=, times=, off',
    );
  }
}

/** A rule as it is written, the same from every way of writing it. */
export const ruleLine = (line: string) => stepLine(ruleStep(line)).replace(/^mock /, '');

/**
 * The file a rule answers with, inside the folder this server runs in once its links are followed, as `media` has it:
 * a client names the path, and what it reads goes to an app and from there into a capture.
 */
function bodyFile(name: string) {
  const root = realpathSync(process.cwd());
  const given = resolve(name);
  let real: string;
  try {
    real = realpathSync(given);
  } catch {
    throw new ToolError(`${given}: no such file`, 'NOT_FOUND');
  }
  const r = relative(root, real);
  if (r.startsWith('..') || isAbsolute(r))
    throw new ToolError(
      `${given} is outside the folder this server runs in`,
      'POLICY_DENIED',
      `give a path inside ${root}`,
    );
  if (!statSync(real).isFile()) throw new ToolError(`${given} is not a file`, 'INVALID_ARGUMENT');
  return real;
}

/** The rules of those lines as the probe reads them, each file it answers with placed. */
export function rulesOf(lines: string[]): NetworkRule[] {
  if (lines.length > MAX_RULES)
    throw new ToolError(`${lines.length} rules: at most ${MAX_RULES}`, 'INVALID_ARGUMENT');
  return lines.map((line) => {
    const rule = mockRule(ruleStep(line));
    return rule.bodyFile ? { ...rule, bodyFile: bodyFile(rule.bodyFile) } : rule;
  });
}

/** Each rule's line with what it took of the requests seen. */
export function ruleHits(lines: string[], entries: NetworkEntry[]) {
  return lines.map((line) => {
    const rule = mockRule(ruleStep(line));
    return {
      rule: line,
      hits: entries.filter((e) => e.rule === rule.id).length,
      ...(rule.off && { off: true }),
    };
  });
}
