import { alertAnswer, onLine } from '@appdyno/core';
import { z } from 'zod';
import type { Answers, ReadMode } from './answers.js';
import { stepsOp } from './batch.js';
import type { ServerContext } from './context.js';
import { ActionOut } from './schemas.js';
import { pinchPaths } from './gesture-paths.js';
import { keyboardGone } from './keyboard.js';
import { backFromAlert } from './noticed.js';
import type { Session } from './session.js';
import {
  A_KEY,
  AssertStep,
  Coord,
  Direction,
  isKey,
  KeyStep,
  MAX_TYPED,
  Read,
  ScrollStep,
  Selector,
  Target,
  TypeStep,
} from './step-schemas.js';
import type { Steps } from './steps.js';
import { ACT, defineOp, definePart, READ, reply, ToolError, type Op } from './tool.js';
import { HIDE_KEYBOARD, keyStep, swipeStep, tapStep, typeStep } from './touch.js';

const PINCH_MS = 400;

function tapScreenOp(ctx: ServerContext, { one }: Steps) {
  return defineOp({
    name: 'tap_screen',
    title: 'Tap',
    description:
      'Tap a target in place: ref, selector or x,y. count: 2 is a double tap; holdMs: a long press. A moving finger: swipe_screen; a system alert: answer_alert. Returns the screen after. Several matches refuse, listing refs; no match waits briefly, then refuses with the nearest labels.',
    input: z
      .object({
        ...Target,
        count: z
          .number()
          .refine((c) => c === 1 || c === 2, '1, or 2 for a double tap')
          .optional(),
        holdMs: z.number().int().optional(),
        read: Read,
      })
      .strict(),
    output: ActionOut,
    annotations: ACT,
    step: tapStep,
    run: async ({ read, ...a }) => one(await ctx.session(), tapStep(a), read),
  });
}

type Point = { x?: number | undefined; y?: number | undefined };

function swipeScreenOp(
  ctx: ServerContext,
  { act }: Answers,
  { one, onTheScreen, windowSize }: Steps,
) {
  /** A pinch about a point, or the middle of the screen. */
  const pinch = async (s: Session, a: Point, scale: number, ms: number, read: ReadMode) => {
    await s.beforeTouch();
    await onTheScreen(s, [a]);
    const size = await windowSize(s);
    const c = { x: a.x ?? size.w / 2, y: a.y ?? size.h / 2 };
    const paths = pinchPaths(c, scale, ms, size);
    const r = await act(
      s,
      read,
      (o) => s.device.act({ kind: 'gesture', pointers: paths }, o),
      `pinched (×${scale})`,
    );
    // a photo or a map zooms its picture and keeps its elements: "no change" would read as nothing done
    if (r.data.changed !== false) return r;
    const note = 'a zoom may change only the picture: take_screenshot shows it';
    return {
      ...r,
      blocks: r.blocks.map((b, i) =>
        i === 0 && b.type === 'text' ? { ...b, text: `${b.text}\n${note}` } : b,
      ),
    };
  };
  /** Free paths, one per finger. */
  const paths = async (
    s: Session,
    fingers: { x: number; y: number; t: number }[][],
    read: ReadMode,
  ) => {
    if (fingers.length < 1 || fingers.length > 5 || fingers.some((p) => p.length < 1))
      throw new ToolError('pointers: 1 to 5 fingers, each with its points', 'INVALID_ARGUMENT');
    await s.beforeTouch();
    await onTheScreen(s, fingers.flat());
    return act(
      s,
      read,
      (o) => s.device.act({ kind: 'gesture', pointers: fingers }, o),
      `gesture (${fingers.length} finger${fingers.length > 1 ? 's' : ''})`,
    );
  };
  return defineOp({
    name: 'swipe_screen',
    title: 'Swipe, scroll, drag, pinch',
    description:
      'Move a finger: swipe, scroll to an element, drag or pinch. direction: a swipe, from a target if given; up moves content up. until: swipes until that selector is on screen (maxSwipes, 10); x,y: which list. to: drags the target there, no flick; holdMs first lifts a row. scale: pinch, > 1 zooms in. pointers: free paths, one per finger, t in ms. exact: content moves distance and stops. In place: tap_screen. Returns the screen after.',
    input: z
      .object({
        direction: Direction.optional(),
        ...Target,
        until: Selector.optional(),
        maxSwipes: ScrollStep.shape.maxSwipes.unwrap().optional(),
        distance: z.number().optional(),
        exact: z.boolean().optional(),
        to: z.object(Target).strict().optional(),
        // the longest of the ways that take one: a swipe and a drag hold theirs to their own
        durationMs: z.number().int().min(50).max(10_000).optional(),
        holdMs: z.number().int().optional(),
        scale: z.number().min(0.2).max(5).optional(),
        pointers: z
          .array(z.array(z.object({ x: Coord, y: Coord, t: z.number().min(0) })))
          .optional(),
        read: Read,
      })
      .strict(),
    output: ActionOut,
    annotations: ACT,
    step: (a) => {
      const st = swipeStep(a);
      return typeof st === 'string' ? undefined : st;
    },
    run: async ({ read, ...a }) => {
      const st = swipeStep(a);
      const s = await ctx.session();
      if (st === 'scale') return pinch(s, a, a.scale ?? 1, a.durationMs ?? PINCH_MS, read);
      return st === 'pointers' ? paths(s, a.pointers ?? [], read) : one(s, st, read);
    },
  });
}

