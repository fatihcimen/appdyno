import type { Rect, Screen } from '@appdyno/core';
import type { FlowStep, Recording } from '@appdyno/flows';
import type { Key } from '@appdyno/protocol';
import { addSteps, type Aim, keepRecording, type Size, unrecorded } from '@appdyno/ops';

/** What the writer needs of its window. */
export type WindowStepsPort = {
  /** What a person sees now: called in the same tick as their input, it is the screen they aimed at. */
  seen(): Promise<Screen | undefined>;
  /** The key the device was sent for a keyboard's usage. */
  keyOf(usage: number): Key | undefined;
  /** A read made for this, where no later input will say what the screen came to. */
  fresh(): Promise<Screen | undefined>;
  /** The screen's size in tap units. */
  sizeOf(screen: Screen): Size | undefined;
  keyboardOf(screen: Screen): Rect | undefined;
  /** The recording that takes this now. */
  recording(): Recording | undefined;
  /** A person is told, at that moment. */
  say(note: string): void;
  wrote(r: Recording): void;
};

/** Writes a window's steps one at a time: input only queues work, so that nothing here is in front of a touch. */
export class StepWriter {
  private turn: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: WindowStepsPort) {}

  inTurn(work: (r: Recording) => Promise<void> | void) {
    this.turn = this.turn
      .then(() => {
        const r = this.o.recording();
        return r && work(r);
      })
      .catch((e: Error) => this.o.say(e.message));
  }

  /** All that was queued has gone down. */
  get done() {
    return this.turn;
  }

  write(r: Recording, step: FlowStep | FlowStep[]) {
    addSteps(r, step);
    this.o.wrote(r);
  }

  /** The last steps turn out to have been this one. */
  rewrite(r: Recording, count: number, step: FlowStep) {
    r.rewrite(count, step);
    keepRecording(r);
    this.o.wrote(r);
  }

  told(r: Recording, what: string) {
    this.write(r, unrecorded(what));
    this.o.say(`Not a step: ${what}. A replay stops there.`);
  }

  coordinatesTold(a: Aim) {
    if (a.args) this.o.say('Written as coordinates: nothing names that place.');
  }
}
