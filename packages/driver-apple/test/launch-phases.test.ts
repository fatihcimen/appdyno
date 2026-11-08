import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { must } from '@appdyno/core';
import { parseLaunchPhases } from '../src/launch-phases.js';

const recorded = (f: string) =>
  parseLaunchPhases(readFileSync(join(import.meta.dirname, 'fixtures', f), 'utf8'));
const phase = (r: ReturnType<typeof recorded>, name: string) =>
  r.phases.find((p) => p.name === name)?.ms;

/** The fixture on an iPhone 13 Pro Max, iOS 27.0.1: as it is, and with a 500 ms sleep in its `App.init`. */
describe('App Launch phases on recorded traces', () => {
  const base = recorded('ios-launch-phases.xml');
  const slow = recorded('ios-launch-phases-slow.xml');

  it('names the phases, a repeated period added up', () => {
    expect(base.phases.map((p) => p.name)).toEqual([
      'system_interface_initialization',
      'static_runtime_initialization',
      'main',
      'uikit_initialization',
      'uikit_scene_creation',
      'did_finish_launching_with_options',
      'scene_will_connect_to',
      'scene_will_enter_foreground',
      'initial_frame_rendering',
      'other',
    ]);
    expect(phase(base, 'system_interface_initialization')).toBe(68.9);
    // 2.79 + 6.43 + 0.16 + 0.35 ms, its four rows
    expect(phase(base, 'uikit_scene_creation')).toBe(9.7);
  });

  it('the phases add up to the time until the foreground', () => {
    const sum = base.phases.reduce((a, p) => a + p.ms, 0);
    expect(Math.abs(sum - base.totalMs)).toBeLessThan(1);
    expect(base.totalMs).toBe(144.1);
  });

  it('a 500 ms slow start is named in `main`, within 15 %', () => {
    const added = must(phase(slow, 'main'), 'main') - must(phase(base, 'main'), 'main');
    expect(added).toBeGreaterThan(500 * 0.85);
    expect(added).toBeLessThan(500 * 1.15);
    expect(slow.phases.toSorted((a, b) => b.ms - a.ms)[0]?.name).toBe('main');
  });

  it('a table with no rows has no phases and no time', () => {
    expect(parseLaunchPhases('<trace-query-result/>')).toEqual({ phases: [], totalMs: 0 });
  });
});