function typeTextOp(ctx: ServerContext, { one }: Steps) {
  return defineOp({
    name: 'type_text',
    title: 'Type text',
    description: `Type up to ${MAX_TYPED} characters of Unicode into the focused field, or a target, tapped and focused first. replace: the field's text; submit: then enter. One key or button: press_key. Returns the screen after.`,
    input: z.object({ ...TypeStep.omit({ action: true }).shape, read: Read }).strict(),
    output: ActionOut,
    annotations: ACT,
    step: typeStep,
    run: async ({ read, ...a }) => one(await ctx.session(), typeStep(a), read),
  });
}

function pressKeyOp(
  ctx: ServerContext,
  { summary, changing, afterChange }: Answers,
  { one }: Steps,
) {
  /** Closes the on-screen keyboard, or says the app keeps it. */
  const hideKeyboard = async (s: Session, read: ReadMode) => {
    const screen = await s.read();
    if (!s.device.platformScreen.keyboardOpen(screen.tree))
      return reply('no keyboard is open', summary('no keyboard is open'));
    const { was } = await changing(s, () => s.device.dismissKeyboard());
    if (!(await keyboardGone(s)))
      throw new ToolError(
        'the keyboard stayed open: the app keeps it there',
        'UNSUPPORTED',
        'press_key enter closes it where its return key does, and may submit the form; a number pad has none: tap what the app closes it with',
      );
    // the keyboard's going is the change, whether or not the app beneath it moved
    const r = await afterChange(s, { ...was, seen: true }, 'closed the keyboard', read);
    return { ...r, data: { ...r.data, closed: true } };
  };
  return defineOp({
    name: 'press_key',
    title: 'Press key',
    description: `Press a key or button: back, home, enter, delete, tab, escape, space, arrow_up/down/left/right, app_switch, volume_up/down, mute, siri, power, lock; a letter or digit, held keys first: command+a (Android: Ctrl). ${HIDE_KEYBOARD} closes the on-screen keyboard. control_center, notification_center, spotlight open those; home closes them. Words: type_text. Returns the screen after.`,
    input: z
      .object({
        ...KeyStep.omit({ action: true }).shape,
        key: z
          .string()
          .refine(
            (k) => k.toLowerCase() === HIDE_KEYBOARD || isKey(k),
            `${A_KEY}; or ${HIDE_KEYBOARD}`,
          ),
        read: Read,
      })
      .strict(),
    output: ActionOut,
    annotations: ACT,
    step: keyStep,
    run: async ({ read, ...a }) => {
      const st = keyStep(a);
      const s = await ctx.session();
      return st ? one(s, st, read) : hideKeyboard(s, read);
    },
  });
}

function assertOp(ctx: ServerContext, { summary, clean }: Answers, { checkNow }: Steps) {
  return definePart({
    name: 'assert',
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
    name: 'answer_alert',
    title: 'System alert',
    description:
      "Read or answer the open system alert, as a permission prompt. No answer: its text and buttons. answer: a button's label, or in any language allow (the least it offers: once, else while using) or deny. The app's own dialogs: tap_screen. Returns the screen after.",
    input: z.object({ answer: z.string().min(1).max(200).optional(), read: Read }).strict(),
    output: ActionOut,
    annotations: ACT,
    run: async ({ answer, read }) => {
      const s = await ctx.session();
      const screen = await s.read();
      const facts = s.device.platformScreen;
      const a = facts.systemAlert(screen.tree, screen.elements);
      if (!a) {
        const t = answer
          ? "no system alert is open, so no button was touched (the app's own dialogs are not touched)"
          : "no system alert is open (the app's own dialogs are not touched)";
        // an answer asked for and not given; a question has its answer here
        if (answer) throw new ToolError(t, 'NOT_FOUND', undefined, false);
        return reply(t, summary(t));
      }
      const buttons = a.buttons.map((b) => JSON.stringify(clean(b.label))).join(', ');
      if (!answer) {
        const t = `system alert: ${a.texts.map((x) => onLine(clean(x))).join(' / ')}\nbuttons: ${buttons}`;
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
        undefined,
        await backFromAlert(s, screen, hit),
      );
      return { ...r, data: { ...r.data, answered: label } };
    },
  });
}

/** The tools that act on the screen, and the check that is a part of check_element. */
export function actOps(
  ctx: ServerContext,
  answers: Answers,
  steps: Steps,
  tools: () => Record<string, Op>,
) {
  return [
    tapScreenOp(ctx, steps),
    swipeScreenOp(ctx, answers, steps),
    typeTextOp(ctx, steps),
    pressKeyOp(ctx, answers, steps),
    stepsOp(ctx, answers, steps, tools),
    assertOp(ctx, answers, steps),
    alertOp(ctx, answers),
  ];
}
