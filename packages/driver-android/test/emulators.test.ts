import { describe, expect, it } from 'vitest';
import { portFor } from '../src/emulators.js';

describe('an emulator started', () => {
  it('takes the port it ran on again, so that its serial comes back, and else the first free one', () => {
    const taken = new Set(['emulator-5554']);
    expect(portFor(taken, 'emulator-5682')).toBe(5682);
    expect(portFor(taken)).toBe(5556);
    expect(portFor(new Set(['emulator-5554', 'emulator-5682']), 'emulator-5682')).toBe(5556);
    expect(portFor(new Set(), 'R5CT10ABCDE')).toBe(5554);
  });
});
