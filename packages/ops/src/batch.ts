import { reportProgress, throwIfCancelled, type ActOptions, type Screen } from '@appdyno/core';
import { z } from 'zod';
import { SETTLE, type Answers, type ReadMode } from './answers.js';
import {
  aimedApp,
  AppDied,
  appDeath,
  asStepBegan,
  diedHint,
  diedLine,
  diedRefusal,
  diedUnder,
  pidInAnswer,
} from './app-death.js';
import type { ServerContext } from './context.js';
import { renamedHint } from './renamed.js';
import { ActionOut } from './schemas.js';
import { LOOKS_ONLY, Read, Step } from './step-schemas.js';
import { hintWithScreen, type Steps } from './steps.js';
import { NOT_A_STEP } from './tool-kinds.js';
import {
  ACT,
  beyond,
  argumentsHint,
  CHANGE_HINT,
  defineOp,
  inSelector,
  refusedAction,
  reply,
  ToolError,
  type Block,
  type Op,
  type ToolResult,
} from './tool.js';

// 30 took 13 s on an emulator and 21 s on a simulator at load 12, and up to 56 s on a loaded Mac, near a client's usual 60 s: each step says its progress
const MAX_STEPS = 30;

/** One step, whole before anything acts: the touch or check a tool's call is, or another tool's call. */
type Planned =
  | { tool: string; st: Step; read?: ReadMode; op?: undefined }
  | { tool: string; op: Op; args: Record<string, unknown>; st?: undefined; ownRead: boolean };

const answerText = (r: ToolResult) =>
  r.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');

/** Whether a step looks at the screen, so that the step before it must have settled. */
const readsScreen = (st: Step | undefined) =>
  !!st &&
  (st.action === 'wait_for' ||
    st.action === 'assert' ||
    st.action === 'scroll_to' ||
    ('ref' in st && !!st.ref) ||
    ('selector' in st && !!st.selector));

/** One step of a call, checked whole before anything acts. */
function planned(
  tools: () => Record<string, Op>,
  x: { tool: string } & Record<string, unknown>,
  i: number,
): Planned {
  const { tool, ...args } = x;
  const { read: _, ...shown } = x;
  const op = tools()[tool];
  const fail = (why: string, hint?: string) =>
    new ToolError(`step ${i + 1}: ${why}`, 'INVALID_ARGUMENT', hint);
  // said, or a client looks for what the steps before it did
  if (!op || NOT_A_STEP.has(tool)) throw fail(`no step ${tool}`, renamedHint(tool) ?? CHANGE_HINT);
  const p = op.input.safeParse(args);
  if (!p.success)
    throw fail(
      z.prettifyError(p.error),
      // a selector's words at the top: shown where they go
      inSelector(op.input, shown, p.error.issues) ?? argumentsHint(p.error.issues),
    );
  const ownRead = 'read' in args;
  const { read, ...touch } = p.data as { read?: ReadMode } & Record<string, unknown>;
  let st: Step | undefined;
  try {
    st = op.step?.(touch);
  } catch (e) {
    if (!(e instanceof ToolError)) throw e;
    throw fail(e.message, e.hint);
  }
  return st ? { tool, st, ...(ownRead && read && { read }) } : { tool, op, args: p.data, ownRead };
}

