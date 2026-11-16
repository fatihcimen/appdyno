import { pause, selectIn, type ScreenElement } from '@appdyno/core';
import { selectorLine, type FlowStep } from '@appdyno/flows';
import type { Session } from '../session.js';
import { ToolError, type ToolResult } from '../tool.js';
import { REPLAY_WAIT_MS } from './op-call.js';

/** Between two reads of a clipboard that does not hold what a step waits for. */
const CLIPBOARD_GAP_MS = 250;

/**
 * The checks a run makes itself, by a read of the device and no tool: how many elements a selector names, and what the
 * clipboard holds. No tool's answer is their verdict, so no tool's schema grows by them.
 */
export const checkedHere = (st: FlowStep) =>
  (st.action === 'assert' && st.args.check === 'count') ||
  (st.action === 'clipboard' && st.args.text === undefined);

/** A count that `equals=`, or `min=` and `max=`, allow. */
const countFits = (a: FlowStep['args'], n: number) =>
  a.equals !== undefined
    ? n === Number(a.equals)
    : n >= ((a.min as number | undefined) ?? 0) && n <= ((a.max as number | undefined) ?? Infinity);

const countWanted = (a: FlowStep['args']) =>
  a.equals !== undefined
    ? String(a.equals)
    : [
        ...(a.min !== undefined ? [`at least ${String(a.min)}`] : []),
        ...(a.max !== undefined ? [`at most ${String(a.max)}`] : []),
      ].join(' and ');

/**
 * Such a check, waited for as an `assert` is: it holds, or the step fails saying what the device held, a secret in it
 * hidden.
 */
export async function checkHere(
  s: Session,
  st: FlowStep,
  clean: (text: string) => string,
  line: (e: ScreenElement) => string,
) {
  const a = st.args;
  const ms = (a.timeoutMs as number | undefined) ?? REPLAY_WAIT_MS;
  if (st.action === 'assert') {
    const sel = st.selector ?? {};
    const { screen } = await s.until((x) => countFits(a, selectIn(x.list, sel).length), ms);
    if (!screen) throw new ToolError('the screen could not be read to count on', 'CHECK_FAILED');
    const hits = selectIn(screen.list, sel);
    if (countFits(a, hits.length)) return;
    throw new ToolError(
      clean(
        `${hits.length} elements match ${selectorLine(sel)}, not ${countWanted(a)}${hits.length > 0 ? `: ${hits.slice(0, 5).map(line).join('; ')}` : ''}`,
      ),
      'CHECK_FAILED',
    );
  }
  const want = String(a.equals ?? a.contains);
  const holds = (held: string | undefined) =>
    held !== undefined && (a.equals !== undefined ? held === want : held.includes(want));
  const until = Date.now() + ms;
  let held = await s.device.getClipboard();
  while (!holds(held) && Date.now() < until) {
    await pause(CLIPBOARD_GAP_MS);
    held = await s.device.getClipboard();
  }
  if (holds(held)) return;
  throw new ToolError(
    `the clipboard ${held === undefined ? 'is empty' : `holds ${JSON.stringify(clean(held))}`}: it ${a.equals !== undefined ? 'is not' : 'has no'} ${JSON.stringify(clean(want))}`,
    'CHECK_FAILED',
  );
}

/** An `audit` step's verdict on what the audit found: more issues than `max=` allows, 0 unless given, fail it. */
export function auditWithin(st: FlowStep, answered: ToolResult) {
  const { issues, truncated } = answered.data as { issues: unknown[]; truncated: boolean };
  const max = (st.args.max as number | undefined) ?? 0;
  // an audit cut short found more than it lists: no count of it is under a threshold
  if (!truncated && issues.length <= max) return;
  const said = answered.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
  throw new ToolError(
    `${said.split('\n').slice(0, 6).join('\n')}\nthis step allows ${max}`,
    'CHECK_FAILED',
  );
}
