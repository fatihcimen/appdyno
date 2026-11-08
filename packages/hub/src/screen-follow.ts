import { pause, type InputEvent, type Screen } from '@appdyno/core';

/** The least rest between reads: the device has an app to run. */
const GAP_MS = 150;
/** No read starts this soon after a finger lifts, when the app is answering it. */
const QUIET_MS = 100;
/** How often a follower held back looks again. */
const HELD_MS = 50;

export type FollowPort = {
  read(): Promise<Screen>;
  /** Whether a read may start now: one wakes a dark screen, and a measure's numbers are not to pay for it. */
  may(): boolean;
  failed(e: Error): void;
};

/**
 * What is on a device's screen, kept up to date beside a person's touches and never in front of them: a touch has
 * gone by the time a screen is asked of this, and nothing a touch waits for is read here. The screen a touch aimed
 * at is the one before it, which no read after the touch can give.
 */
export function followScreen(o: FollowPort) {
  let wanted = false;
  let running: Promise<void> | undefined;
  let newest: { screen: Screen; began: number } | undefined;
  let reading: Promise<Screen | undefined> | undefined;
  let fingerDown = false;
  let lastInput = 0;

  const readOnce = async () => {
    const began = Date.now();
    reading = o.read().then(
      (screen) => {
        newest = { screen, began };
        return screen;
      },
      (e: unknown) => {
        o.failed(e instanceof Error ? e : new Error(String(e)));
        return undefined;
      },
    );
    await reading;
    reading = undefined;
    // a slow device reads at most half of the time
    await pause(Math.max(GAP_MS, Date.now() - began));
  };

  const loop = async () => {
    while (wanted) {
      const held = !o.may() || fingerDown || Date.now() - lastInput < QUIET_MS;
      if (held) await pause(HELD_MS);
      else await readOnce();
    }
    running = undefined;
  };

  return {
    /** Reads run while something needs them, and only then. */
    want(on: boolean) {
      wanted = on;
      if (on) running ??= loop();
    },

    /** Input came: the next read waits for the hand to leave. */
    touched(e: InputEvent) {
      fingerDown = e.kind === 'touch' && e.p !== 2;
      lastInput = Date.now();
    },

    /**
     * What a person sees as this input comes, to be asked in the same tick: the newest read since the last input, else
     * the one under way, as that began before this input took effect, else the newest there is.
     */
    seen: (): Promise<Screen | undefined> => {
      if (newest && newest.began >= lastInput) return Promise.resolve(newest.screen);
      const last = newest?.screen;
      return reading ? reading.then((s) => s ?? last) : Promise.resolve(last);
    },

    latest: () => newest?.screen,

    /** The first screen there is: what a start waits for, and refuses with if a read fails. */
    async first(): Promise<Screen> {
      return newest?.screen ?? o.read();
    },
  };
}
