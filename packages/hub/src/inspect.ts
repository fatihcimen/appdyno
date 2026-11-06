import {
  attributesOf,
  type Device,
  type Screen,
  type ScreenElement,
  type ViewerMessage,
  type ViewerOrder,
} from '@appdyno/core';
import { elementUnder, type FlowStep, selectorLine, stepLine } from '@appdyno/flows';
import type { AuditIssue } from '@appdyno/protocol';
import { type Aim, aimAt, named, type Size, stepOf } from '@appdyno/ops';

/** What the inspector needs of its window. */
export type InspectPort = {
  device: Pick<Device, 'audit' | 'platformScreen'>;
  latest(): Screen | undefined;
  sizeOf(screen: Screen): Size | undefined;
  tell(message: ViewerOrder): void;
  say(note: string): void;
  /** Takes an assertion into the running recording; false: none runs. */
  assert(step: FlowStep, aim: Aim): boolean;
  /**
   * A recording runs. An audit holds the device's queue for seconds, and a read behind it comes after the click that
   * was to be named by it: the click would be named on the screen it made.
   */
  recording(): boolean;
};

const MOST_ISSUES = 50;
/** An audit waits for the pointer to rest: one for each screen passed over would be seconds of nothing. */
const REST_MS = 300;
const NOT_WHILE_RECORDING = 'Not read while recording';

/** An issue is of the element that holds its middle: an audit names a label inside a button. */
const isOf = (issue: AuditIssue, e: ScreenElement) => {
  if (!issue.b) return false;
  const [l, t, r, b] = issue.b;
  const [x, y] = [(l + r) / 2, (t + b) / 2];
  const { rect } = e;
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
};

/** The element under a person's pointer, by what a tool reads and what a tap there would write. No read of its own. */
export function windowInspector(o: InspectPort) {
  let audit: { hash: string; issues?: AuditIssue[]; why?: string } | undefined;
  let last: { x: number; y: number } | undefined;
  let resting: NodeJS.Timeout | undefined;

  const contrast = async (hash: string) => {
    const read = { hash } as NonNullable<typeof audit>;
    audit = read;
    try {
      const types = [...o.device.platformScreen.contrastAudits];
      read.issues = (await o.device.audit({ types, maxIssues: MOST_ISSUES })).issues;
    } catch (e) {
      read.why = (e as Error).message;
    }
    if (audit === read && last) hover(last);
  };

  const rested = () => {
    const hash = o.latest()?.hash;
    if (hash && hash !== audit?.hash && !o.recording()) void contrast(hash);
  };

  const words = (screen: Screen, e: ScreenElement) => {
    if (o.recording()) return { contrast: [], contrastNote: NOT_WHILE_RECORDING };
    const read = audit?.hash === screen.hash ? audit : undefined;
    return {
      contrast: read?.issues?.filter((i) => isOf(i, e)).map((i) => i.message) ?? [],
      ...(!read?.issues && { contrastNote: read?.why ?? 'Reading contrast' }),
    };
  };

  const under = (at: { x: number; y: number }) => {
    const screen = o.latest();
    const size = screen && o.sizeOf(screen);
    if (!screen || !size) return undefined;
    const p = { x: Math.round(at.x * size.w), y: Math.round(at.y * size.h) };
    return { screen, size, p, e: elementUnder(screen.list, p) };
  };

  function hover(at: { x: number; y: number }) {
    last = at;
    clearTimeout(resting);
    resting = setTimeout(rested, REST_MS);
    resting.unref();
    const u = under(at);
    if (!u) return;
    const { screen, size, p, e } = u;
    const tap = stepLine(stepOf('tap', aimAt(screen, p, size)));
    if (!e) return o.tell({ op: 'element', tap });
    const { selector } = named(screen, e);
    o.tell({
      op: 'element',
      role: e.role,
      label: e.label,
      ref: e.ref,
      ...(e.id && { id: e.id }),
      selector: selectorLine(selector),
      tap,
      rect: {
        x: e.rect.x / size.w,
        y: e.rect.y / size.h,
        w: e.rect.width / size.w,
        h: e.rect.height / size.h,
      },
      ...words(screen, e),
    });
  }

  const assertion = (screen: Screen, e: ScreenElement): { step: FlowStep; aim: Aim } => {
    const aim: Aim = { element: e, ...named(screen, e) };
    const at = attributesOf(screen.elements, e);
    // what it says is the check, unless its words are already what names it
    const says = e.role === 'textField' ? at.value : at.text;
    const check = aim.selector?.text === undefined && says ? { check: 'text', equals: says } : {};
    return { step: stepOf('assert', aim, check), aim };
  };

  return {
    /** The pointer moved over the picture. */
    hover,

    /** The window closed. */
    end: () => clearTimeout(resting),

    /** A click that is no touch: it copies what names an element, or checks it. */
    pick(m: ViewerMessage) {
      const u = under({ x: Number(m.x), y: Number(m.y) });
      if (!u?.e) return o.say('Nothing is named there');
      if (m.as === 'copy') {
        const text = selectorLine(named(u.screen, u.e).selector);
        o.tell({ op: 'copyText', text });
        return o.say(`Copied ${text}`);
      }
      const { step, aim } = assertion(u.screen, u.e);
      o.say(o.assert(step, aim) ? `Added ${stepLine(step)}` : 'Start a recording first');
    },
  };
}