/** Several actions in one call, each a touch of the screen or another tool. */
export function stepsOp(
  ctx: ServerContext,
  { act, summary, left, clean, cleanLog }: Answers,
  { step }: Steps,
  tools: () => Record<string, Op>,
) {
  return defineOp({
    name: 'run_steps',
    title: 'Run steps',
    description: `Run known actions as one call: at most ${MAX_STEPS}, each { tool: a tool's name, ...its arguments }, as { tool: tap_screen, selector: { text: OK } }; any tool but run_steps and run_flow. Stops at the first failure, saying which and why. Returns every answer, images too; a step reads the screen only with read on it, or last. A saved sequence: run_flow.`,
    input: z
      .object({
        steps: z
          .array(
            z
              .object({ tool: z.string({ error: "a tool's name, as tap_screen or type_text" }) })
              .loose(),
          )
          .min(1)
          .max(MAX_STEPS),
        read: Read,
      })
      .strict(),
    output: ActionOut,
    // as far as the tools it runs reach
    annotations: beyond(ACT),
    run: async ({ steps: raw, read }) => {
      const plan = raw.map((x, i) => planned(tools, x, i));
      let s = await ctx.session();
      const done: string[] = [];
      const images: Block[] = [];
      let ending: ToolResult<ActionOut> | undefined;
      /** What was in front after the last step, where it was told. */
      let front: string | undefined;
      const inFront = () => s.device.foreground().catch(() => undefined);
      /** When the step before this one began: a crash a step failed for came in it, or in this one. */
      let since = Date.now();
      let began = since;
      /** What was last known in front, through the steps that read nothing. */
      let seen = s.fresh?.foreground;
      for (const [i, p] of plan.entries()) {
        const last = i === plan.length - 1;
        const name = p.tool;
        seen = front ?? s.fresh?.foreground ?? seen;
        const was = asStepBegan(s, seen);
        [since, began] = [began, Date.now()];
        try {
          throwIfCancelled('steps');
          reportProgress(`step ${i + 1} of ${plan.length}: ${name}`);
          if (p.op) {
            // an image asked for at a step is that step's evidence, even of a screen that has not changed
            if (name === 'take_screenshot') s.pictured();
            // a tool's screen is read as a touch's is: where its step says, or at the last as the call says
            const reads = 'read' in p.op.input.shape && !p.ownRead;
            const r = await p.op.handler(
              reads ? { ...p.args, read: last ? read : 'none' } : p.args,
            );
            done.push(`${i + 1}. ${answerText(r)}`);
            images.push(...r.blocks.filter((b) => b.type === 'image'));
            // it may have selected another device
            s = await ctx.session();
            front = (r.data as Partial<ActionOut>).foreground;
            continue;
          }
          const st = p.st;
          // a refusal here, not at the op's end: the catch below says which step it was
          const attempt = (o: ActOptions) => step(s, st, o, true).catch(refusedAction);
          const reads = p.read ?? (last ? read : undefined);
          if (!reads) {
            // only typing stays on its screen: a key after a tap that opened one must reach it, not the transition
            const stays = st.action === 'type_text' && !st.submit && !readsScreen(plan[i + 1]?.st);
            // a death is told only of an app that was in front; none selected: the one in front as the step began
            const fg = front ?? (await inFront());
            const app = s.appId ?? fg;
            const up = app !== undefined && fg === app;
            const pidOf = up && s.device.appPid ? app : undefined;
            const opts = !stays
              ? ({
                  settle: SETTLE,
                  read: 'none',
                  ...(s.fresh && { before: s.fresh.hash }),
                  ...(pidOf && { pidOf }),
                } as const)
              : ({ settle: false, read: 'none', ...(pidOf && { pidOf }) } as const);
            const pid = up
              ? ((app === s.appId ? s.appPid : undefined) ??
                (await s.device.appPid?.(app).catch(() => undefined)))
              : undefined;
            const started = Date.now();
            const x = await attempt(opts);
            const aimed = aimedApp(s);
            s.acted();
            const looks = s.appId ? up : aimed !== undefined;
            front = looks ? await inFront() : undefined;
            const appDied = looks
              ? await appDeath(
                  s,
                  aimed,
                  front,
                  aimed === app ? pid : undefined,
                  started,
                  clean,
                  true,
                  aimed === app ? pidInAnswer(pidOf, x.r) : undefined,
                )
              : undefined;
            if (appDied && aimed)
              throw await diedRefusal(s, aimed, x.done, appDied, {
                wasPid: aimed === app ? pid : undefined,
                since: started,
                clean,
                cleanLog,
              });
            done.push(`${i + 1}. ${x.done}`);
            continue;
          }
          let stepDone = '';
          // a step that only looked, or found what it scrolled to, is no action whose change is to be seen
          let said = LOOKS_ONLY.has(st.action);
          let back: ((x: Screen) => boolean) | undefined;
          const r = await act(
            s,
            reads,
            async (o) => {
              const x = await attempt(o);
              stepDone = x.done;
              said ||= x.found === true;
              back = x.back;
              return x.r;
            },
            () => stepDone,
            () => said,
            (x) => back?.(x) ?? true,
          );
          done.push(`${i + 1}. ${answerText(r)}`);
          if (last) ending = r;
          front = r.data.foreground;
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
          const screen = await s.read().catch(() => undefined);
          const own = e instanceof AppDied;
          const appDied = own
            ? undefined
            : await diedUnder(s, was.app, screen?.foreground, was.pid, since, clean, was.up);
          throw new ToolError(
            [
              ...done,
              own
                ? `${i + 1}. ${e.message}\nthe app died in step ${i + 1}, ${name}: the rest were not run`
                : `${i + 1}. ${name} failed, the rest were not run: ${e.message}`,
              ...(appDied ? [`${diedLine(appDied)}, by step ${i + 1}`] : []),
              // as the call asked to read: what differs from the screen shown last, or all of it
              ...(screen ? [left(s, screen, read === 'diff' ? 'diff' : 'full')] : []),
            ].join('\n'),
            own || appDied ? 'APP_NOT_RUNNING' : e.code,
            appDied ? diedHint(appDied) : screen ? hintWithScreen(e.hint) : e.hint,
            e.dispatched,
          );
        }
      }
      const all = done.join('\n');
      return reply(all, { ...(ending?.data ?? summary('')), done: clean(all) }, images);
    },
  });
}
