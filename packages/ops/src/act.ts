import { alertAnswer, reportProgress, throwIfCancelled, type ActOptions } from '@appdyno/core';
import { z } from 'zod';
import { SETTLE, type Answers, type ReadMode } from './answers.js';
import type { ServerContext } from './context.js';
import { ActionOut } from './schemas.js';
import { pinchPaths } from './gesture-paths.js';
import {
  AssertStep,
  Coord,
  KeyStep,
  MAX_TYPED,
  Read,
  ScrollStep,
  Step,
  SwipeStep,
  Target,
  TypeStep,
} from './step-schemas.js';
import type { Steps } from './steps.js';
import {
  ACT,
  defineOp,
  READ,
  refusedAction,
  reply,
  ToolError,
  type Block,
  type Op,
  type ToolResult,
} from './tool.js';

// 30 took 13 s on an emulator and 21 s on a simulator at load 12, and up to 56 s on a loaded Mac, near a client's usual 60 s: each step says its progress
const MAX_STEPS = 30;
const PINCH_MS = 400;
const KEYBOARD_GONE_MS = 1_500;

/** What cannot be a step: `steps` in itself, and a flow's own sequence. */
const NOT_A_STEP = new Set(['steps', 'flow']);

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

export function actOps(
  ctx: ServerContext,
  { act, summary, header, show, clean, afterChange }: Answers,
  { one, step, windowSize, onTheScreen, checkNow }: Steps,
  tools: () => Record<string, Op>,
) {
  const planned = (x: { action: string } & Record<string, unknown>, i: number): Planned => {
    const { action, ...args } = x;
    const op = tools()[action];
    const fail = (why: string) => new ToolError(`step ${i + 1}: ${why}`, 'INVALID_ARGUMENT');
    if (Step.options.some((o) => o.shape.action.value === action)) {
      const { read: own, ...rest } = x;
      const reads = StepRead.safeParse(own);
      if (!reads.success) throw fail(z.prettifyError(reads.error));
      const p = Step.safeParse(rest);
      if (!p.success) throw fail(z.prettifyError(p.error));
      return { st: p.data, ...(reads.data && { read: reads.data }) };
    }
    if (!op || NOT_A_STEP.has(action)) throw fail(`no step ${action}`);
    const p = op.input.safeParse(args);
    if (!p.success) throw fail(z.prettifyError(p.error));
    return { op, args: p.data };
  };

  return [
    defineOp({
      name: 'tap',
      title: 'Tap',
      description:
        'Tap a target: ref, x,y or selector; answers the settled screen (read). Several matches refuse, listing refs; no match waits briefly, then refuses with the nearest labels.',
      input: z.object({ ...Target, read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ read, ...a }) => one(await ctx.session(), { action: 'tap', ...a }, read),
    }),
    defineOp({
      name: 'gesture',
      title: 'Gesture',
      description:
        'Double tap, long press or drag at the target, or pinch. drag: to `to` over durationMs, no flick; holdMs first lifts a row or icon. pinch: scale > 1 zooms in, < 1 out, at x,y or the middle. plan: free paths in `pointers`, one per finger, t in ms.',
      input: z
        .object({
          kind: z.enum(['double_tap', 'long_press', 'drag', 'pinch', 'plan']),
          ...Target,
          to: z.object(Target).strict().optional(),
          scale: z.number().min(0.2).max(5).optional(),
          durationMs: z.number().int().min(50).max(10_000).optional(),
          holdMs: z.number().int().min(0).max(5_000).optional(),
          pointers: z
            .array(z.array(z.object({ x: Coord, y: Coord, t: z.number().min(0) })))
            .optional(),
          read: Read,
        })
        .strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ kind, to, pointers, scale, durationMs, holdMs, read, ...a }) => {
        const s = await ctx.session();
        const during = durationMs !== undefined && { durationMs };
        switch (kind) {
          case 'double_tap':
            return one(s, { action: 'double_tap', ...a }, read);
          case 'long_press':
            return one(s, { action: 'long_press', ...a, ...during }, read);
          case 'drag':
            if (!to) throw new ToolError('drag needs to', 'INVALID_ARGUMENT');
            return one(
              s,
              { action: 'drag', ...a, to, ...during, ...(holdMs !== undefined && { holdMs }) },
              read,
            );
          case 'pinch': {
            if (scale === undefined) throw new ToolError('pinch needs scale', 'INVALID_ARGUMENT');
            await s.beforeTouch();
            await onTheScreen(s, [a]);
            const size = await windowSize(s);
            const c = { x: a.x ?? size.w / 2, y: a.y ?? size.h / 2 };
            const paths = pinchPaths(c, scale, durationMs ?? PINCH_MS, size);
            return act(
              s,
              read,
              (o) => s.device.act({ kind: 'gesture', pointers: paths }, o),
              `pinched (×${scale})`,
            );
          }
          case 'plan': {
            const fingers = pointers ?? [];
            if (fingers.length < 1 || fingers.length > 5 || fingers.some((p) => p.length < 1))
              throw new ToolError(
                'plan needs pointers: 1 to 5 fingers, each with its points',
                'INVALID_ARGUMENT',
              );
            await s.beforeTouch();
            await onTheScreen(s, fingers.flat());
            return act(
              s,
              read,
              (o) => s.device.act({ kind: 'gesture', pointers: fingers }, o),
              `gesture (${fingers.length} finger${fingers.length > 1 ? 's' : ''})`,
            );
          }
        }
      },
    }),
    defineOp({
      name: 'swipe',
      title: 'Swipe',
      description:
        'Swipe, from a target if given; up: the content moves up, a list scrolls on. exact: the content moves distance and stops, by strokes; the answer says how far.',
      input: z.object({ ...SwipeStep.omit({ action: true }).shape, read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ read, ...a }) => one(await ctx.session(), { action: 'swipe', ...a }, read),
    }),
    defineOp({
      name: 'scroll_to',
      title: 'Scroll to',
      description:
        "Scroll until the selector's element is on screen; direction as swipe's; x,y: a point in the list if several. Refuses at the list's end, with the nearest labels.",
      input: z.object({ ...ScrollStep.omit({ action: true }).shape, read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ read, ...a }) => one(await ctx.session(), { action: 'scroll_to', ...a }, read),
    }),
    defineOp({
      name: 'type_text',
      title: 'Type text',
      description: `Type up to ${MAX_TYPED} characters of Unicode into the focused field, or a target, tapped and focused first. replace: the field's text; submit: then enter.`,
      input: z.object({ ...TypeStep.omit({ action: true }).shape, read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ read, ...a }) => one(await ctx.session(), { action: 'type_text', ...a }, read),
    }),
    defineOp({
      name: 'press_key',
      title: 'Press key',
      description:
        'Press a key or button: back, home, enter, delete, tab, escape, space, arrow_up/down/left/right, app_switch, volume_up/down, mute, siri, power, lock; or a letter or digit, held keys first: command+a (Android: Ctrl). control_center, notification_center, spotlight open those; home closes them.',
      input: z.object({ ...KeyStep.omit({ action: true }).shape, read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ read, ...a }) => one(await ctx.session(), { action: 'press_key', ...a }, read),
    }),
    defineOp({
      name: 'keyboard',
      title: 'Keyboard',
      description:
        'The on-screen keyboard. status: is it open; dismiss: refused if the app keeps it open; enter: its enter key.',
      input: z.object({ action: z.enum(['status', 'dismiss', 'enter']), read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ action, read }) => {
        const s = await ctx.session();
        if (action === 'enter') return one(s, { action: 'press_key', key: 'enter' }, read);
        const screen = await s.read();
        const open = s.device.platformScreen.keyboardOpen(screen.tree);
        if (action === 'status') {
          const t = `the keyboard is ${open ? 'open' : 'closed'}`;
          return reply(t, { ...summary(t), open });
        }
        if (!open) return reply('no keyboard is open', summary('no keyboard is open'));
        await s.device.dismissKeyboard();
        s.acted();
        const gone = await s.until(
          (x) => !s.device.platformScreen.keyboardOpen(x.tree),
          KEYBOARD_GONE_MS,
        );
        if (!gone.met)
          throw new ToolError(
            'the keyboard stayed open: the app keeps it there',
            'UNSUPPORTED',
            'keyboard enter closes it on a field whose return key does so, and may submit the form',
          );
        const r = await afterChange(s, 'closed the keyboard', read);
        return { ...r, data: { ...r.data, closed: true } };
      },
    }),
    defineOp({
      name: 'steps',
      title: 'Steps',
      description: `A sequence in one call: at most ${MAX_STEPS}, each { action: a tool's name, ...its arguments }; any tool but steps and flow, and double_tap, long_press, drag as gesture's. Stops at the first failure, saying which and why. All answers come back, images too; a touch reads the screen only with read on its step, or last.`,
      input: z
        .object({
          steps: z
            .array(z.object({ action: z.string() }).loose())
            .min(1)
            .max(MAX_STEPS),
          read: Read,
        })
        .strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ steps: raw, read }) => {
        const plan = raw.map(planned);
        let s = await ctx.session();
        const done: string[] = [];
        const images: Block[] = [];
        let ending: ToolResult<ActionOut> | undefined;
        for (const [i, p] of plan.entries()) {
          const last = i === plan.length - 1;
          const name = p.op ? p.op.name : p.st.action;
          try {
            throwIfCancelled('steps');
            reportProgress(`step ${i + 1} of ${plan.length}: ${name}`);
            if (p.op) {
              // an image asked for at a step is that step's evidence, even of a screen that has not changed
              if (name === 'screenshot') s.shot = undefined;
              const r = await p.op.handler(p.args);
              done.push(`${i + 1}. ${answerText(r)}`);
              images.push(...r.blocks.filter((b) => b.type === 'image'));
              // it may have selected another device
              s = await ctx.session();
              continue;
            }
            const st = p.st;
            // a refusal here, not at the op's end: the catch below says which step it was
            const attempt = (o: ActOptions) => step(s, st, o, true).catch(refusedAction);
            const reads = p.read ?? (last ? read : undefined);
            if (!reads) {
              // only typing into a field stays on its screen: a key after a tap that opened a
              // screen must reach that screen, not the transition
              const stays =
                st.action === 'type_text' && !st.submit && !readsScreen(plan[i + 1]?.st);
              const opts = !stays
                ? ({
                    settle: SETTLE,
                    read: 'none',
                    ...(s.fresh && { before: s.fresh.hash }),
                  } as const)
                : ({ settle: false, read: 'none' } as const);
              const x = await attempt(opts);
              s.acted();
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
          } catch (e) {
            if (!(e instanceof ToolError)) throw e;
            const screen = await s.read().catch(() => undefined);
            if (screen) show(s, screen);
            throw new ToolError(
              [
                ...done,
                `${i + 1}. ${name} failed, the rest were not run: ${e.message}`,
                ...(screen ? [header(screen)] : []),
              ].join('\n'),
              e.code,
              e.hint,
              e.dispatched,
            );
          }
        }
        const all = done.join('\n');
        return reply(all, { ...(ending?.data ?? summary('')), done: clean(all) }, images);
      },
    }),
    defineOp({
      name: 'assert',
      title: 'Assert',
      description:
        'Check an element without acting; refuses (CHECK_FAILED) saying what it found. check text: against equals; expect: false for the opposite; timeoutMs: to come true.',
      input: z.object({ ...AssertStep.omit({ action: true }).shape }).strict(),
      output: ActionOut,
      annotations: READ,
      run: async (a) => {
        const s = await ctx.session();
        const { screen, done } = await checkNow(s, a);
        return reply(clean(done), summary(clean(done), screen));
      },
    }),
    defineOp({
      name: 'alert',
      title: 'System alert',
      description:
        "The open system alert: with no answer its text and buttons; answer: a button's label, or allow or deny on a permission prompt in any language. Never touches the app's own dialogs.",
      input: z.object({ answer: z.string().min(1).max(200).optional(), read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ answer, read }) => {
        const s = await ctx.session();
        const screen = await s.read();
        const facts = s.device.platformScreen;
        const a = facts.systemAlert(screen.tree, screen.elements);
        if (!a) {
          const t = "no system alert is open (the app's own dialogs are not touched)";
          // an answer asked for and not given; a question has its answer here
          if (answer) throw new ToolError(t, 'NOT_FOUND', undefined, false);
          return reply(t, summary(t));
        }
        const buttons = a.buttons.map((b) => JSON.stringify(clean(b.label))).join(', ');
        if (!answer) {
          const t = `system alert: ${a.texts.map(clean).join(' / ')}\nbuttons: ${buttons}`;
          return reply(t, { ...summary(t), alert: { ...a, texts: a.texts.map(clean) } });
        }
        const { hit, many } = alertAnswer(a, (x) => facts.alertButton(screen.elements, x), answer);
        if (!hit)
          throw new ToolError(
            many
              ? `${JSON.stringify(answer)} matches several buttons: ${buttons}`
              : `no button ${JSON.stringify(answer)} on the alert: ${buttons}`,
            many ? 'AMBIGUOUS' : 'NOT_FOUND',
          );
        const label = clean(hit.label);
        const r = await act(
          s,
          read,
          (o) => s.device.tap(hit, o),
          `answered the system alert: ${JSON.stringify(label)}`,
        );
        return { ...r, data: { ...r.data, answered: label } };
      },
    }),
  ];
}
