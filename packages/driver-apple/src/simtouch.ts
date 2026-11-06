import { type ActParams, type Key, KEY_USAGES, type Modifier } from '@appdyno/protocol';

export type TouchEvent = {
  p: 0 | 1 | 2;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  at: number;
};

/** A finger's hold on a tap: as long as a person's, enough for UIKit to see a tap, not a press. */
const TAP_MS = 50;

const STEP_MS = 16;

const DOUBLE_TAP_GAP_MS = 80;

/** The digitizer's events for a touch action, in normalized coordinates; undefined when none applies. */
export function touchEvents(
  action: ActParams,
  screen: { w: number; h: number },
): TouchEvent[] | undefined {
  const X = (x: number) => x / screen.w;
  const Y = (y: number) => y / screen.h;
  type Path = { x: number; y: number; t: number }[];
  const along = (path: Path, t: number) => {
    const next = path.findIndex((q) => q.t >= t);
    if (next <= 0) return next === 0 ? path[0]! : path[path.length - 1]!;
    const a = path[next - 1]!;
    const b = path[next]!;
    const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, t };
  };
  const walk = (paths: Path[]) => {
    const t0 = Math.min(...paths.map((p) => p[0]!.t));
    const t1 = Math.max(...paths.map((p) => p[p.length - 1]!.t));
    const events: TouchEvent[] = [];
    for (let t = t0; ; t = Math.min(t + STEP_MS, t1)) {
      const a = along(paths[0]!, t);
      const b = paths[1] && along(paths[1], t);
      events.push({
        p: t === t0 ? 0 : t === t1 ? 2 : 1,
        x: X(a.x),
        y: Y(a.y),
        ...(b && { x2: X(b.x), y2: Y(b.y) }),
        at: t - t0,
      });
      if (t === t1) return events;
    }
  };
  switch (action.kind) {
    case 'tap':
      return walk([
        [
          { x: action.x, y: action.y, t: 0 },
          { x: action.x, y: action.y, t: TAP_MS },
        ],
      ]).filter((e) => e.p !== 1);
    case 'doubleTap': {
      const press = walk([
        [
          { x: action.x, y: action.y, t: 0 },
          { x: action.x, y: action.y, t: TAP_MS },
        ],
      ]).filter((e) => e.p !== 1);
      return [...press, ...press.map((e) => ({ ...e, at: e.at + TAP_MS + DOUBLE_TAP_GAP_MS }))];
    }
    case 'longPress':
      return walk([
        [
          { x: action.x, y: action.y, t: 0 },
          { x: action.x, y: action.y, t: action.durationMs },
        ],
      ]).filter((e) => e.p !== 1);
    case 'swipe':
      return walk([
        [
          { ...action.from, t: 0 },
          { ...action.to, t: action.durationMs },
        ],
      ]);
    case 'gesture':
      return action.pointers.length <= 2
        ? walk(action.pointers.map((p) => p.map((q) => ({ x: q.x, y: q.y, t: q.t }))))
        : undefined;
    default:
      return undefined;
  }
}

/** The keyboard's usages of what is held during a key. */
export const HID_MODIFIERS: Record<Modifier, number> = {
  control: 0xe0,
  shift: 0xe1,
  option: 0xe2,
  command: 0xe3,
};

const UNSHIFTED = "-=[]\\;'`,./";
const SHIFTED = '_+{}|:"~<>?';
const UNSHIFTED_USAGES = [0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38];
const SHIFTED_DIGITS = '!@#$%^&*()';

/** The usage and shift of a character a US keyboard types; undefined for any other. */
export function usageOf(c: string): { usage: number; shift: boolean } | undefined {
  const code = c.charCodeAt(0);
  if (c >= 'a' && c <= 'z') return { usage: 0x04 + code - 97, shift: false };
  if (c >= 'A' && c <= 'Z') return { usage: 0x04 + code - 65, shift: true };
  if (c >= '1' && c <= '9') return { usage: 0x1e + code - 49, shift: false };
  if (c === '0') return { usage: 0x27, shift: false };
  if (c === ' ') return { usage: 0x2c, shift: false };
  if (c === '\n') return { usage: 0x28, shift: false };
  const digit = SHIFTED_DIGITS.indexOf(c);
  if (digit >= 0) return { usage: 0x1e + digit, shift: true };
  const plain = UNSHIFTED.indexOf(c);
  if (plain >= 0) return { usage: UNSHIFTED_USAGES[plain]!, shift: false };
  const shifted = SHIFTED.indexOf(c);
  if (shifted >= 0) return { usage: UNSHIFTED_USAGES[shifted]!, shift: true };
  return undefined;
}

/** A key by its name, or the letter or digit a keyboard has it under. */
export function hidKey(key: string) {
  const typed = key.length === 1 ? usageOf(key) : undefined;
  return typed ? { page: 7, usage: typed.usage } : KEY_USAGES[key as Key];
}
