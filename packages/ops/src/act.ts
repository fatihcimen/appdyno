import { alertAnswer } from '@appdyno/core';
import { z } from 'zod';
import type { Answers } from './answers.js';
import { stepsOp } from './batch.js';
import type { ServerContext } from './context.js';
import { ActionOut } from './schemas.js';
import { pinchPaths } from './gesture-paths.js';
import { hideKeyboard } from './keyboard.js';
import {
  AssertStep,
  Coord,
  KeyStep,
  MAX_TYPED,
  Read,
  ScrollStep,
  SwipeStep,
  Target,
  TypeStep,
} from './step-schemas.js';
import type { Steps } from './steps.js';
import { ACT, defineOp, READ, reply, ToolError, type Op } from './tool.js';

const PINCH_MS = 400;

function tapOp(ctx: ServerContext, { one }: Steps) {
  return defineOp({
    name: 'tap',
    title: 'Tap',
    description:
      'Tap a target: ref, x,y or selector; answers the settled screen (read). Several matches refuse, listing refs; no match waits briefly, then refuses with the nearest labels.',
    input: z.object({ ...Target, read: Read }).strict(),
    output: ActionOut,
    annotations: ACT,
    run: async ({ read, ...a }) => one(await ctx.session(), { action: 'tap', ...a }, read),
  });
}

function gestureOp(ctx: ServerContext, { act }: Answers, { one, onTheScreen, windowSize }: Steps) {
  return defineOp({
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
  });
}

function swipeOp(ctx: ServerContext, { one }: Steps) {
  return defineOp({
    name: 'swipe',
    title: 'Swipe',
    description:
      'Swipe, from a target if given; up: the content moves up, a list scrolls on. exact: the content moves distance and stops, by strokes; the answer says how far.',
    input: z.object({ ...SwipeStep.omit({ action: true }).shape, read: Read }).strict(),
    output: ActionOut,
    annotations: ACT,
    run: async ({ read, ...a }) => one(await ctx.session(), { action: 'swipe', ...a }, read),
  });
}

function scrollToOp(ctx: ServerContext, { one }: Steps) {
  return defineOp({
    name: 'scroll_to',
    title: 'Scroll to',
    description:
      "Scroll until the selector's element is on screen; direction as swipe's; x,y: a point in the list if several. Refuses at the list's end, with the nearest labels.",
    input: z.object({ ...ScrollStep.omit({ action: true }).shape, read: Read }).strict(),
    output: ActionOut,
    annotations: ACT,
    run: async ({ read, ...a }) => one(await ctx.session(), { action: 'scroll_to', ...a }, read),
  });
}

function typeTextOp(ctx: ServerContext, { one }: Steps) {
  return defineOp({
    name: 'type_text',
    title: 'Type text',
    description: `Type up to ${MAX_TYPED} characters of Unicode into the focused field, or a target, tapped and focused first. replace: the field's text; submit: then enter.`,
    input: z.object({ ...TypeStep.omit({ action: true }).shape, read: Read }).strict(),
    output: ActionOut,
    annotations: ACT,
    run: async ({ read, ...a }) => one(await ctx.session(), { action: 'type_text', ...a }, read),
  });
}

function pressKeyOp(ctx: ServerContext, { one }: Steps) {
  return defineOp({
    name: 'press_key',
    title: 'Press key',
    description:
      'Press a key or button: back, home, enter, delete, tab, escape, space, arrow_up/down/left/right, app_switch, volume_up/down, mute, siri, power, lock; or a letter or digit, held keys first: command+a (Android: Ctrl). control_center, notification_center, spotlight open those; home closes them.',
    input: z.object({ ...KeyStep.omit({ action: true }).shape, read: Read }).strict(),
    output: ActionOut,
    annotations: ACT,
    run: async ({ read, ...a }) => one(await ctx.session(), { action: 'press_key', ...a }, read),
  });
}

function keyboardOp(
  ctx: ServerContext,
  { summary, changing, afterChange }: Answers,
  { one }: Steps,
) {
  return defineOp({
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
      const { result: closed, was } = await changing(s, () => hideKeyboard(s));
      if (!closed)
        throw new ToolError(
          'the keyboard stayed open: the app keeps it there',
          'UNSUPPORTED',
          'keyboard enter closes it on a field whose return key does so, and may submit the form',
        );
      const r = await afterChange(s, was, 'closed the keyboard', read);
      return { ...r, data: { ...r.data, closed: true } };
    },
  });
}

function assertOp(ctx: ServerContext, { summary, clean }: Answers, { checkNow }: Steps) {
  return defineOp({
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
  });
}

function alertOp(ctx: ServerContext, { act, summary, clean }: Answers) {
  return defineOp({
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
  });
}

/** The tools that act on the screen, in the order the catalog lists them. */
export function actOps(
  ctx: ServerContext,
  answers: Answers,
  steps: Steps,
  tools: () => Record<string, Op>,
) {
  return [
    tapOp(ctx, steps),
    gestureOp(ctx, answers, steps),
    swipeOp(ctx, steps),
    scrollToOp(ctx, steps),
    typeTextOp(ctx, steps),
    pressKeyOp(ctx, steps),
    keyboardOp(ctx, answers, steps),
    stepsOp(ctx, answers, steps, tools),
    assertOp(ctx, answers, steps),
    alertOp(ctx, answers),
  ];
}
