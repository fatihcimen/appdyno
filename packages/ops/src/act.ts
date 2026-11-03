import { alertAnswer, reportProgress, throwIfCancelled } from '@appdyno/core';
import { z } from 'zod';
import { SETTLE, type Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { ActionOut } from './schemas.js';
import { refused } from './session.js';
import { pinchPaths } from './gesture-paths.js';
import {
  AssertStep,
  Coord,
  Keys,
  Read,
  ScrollStep,
  Step,
  SwipeStep,
  Target,
  TypeStep,
} from './step-schemas.js';
import type { Steps } from './steps.js';
import { ACT, defineOp, READ, reply, ToolError, type Op } from './tool.js';

// measured on a loaded Mac: 20 took 10 s on an emulator, 19 s on a simulator; 30 took up to 56 s, near a client's usual 60 s
const MAX_STEPS = 20;
const PINCH_MS = 400;
const KEYBOARD_GONE_MS = 1_500;

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
  { one, step, windowSize, checkNow }: Steps,
): Op[] {
  return [
    defineOp({
      name: 'tap',
      title: 'Tap',
      description:
        'Tap; answers the settled screen (read). A target, here and in gesture, type_text and steps: ref, x,y or selector. Several matches refuse, listing refs; no match waits briefly, then refuses with the nearest labels.',
      input: z.object({ ...Target, read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ read, ...a }) => one(await ctx.session(), { action: 'tap', ...a }, read),
    }),
    defineOp({
      name: 'gesture',
      title: 'Gesture',
      description:
        'double_tap, long_press: at the target. drag: from the target to `to` over durationMs, no flick. pinch: scale > 1 zooms in, < 1 out, at x,y or the middle. plan: free paths in `pointers`, one per finger, t in ms.',
      input: z
        .object({
          kind: z.enum(['double_tap', 'long_press', 'drag', 'pinch', 'plan']),
          ...Target,
          to: z.object(Target).strict().optional(),
          scale: z.number().min(0.2).max(5).optional(),
          durationMs: z.number().int().min(50).max(10_000).optional(),
          pointers: z
            .array(z.array(z.object({ x: Coord, y: Coord, t: z.number().min(0) })))
            .optional(),
          read: Read,
        })
        .strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ kind, to, pointers, scale, durationMs, read, ...a }) => {
        const s = await ctx.session();
        const during = durationMs !== undefined && { durationMs };
        switch (kind) {
          case 'double_tap':
            return one(s, { action: 'double_tap', ...a }, read);
          case 'long_press':
            return one(s, { action: 'long_press', ...a, ...during }, read);
          case 'drag':
            if (!to) throw new ToolError('drag needs to');
            return one(s, { action: 'drag', ...a, to, ...during }, read);
          case 'pinch': {
            if (scale === undefined) throw new ToolError('pinch needs scale');
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
              throw new ToolError('plan needs pointers: 1 to 5 fingers, each with its points');
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
        'direction up: content moves up, a list scrolls on; optional start (a target) and distance.',
      input: z.object({ ...SwipeStep.omit({ action: true }).shape, read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ read, ...a }) => one(await ctx.session(), { action: 'swipe', ...a }, read),
    }),
    defineOp({
      name: 'scroll_to',
      title: 'Scroll to',
      description:
        "Scroll until the selector's element is on the screen. direction: as swipe; x,y: a point in the list if several. Refuses at the list's end (nothing moved), with the nearest labels.",
      input: z.object({ ...ScrollStep.omit({ action: true }).shape, read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ read, ...a }) => one(await ctx.session(), { action: 'scroll_to', ...a }, read),
    }),
    defineOp({
      name: 'type_text',
      title: 'Type text',
      description:
        "Type any Unicode text into the focused field. A target is tapped first and its focus waited for; replace: replaces the field's text; submit: enter afterwards.",
      input: z.object({ ...TypeStep.omit({ action: true }).shape, read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ read, ...a }) => one(await ctx.session(), { action: 'type_text', ...a }, read),
    }),
    defineOp({
      name: 'press_key',
      title: 'Press key',
      description:
        'A key or hardware button. home, app_switch, power and lock leave the app (off when the server turned home off). A platform without it refuses and says why.',
      input: z.object({ key: Keys, read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ key, read }) => one(await ctx.session(), { action: 'press_key', key }, read),
    }),
    defineOp({
      name: 'keyboard',
      title: 'Keyboard',
      description:
        'The on-screen keyboard. status: is it open; dismiss: closes it (refuses if the app keeps it open); enter: its enter key.',
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
        if (!s.device.dismissKeyboard)
          throw new ToolError('this device cannot close its keyboard', 'UNSUPPORTED');
        await s.device.dismissKeyboard().catch(refused);
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
        return afterChange(s, 'closed the keyboard', read);
      },
    }),
    defineOp({
      name: 'steps',
      title: 'Steps',
      description: `A sequence in one call, also across screens: at most ${MAX_STEPS}, each { action, ...the arguments of the tool of that name }: tap, swipe, type_text, press_key, wait_for, assert, scroll_to; double_tap, long_press, drag as gesture's. A selector or ref is looked for at its step. Stops at the first failure, saying which and why. One read at the end.`,
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
        const steps = raw.map((x, i) => {
          const p = Step.safeParse(x);
          if (!p.success) throw new ToolError(`step ${i + 1}: ${z.prettifyError(p.error)}`);
          return p.data;
        });
        const s = await ctx.session();
        const done: string[] = [];
        for (const [i, st] of steps.entries()) {
          const last = i === steps.length - 1;
          try {
            throwIfCancelled('steps');
            reportProgress(`step ${i + 1} of ${steps.length}: ${st.action}`);
            if (!last) {
              // only typing into a field stays on its screen: a key after a tap that opened a
              // screen must reach that screen, not the transition
              const stays = st.action === 'type_text' && !st.submit && !readsScreen(steps[i + 1]);
              const opts = !stays
                ? ({
                    settle: SETTLE,
                    read: 'none',
                    ...(s.fresh && { before: s.fresh.hash }),
                  } as const)
                : ({ settle: false, read: 'none' } as const);
              const x = await step(s, st, opts, true).catch(refused);
              s.acted();
              done.push(`${i + 1}. ${x.done}`);
              continue;
            }
            let lastDone = '';
            return await act(
              s,
              read,
              async (o) => {
                const x = await step(s, st, o, true);
                lastDone = x.done;
                return x.r;
              },
              () => [...done, `${i + 1}. ${lastDone}`].join('\n'),
            );
          } catch (e) {
            if (!(e instanceof ToolError)) throw e;
            const screen = await s.read().catch(() => undefined);
            if (screen) show(s, screen);
            throw new ToolError(
              [
                ...done,
                `${i + 1}. ${st.action} failed, the rest were not run: ${e.message}`,
                ...(screen ? [header(s, screen)] : []),
              ].join('\n'),
              e.code,
              e.hint,
            );
          }
        }
        return reply(done.join('\n'), summary(done.join('\n')));
      },
    }),
    defineOp({
      name: 'assert',
      title: 'Assert',
      description:
        'Check an element (ref, text, id or role) without acting; refuses (CHECK_FAILED) saying what it found. check text: against equals; expect: false for the opposite; timeoutMs: time to come true.',
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
        "The open system alert, of any kind: with no answer its text and buttons; answer: a button's label, or allow or deny on a permission prompt in any language. Never touches the app's own dialogs.",
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
        return act(
          s,
          read,
          (o) => s.device.tap(hit, o),
          `answered the system alert: ${JSON.stringify(clean(hit.label))}`,
        );
      },
    }),
  ];
}
