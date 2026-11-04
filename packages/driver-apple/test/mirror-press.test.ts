import type { InputEvent } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { applePress } from '../src/mirror-press.js';

const sent = () => {
  const events: InputEvent[] = [];
  return { events, send: async (e: InputEvent) => void events.push(e) };
};

describe('a press on an Apple device', () => {
  it('opens an app switcher by Home twice', async () => {
    const { events, send } = sent();
    expect(await applePress('appSwitch', send)).toBe(true);
    expect(events).toEqual([
      { kind: 'button', name: 'home' },
      { kind: 'button', name: 'home' },
    ]);
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
