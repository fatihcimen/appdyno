import type { ActOptions } from '@appdyno/core';
import type { ActResult, Point, TextResult } from '@appdyno/protocol';
import { z } from 'zod';
import type { Answers, ReadMode } from './answers.js';
import type { ServerContext } from './context.js';
import type { Session } from './session.js';
import { ToolError } from './tool.js';

export const STALE = 'stale ref, read the screen again';

export const Device = z
  .string()
  .max(64)
  .optional()
  .describe('device (list_devices); default: the selected device');
export const Read = z
  .enum(['diff', 'full', 'none'])
  .default('diff')
  .describe('the screen after the action: diff (what changed, default), full (whole screen), none');
export const Ref = z
  .string()
  .regex(/^@[a-z0-9]{1,10}(-\d{1,3})?$/, 'a ref as the screen shows it (@k3f9)');
export const Coord = z.number().min(0).max(10_000);
export const Target = { ref: Ref.optional(), x: Coord.optional(), y: Coord.optional() };
export const Direction = z.enum(['up', 'down', 'left', 'right']);
export const Keys = z.enum(['back', 'enter', 'home', 'delete', 'tab']);

const TapStep = z.object({ action: z.literal('tap'), ...Target }).strict();
export const LongPressStep = z
  .object({
    action: z.literal('long_press'),
    ...Target,
    durationMs: z.number().int().min(100).max(5_000).optional(),
  })
  .strict();
export const SwipeStep = z
  .object({
    action: z.literal('swipe'),
    direction: Direction,
    x: Coord.optional(),
    y: Coord.optional(),
    distance: z.number().min(10).max(5_000).optional(),
    durationMs: z.number().int().min(50).max(5_000).optional(),
  })
  .strict();
export const TypeStep = z
  .object({
    action: z.literal('type_text'),
    text: z.string().max(500),
    ref: Ref.optional(),
    replace: z.boolean().optional(),
    submit: z.boolean().optional(),
  })
  .strict();
const KeyStep = z.object({ action: z.literal('press_key'), key: Keys }).strict();
export const Step = z.discriminatedUnion('action', [
  TapStep,
  LongPressStep,
  SwipeStep,
  TypeStep,
  KeyStep,
]);
export type Step = z.infer<typeof Step>;

/**
 * A swipe's start and end on a screen of `size`: from x,y (the centre) by `distance` (40 % of the
 * screen), both points inside the screen (an edge point would start a system gesture).
 */
export function swipeLine(
  size: { w: number; h: number },
  s: { direction: z.infer<typeof Direction>; x?: number; y?: number; distance?: number },
): { from: Point; to: Point } {
  const horizontal = s.direction === 'left' || s.direction === 'right';
  const from = { x: s.x ?? size.w / 2, y: s.y ?? size.h / 2 };
  const dist = s.distance ?? (horizontal ? size.w : size.h) * 0.4;
  // the finger's way: `up` moves the content up (the list scrolls on)
  const sign = s.direction === 'up' || s.direction === 'left' ? -1 : 1;
  const to = horizontal
    ? { x: from.x + sign * dist, y: from.y }
    : { x: from.x, y: from.y + sign * dist };
  const clamp = (p: Point) => ({
    x: Math.round(Math.min(Math.max(p.x, 1), size.w - 1)),
    y: Math.round(Math.min(Math.max(p.y, 1), size.h - 1)),
  });
  return { from: clamp(from), to: clamp(to) };
}

/** Two fingers from the point outwards (scale > 1, zoom in) or inwards (scale < 1). */
export function pinchPaths(
  c: Point,
  scale: number,
  durationMs: number,
  size: { w: number; h: number },
) {
  const r0 = Math.min(size.w, size.h) * (scale >= 1 ? 0.1 : 0.3);
  const r1 = Math.min(Math.max(r0 * scale, 10), Math.min(size.w, size.h) * 0.45);
  const finger = (sign: number) => [
    { x: c.x + sign * r0, y: c.y, t: 0 },
    { x: c.x + sign * r1, y: c.y, t: durationMs },
  ];
  return [finger(-1), finger(1)];
}

/** One step's device call and the action around it, shared by the tools that act on a target. */
export function stepsFor(ctx: ServerContext, { act, clean }: Answers) {
  const policy = ctx.policy;

  /** The point of a ref (on the device's current screen) or of x,y. */
  const target = async (s: Session, a: { ref?: string; x?: number; y?: number }) => {
    if (a.ref) {
      const e = (await s.current()).list.find((x) => x.ref === a.ref);
      if (!e) throw new ToolError(`${STALE}: ${a.ref} is not on this screen`);
      return { point: { x: e.x, y: e.y }, name: `${a.ref} ${JSON.stringify(clean(e.label))}` };
    }
    if (a.x === undefined || a.y === undefined) throw new ToolError('give a ref, or x and y');
    return { point: { x: a.x, y: a.y }, name: `${a.x},${a.y}` };
  };

  const windowSize = async (s: Session) => {
    const w =
      (await s.current()).window ??
      (s.device.hello && { w: s.device.hello.screen.w, h: s.device.hello.screen.h });
    if (!w) throw new ToolError('the screen size is unknown: give x, y and distance');
    return w;
  };

  /** One step's device call (a ref resolved on the current screen right before it). */
  const step = async (
    s: Session,
    st: Step,
    opts: ActOptions,
  ): Promise<{ r: ActResult | TextResult; done: string }> => {
    switch (st.action) {
      case 'tap': {
        const t = await target(s, st);
        return { r: await s.device.tap(t.point, opts), done: `tapped ${t.name}` };
      }
      case 'long_press': {
        const t = await target(s, st);
        return {
          r: await s.device.longPress(t.point, st.durationMs ?? 800, opts),
          done: `long-pressed ${t.name}`,
        };
      }
      case 'swipe': {
        const { from, to } = swipeLine(await windowSize(s), st);
        return {
          r: await s.device.swipe(from, to, st.durationMs ?? 300, opts),
          done: `swiped (${st.direction})`,
        };
      }
      case 'type_text': {
        const at = st.ref ? (await target(s, { ref: st.ref })).point : undefined;
        const r = await s.device.typeText(st.text, {
          ...(at && { at }),
          replace: st.replace ?? false,
          submit: st.submit ?? false,
          ...opts,
        });
        // never the text itself (it may be a phone number or a code)
        return {
          r,
          done: `typed (${Array.from(st.text).length} characters${st.submit ? ', submitted' : ''}${r.verified === false ? ', the field read back holds other text' : r.verified === undefined ? ', not read back' : ''})`,
        };
      }
      case 'press_key': {
        if (st.key === 'home' && !policy.allowHome)
          throw new ToolError('home is off on this server: the app may not be left');
        return { r: await s.device.key(st.key, opts), done: `pressed ${st.key}` };
      }
    }
  };

  const one = async (s: Session, st: Step, read: ReadMode) => {
    let done = '';
    return act(
      s,
      read,
      async (o) => {
        const x = await step(s, st, o);
        done = x.done;
        return x.r;
      },
      () => done,
    );
  };

  return { target, windowSize, step, one };
}

export type Steps = ReturnType<typeof stepsFor>;
