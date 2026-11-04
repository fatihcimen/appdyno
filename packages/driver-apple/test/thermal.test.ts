import { describe, expect, it } from 'vitest';
import { parseThermal } from '../src/trace-parse.js';

/** As Xcode 27 exports it from a phone's Time Profiler trace. */
const TABLE = (...states: string[]) =>
  `<node><schema name="device-thermal-state-intervals"><col><mnemonic>start</mnemonic></col><col><mnemonic>duration</mnemonic></col><col><mnemonic>end</mnemonic></col><col><mnemonic>thermal-state</mnemonic></col><col><mnemonic>track-label</mnemonic></col><col><mnemonic>is-induced</mnemonic></col></schema>${states
    .map(
      (s, i) =>
        `<row><start-time id="${i}1" fmt="0">0</start-time><duration id="${i}2" fmt="4 s">4</duration><start-time id="${i}3" fmt="4">4</start-time><thermal-state id="${i}4" fmt="${s}">${s}</thermal-state><string id="${i}5" fmt="Current">Current</string><boolean id="${i}6" fmt="No">0</boolean></row>`,
    )
    .join('')}</node>`;

describe('an iPhone’s thermal state', () => {
  it.each([
    ['Nominal', 0],
    ['Fair', 1],
    ['Serious', 2],
    ['Critical', 4],
  ])('%s reads as %i on the scale a run’s noise is judged by', (state, status) => {
    expect(parseThermal(TABLE(state))).toBe(status);
  });

  it('takes the state the recording ended in', () => {
    expect(parseThermal(TABLE('Nominal', 'Serious'))).toBe(2);
  });

  it('has none where the table is empty', () => {
    expect(parseThermal(TABLE())).toBeUndefined();
  });
});
