import { reportProgress, throwIfCancelled, type ActOptions } from '@appdyno/core';
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
import { ActionOut } from './schemas.js';
import { Read, Step } from './step-schemas.js';
import type { Steps } from './steps.js';
import { NOT_A_STEP } from './tool-kinds.js';
import {
  ACT,
  argumentsHint,
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

/** One step, whole before anything acts: a touch of this file, or another tool's call. */
type Planned =
  | { st: Step; read?: ReadMode; op?: undefined }
  | { op: Op; args: Record<string, unknown>; st?: undefined };

const StepRead = z.enum(['diff', 'full', 'none']).optional();

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
  x: { action: string } & Record<string, unknown>,
  i: number,
): Planned {
  const { action, ...args } = x;
  const op = tools()[action];
  const fail = (why: string, hint?: string) =>
    new ToolError(`step ${i + 1}: ${why}`, 'INVALID_ARGUMENT', hint);
  const takes = Step.options.find((o) => o.shape.action.value === action);
  if (takes) {
    const { read: own, ...rest } = x;
    const reads = StepRead.safeParse(own);
    if (!reads.success) throw fail(z.prettifyError(reads.error));
    const p = Step.safeParse(rest);
    if (p.success) return { st: p.data, ...(reads.data && { read: reads.data }) };
    // a selector's words at the top: shown where they go
    throw fail(
      z.prettifyError(p.error),
      inSelector(takes, rest, p.error.issues) ?? argumentsHint(p.error.issues),
    );
  }
  if (!op || NOT_A_STEP.has(action)) throw fail(`no step ${action}`);
  const p = op.input.safeParse(args);
  if (!p.success) throw fail(z.prettifyError(p.error));
  return { op, args: p.data };
}

/** Several actions in one call, each a touch of the screen or another tool. */
export function stepsOp(
  ctx: ServerContext,
  { act, summary, header, show, clean, cleanLog }: Answers,
  { step }: Steps,
  tools: () => Record<string, Op>,
) {
  return defineOp({
    name: 'steps',
    title: 'Steps',
    description: `A sequence in one call: at most ${MAX_STEPS}, each { action: a tool's name, ...its arguments }, as { action: tap, selector: { text: OK } }; any tool but steps and flow, and double_tap, long_press, drag as gesture's. Stops at the first failure, saying which and why. All answers come back, images too; a touch reads the screen only with read on its step, or last.`,
    input: z
      .object({
        steps: z
          .array(
            z.object({ action: z.string({ error: "a tool's name, as tap or type_text" }) }).loose(),
          )
          .min(1)
          .max(MAX_STEPS),
        read: Read,
      })
      .strict(),
    output: ActionOut,
    annotations: ACT,
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
        const name = p.op ? p.op.name : p.st.action;
        seen = front ?? s.fresh?.foreground ?? seen;
        const was = asStepBegan(s, seen);
        [since, began] = [began, Date.now()];
        try {
          throwIfCancelled('steps');
          reportProgress(`step ${i + 1} of ${plan.length}: ${name}`);
          if (p.op) {
            // an image asked for at a step is that step's evidence, even of a screen that has not changed
            if (name === 'screenshot') s.pictured();
            const r = await p.op.handler(p.args);
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
          const r = await act(
            s,
            reads,
            async (o) => {
              const x = await attempt(o);
              stepDone = x.done;
              return x.r;
            },
            () => stepDone,
          );
          done.push(`${i + 1}. ${answerText(r)}`);
          if (last) ending = r;
          front = r.data.foreground;
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
          const screen = await s.read().catch(() => undefined);
          if (screen) show(s, screen);
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
              ...(screen ? [header(screen)] : []),
            ].join('\n'),
            own || appDied ? 'APP_NOT_RUNNING' : e.code,
            appDied ? diedHint(appDied) : e.hint,
            e.dispatched,
          );
        }
      }
      const all = done.join('\n');
      return reply(all, { ...(ending?.data ?? summary('')), done: clean(all) }, images);
    },
  });
}
