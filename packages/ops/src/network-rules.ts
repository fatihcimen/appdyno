import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { NetworkEntry, NetworkRule, NetworkThrottle } from '@appdyno/core';
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

/** A rule's line turned off, or on again: the same rule, by its id. */
export function ruleSwitched(line: string, on: boolean) {
  const st = ruleStep(line);
  const { off: _, ...args } = st.args;
  return stepLine({ ...st, args: on ? args : { ...args, off: true } }).replace(/^mock /, '');
}

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

const KBIT = 125;
/** A slow network by name, as an emulator's console has them: bytes a second up and down, and the wait it adds. */
const SPEEDS: Record<string, [up: number, down: number, min: number, max: number]> = {
  // an EDGE speed with the short wait `device_setting network slow` gives an emulator
  slow: [118.4 * KBIT, 236.8 * KBIT, 40, 100],
  gsm: [14.4 * KBIT, 14.4 * KBIT, 150, 550],
  gprs: [40 * KBIT, 80 * KBIT, 150, 550],
  edge: [118.4 * KBIT, 236.8 * KBIT, 80, 400],
  umts: [128 * KBIT, 1920 * KBIT, 35, 200],
  hsdpa: [348 * KBIT, 14_400 * KBIT, 0, 0],
  lte: [58_000 * KBIT, 173_000 * KBIT, 0, 0],
};
const THROTTLE_KEYS = ['delayMs', 'down', 'up', 'loss'] as const;
const MAX_DELAY_MS = 600_000;
export const THROTTLE_SAYS = `full, ${Object.keys(SPEEDS).join(', ')}, a number (bytes a second down), or delayMs= down= up= loss=`;

/**
 * A slow network from its word: a name, bytes a second down alone as a phone's cap is, or `delayMs=`, `down=`, `up=`
 * (bytes a second) and `loss=` (percent of requests). Nothing for `full`.
 */
export function throttleOf(value: string): NetworkThrottle | undefined {
  const word = value.trim().toLowerCase();
  if (word === 'full') return undefined;
  const speed = SPEEDS[word];
  if (speed) return { delayMs: [speed[2], speed[3]], down: speed[1], up: speed[0], loss: 0 };
  if (/^\d+$/.test(word) && Number(word) > 0)
    return { delayMs: [0, 0], down: Number(word), up: 0, loss: 0 };
  const wrong = () =>
    new ToolError(`throttle is ${THROTTLE_SAYS}, not ${value}`, 'INVALID_ARGUMENT');
  const given: Partial<Record<(typeof THROTTLE_KEYS)[number], number>> = {};
  for (const part of value.trim().split(/\s+/)) {
    const [key, n] = part.split('=');
    const name = THROTTLE_KEYS.find((k) => k === key);
    const number = Number(n);
    if (!name || !n || !Number.isFinite(number) || number < 0) throw wrong();
    given[name] = number;
  }
  if ((given.loss ?? 0) > 100 || (given.delayMs ?? 0) > MAX_DELAY_MS) throw wrong();
  const delay = given.delayMs ?? 0;
  return {
    delayMs: [delay, delay],
    down: given.down ?? 0,
    up: given.up ?? 0,
    loss: given.loss ?? 0,
  };
}
