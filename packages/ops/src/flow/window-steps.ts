import type { InputEvent, Screen } from '@appdyno/core';
import type { FlowStep, Recording } from '@appdyno/flows';
import { KEY_USAGES, KEYS, type Key } from '@appdyno/protocol';
import { keyName } from '../step-schemas.js';
import { type Aim, stepOf } from './aim.js';
import { StrokeReader } from './gestures.js';
import { TouchSteps } from './window-touches.js';
import { TypingSteps } from './window-typing.js';
import { StepWriter, type WindowStepsPort } from './window-writer.js';

export type { WindowStepsPort } from './window-writer.js';

const TAB = KEY_USAGES.tab.usage;

/** What a window's control is pressed as, where it is no key of the device. */
const VIEWS: Record<string, string> = {
  controlCenter: 'control_center',
  notifications: 'notification_center',
  spotlight: 'spotlight',
};

const keyOfButton = (name: string) =>
  VIEWS[name] ?? (KEYS.includes(name as Key) ? keyName(name as Key) : undefined);

/**
 * What a person does on a window, as a flow's steps, each on the screen it was done on. Input comes here after it
 * left for the device: this only ever queues work, so that nothing here is in front of a touch.
 */
export function windowSteps(o: WindowStepsPort) {
  const steps = new StepWriter(o);
  const typing = new TypingSteps(o, steps);
  const touches = new TouchSteps(o, steps, typing);
  const strokes = new StrokeReader();
  let before: Promise<Screen | undefined> = Promise.resolve(undefined);
  let lastKey: { key: string; index: number; count: number } | undefined;

  const onKey = (r: Recording, usage: number) => {
    const sent = o.keyOf(usage);
    if (usage === TAB) typing.field = undefined;
    if (!sent) return steps.told(r, 'a key with no step');
    const key = keyName(sent);
    const last = lastKey;
    if (last?.key === key && last.index === r.state.steps.length - 1) {
      last.count++;
      return steps.rewrite(r, 1, stepOf('press_key', {}, { key, count: last.count }));
    }
    steps.write(r, stepOf('press_key', {}, { key }));
    lastKey = { key, index: r.state.steps.length - 1, count: 1 };
  };

  const onButton = (r: Recording, name: string) => {
    const key = keyOfButton(name);
    if (!key)
      return steps.told(
        r,
        name.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`),
      );
    steps.write(r, stepOf('press_key', {}, { key }));
  };

  /** What ends what is being typed, with what comes after it on the screen `after` shows. */
  const thenOnScreen = (after: Promise<Screen | undefined>, work: (r: Recording) => void) => {
    typing.end(after);
    steps.inTurn(async (r) => {
      typing.endKeyed(r, await after);
      work(r);
    });
  };

  return {
    /** A person's input, as it left for the device. */
    input(e: InputEvent, now: number) {
      switch (e.kind) {
        case 'touch': {
          if (e.p === 0) {
            before = o.seen();
            typing.end(before);
          }
          const stroke = strokes.feed(e, now);
          const was = before;
          if (stroke) steps.inTurn((r) => touches.stroke(r, stroke, now, was));
          return;
        }
        case 'text':
          return typing.text(e.s);
        case 'key':
          if (e.state !== 1 || typing.key(e.usage)) return;
          return thenOnScreen(o.seen(), (r) => onKey(r, e.usage));
        case 'button':
          return thenOnScreen(o.seen(), (r) => onButton(r, e.name));
      }
    },

    /** Something done from the window that is no input: an app launched from the Apps pane, an assertion. */
    add(step: FlowStep, aim?: Aim) {
      thenOnScreen(o.seen(), (r) => {
        if (aim) touches.reached(r, aim);
        steps.write(r, step);
      });
    },

    /** Whatever is held goes down, read from the screen as it is. */
    async finish() {
      if (typing.holding) {
        const after = o.fresh();
        typing.end(after);
        steps.inTurn(async (r) => typing.endKeyed(r, await after));
      }
      await steps.done;
    },
  };
}
