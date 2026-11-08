import type { InputEvent } from '@appdyno/core';
import { describe, expect, it, vi } from 'vitest';
import { applePress } from '../src/mirror-press.js';

const sent = () => {
  const events: InputEvent[] = [];
  return {
    events,
    send: (e: InputEvent) => {
      events.push(e);
      return Promise.resolve();
    },
  };
};

describe('a press on an Apple device', () => {
  it('opens an app switcher by Home twice, and keeps the next press apart from them', async () => {
    vi.useFakeTimers();
    const { events, send } = sent();
    let done = false;
    const pressed = applePress('appSwitch', send).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(150 + 499);
    expect([events, done]).toEqual([
      [
        { kind: 'button', name: 'home' },
        { kind: 'button', name: 'home' },
      ],
      false,
    ]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pressed).toBe(true);
    vi.useRealTimers();
  });

  it('holds the side button for Siri, down then up', async () => {
    const { events, send } = sent();
    expect(await applePress('siri', send)).toBe(true);
    expect(events.map((e) => (e as { state: number }).state)).toEqual([1, 2]);
  });

  it("leaves a device's own key alone", async () => {
    const { events, send } = sent();
    expect(await applePress('home', send)).toBe(false);
    expect(events).toEqual([]);
  });
});
