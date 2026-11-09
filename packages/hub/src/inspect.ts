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
  /** Whether an audit may start now: not with the stream down, nor over a measure's numbers. */
  may(): boolean;
  /** What may show of a message: a test account's secret is not. */
  clean(text: string): string;
};

const MOST_ISSUES = 50;
/** An audit waits for the pointer to rest: one for each screen passed over would be seconds of nothing. */
const REST_MS = 300;
/** How long a screen stays the same before the Accessibility pane audits it: one still moving is audited for nothing. */
const SETTLED_MS = 1_000;
const NOT_WHILE_RECORDING = 'Not read while recording';

/** One audit of one screen: of all kinds for the Accessibility pane, else of contrast alone, for the pointer. */
type Audit = {
  screen: Screen;
  all: boolean;
  issues?: AuditIssue[];
  truncated?: boolean;
  why?: string;
};

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
  let audit: Audit | undefined;
  let last: { x: number; y: number } | undefined;
  let resting: NodeJS.Timeout | undefined;
  let auditing = false;
  let watching: NodeJS.Timeout | undefined;
  let settled: { hash: string; at: number } | undefined;
  let stated: string | undefined;

  const contrastTypes = (): readonly string[] => o.device.platformScreen.contrastAudits;
  const reading = () => !!audit && !audit.issues && !audit.why;

  /** What the Accessibility pane lists, each issue with where it stands on the picture; a state said once. */
  const tellAudit = (state: string, a?: Audit) => {
    if (!a && state === stated) return;
    stated = state;
    const size = a && o.sizeOf(a.screen);
    o.tell({
      op: 'audit',
      state,
      issues: (a?.issues ?? []).map((i) => {
        const named = i.element?.t ?? i.element?.d;
        return {
          type: i.type,
          rule: i.rule,
          message: o.clean(i.message),
          ...(named && { label: o.clean(named) }),
          ...(i.b &&
            size && {
              rect: {
                x: i.b[0] / size.w,
                y: i.b[1] / size.h,
                w: (i.b[2] - i.b[0]) / size.w,
                h: (i.b[3] - i.b[1]) / size.h,
              },
            }),
        };
      }),
      ...(a?.truncated && { truncated: true }),
      ...(a?.why && { why: a.why }),
    });
  };

  /** One audit at a time, as it holds the device's queue: the pane's of every kind serves the pointer too. */
  const read = async (screen: Screen, all: boolean) => {
    const run: Audit = { screen, all };
    audit = run;
    if (all) tellAudit('reading');
    try {
      const types = all ? undefined : o.device.platformScreen.contrastAudits;
      const r = await o.device.audit({
        ...(types && { types: [...types] }),
        maxIssues: MOST_ISSUES,
      });
      run.issues = r.issues;
      run.truncated = r.truncated;
    } catch (e) {
      run.why = (e as Error).message;
    }
    if (audit !== run) return;
    if (last) hover(last);
    if (auditing && all) tellAudit(run.why ? 'failed' : 'done', run);
  };

  const rested = () => {
    const screen = o.latest();
    if (screen && screen.hash !== audit?.screen.hash && !reading() && !o.recording())
      void read(screen, auditing);
  };

  /** An audit of the screen shown, where one may run: never during a recording, whose clicks a read would come after. */
  const check = (screen: Screen) => {
    if (o.recording()) tellAudit('recording');
    else if (!o.may()) tellAudit('held');
    else void read(screen, true);
  };

  /** A new screen is audited once it has stayed the same a while. */
  const look = () => {
    const screen = o.latest();
    if (!screen) return;
    if (screen.hash !== settled?.hash) {
      settled = { hash: screen.hash, at: Date.now() };
      return;
    }
    if (Date.now() - settled.at < SETTLED_MS || reading()) return;
    if (audit?.all && audit.screen.hash === screen.hash) return;
    check(screen);
  };

  const words = (screen: Screen, e: ScreenElement) => {
    if (o.recording()) return { contrast: [], contrastNote: NOT_WHILE_RECORDING };
    const read = audit?.screen.hash === screen.hash ? audit : undefined;
    return {
      contrast:
        read?.issues
          ?.filter((i) => contrastTypes().includes(i.type) && isOf(i, e))
          .map((i) => i.message) ?? [],
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
    if (!e) {
      o.tell({ op: 'element', tap });
      return;
    }
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

    /** The Accessibility pane shows, or not: while it does, each screen that settles is audited. */
    audits(on: boolean) {
      auditing = on;
      clearInterval(watching);
      watching = undefined;
      stated = undefined;
      if (!on) return;
      watching = setInterval(look, REST_MS);
      watching.unref();
      const shown = audit?.all && !reading() && audit.screen.hash === o.latest()?.hash;
      if (shown) tellAudit(audit?.why ? 'failed' : 'done', audit);
      else tellAudit(reading() && audit?.all ? 'reading' : 'waiting');
    },

    /** A person asked for the screen shown to be audited again. */
    again() {
      const screen = o.latest();
      if (screen && !reading()) check(screen);
    },

    /** The window closed. */
    end: () => {
      clearTimeout(resting);
      clearInterval(watching);
    },

    /** A click that is no touch: it copies what names an element, or checks it. */
    pick(m: ViewerMessage) {
      const u = under({ x: Number(m.x), y: Number(m.y) });
      if (!u?.e) {
        o.say('Nothing is named there');
        return;
      }
      if (m.as === 'copy') {
        const text = selectorLine(named(u.screen, u.e).selector);
        o.tell({ op: 'copyText', text });
        o.say(`Copied ${text}`);
        return;
      }
      const { step, aim } = assertion(u.screen, u.e);
      o.say(o.assert(step, aim) ? `Added ${stepLine(step)}` : 'Start a recording first');
    },
  };
}
