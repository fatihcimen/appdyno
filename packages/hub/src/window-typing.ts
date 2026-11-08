import { randomUUID } from 'node:crypto';
import type { Screen, UiElement } from '@appdyno/core';
import type { Recording } from '@appdyno/flows';
import { KEY_USAGES } from '@appdyno/protocol';
import type { StepWriter, WindowStepsPort } from './window-writer.js';
import { fieldName, stepOf } from '@appdyno/ops';

/** As `type_text` takes it. */
const MOST_TEXT = 500;
/** A secret with no name of its own: typed, with nothing on the screen to say into what. */
const UNKNOWN_FIELD = 'TYPED';

const DELETE = KEY_USAGES.delete.usage;
const ENTER = KEY_USAGES.enter.usage;

type Typing = { text: string; submit: boolean; before: Promise<Screen | undefined> };

export const focusOf = (screen: Screen | undefined) => screen?.elements.find((e) => e.focused);

/** A field that holds nothing yet may still say its placeholder. */
const isEmpty = (f: UiElement) => !f.text || f.text === f.placeholder;

/** What a person types: from the Mac's keyboard as it is held back and written at its end, from the device's own as it is read back. */
export class TypingSteps {
  private typing: Typing | undefined;
  /** On-screen keys were tapped, into this field. */
  private keyed: { field: UiElement | undefined } | undefined;
  /** The field the last tap landed on. */
  field: UiElement | undefined;

  constructor(
    private readonly o: WindowStepsPort,
    private readonly steps: StepWriter,
  ) {}

  /** Anything is held that a read has yet to say. */
  get holding() {
    return !!(this.typing ?? this.keyed);
  }

  text(s: string) {
    this.typing ??= { text: '', submit: false, before: this.o.seen() };
    this.typing.text += s;
  }

  /** A key that belongs to what is being typed; true when it did. */
  key(usage: number) {
    if (!this.typing) return false;
    if (usage === DELETE) {
      this.typing.text = Array.from(this.typing.text).slice(0, -1).join('');
      return true;
    }
    if (usage !== ENTER) return false;
    this.typing.submit = true;
    this.end(this.o.seen());
    return true;
  }

  /** A tap on the device's own keyboard. */
  keyTapped(screen: Screen) {
    this.keyed ??= { field: this.field ?? focusOf(screen) };
  }

  /** The typing so far is a step, however it ended: `after` is what the screen came to. */
  end(after: Promise<Screen | undefined>) {
    const t = this.typing;
    this.typing = undefined;
    if (t) this.steps.inTurn((r) => this.written(r, t, after));
  }

  private async written(r: Recording, t: Typing, after: Promise<Screen | undefined>) {
    if (!t.text) return;
    const seen = [this.field, focusOf(await t.before), focusOf(await after)];
    const secure = seen.find((f) => f?.password);
    if (secure) r.learnSecret(t.text, fieldName(secure));
    else if (!seen.some(Boolean)) {
      // a field no read shows may be a password's: the file holds a name, and a run is given the text
      r.learnSecret(t.text, UNKNOWN_FIELD);
      this.o.say(
        `Typed into nothing the screen names: written as \${${UNKNOWN_FIELD}}, not as its text`,
      );
    }
    const parts = Array.from({ length: Math.ceil(t.text.length / MOST_TEXT) }, (_, i) =>
      t.text.slice(i * MOST_TEXT, (i + 1) * MOST_TEXT),
    );
    // into an empty field, what a person meant is that it says this: a replay finds it as a last run left it
    const known = seen.find(Boolean);
    const emptied = !!known && isEmpty(known);
    this.steps.write(
      r,
      (secure ? [t.text] : parts).map((text, i, all) =>
        stepOf(
          'type',
          {},
          {
            text,
            replace: (emptied && i === 0) || undefined,
            submit: (t.submit && i === all.length - 1) || undefined,
          },
        ),
      ),
    );
  }

  /** Keys tapped on the device's own keyboard are no taps: what they typed is read from the field afterwards. */
  endKeyed(r: Recording, after: Screen | undefined) {
    const k = this.keyed;
    this.keyed = undefined;
    if (!k) return;
    const el =
      after?.elements.find((e) => e.ref === k.field?.ref) ?? focusOf(after) ?? k.field ?? undefined;
    if (!el) {
      this.steps.told(r, "typing on the device's keyboard, into nothing the screen names");
      return;
    }
    // what a secure field holds no read gives: the step needs its name, and the flow's run its value
    const secret = el.password ? randomUUID() : undefined;
    const text = secret ?? el.text;
    if (secret) r.learnSecret(secret, fieldName(el));
    if (text) this.steps.write(r, stepOf('type', {}, { text, replace: true }));
    this.o.say("Typed on the device's keyboard: read from the field. Its Return key is not seen.");
  }
}
