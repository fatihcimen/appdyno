import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARC, SCALES, shareOf, type Gauge } from '../src/components/landing/dials.ts';
import { JOBS, READINGS, jobsOf } from '../src/components/landing/scenarios.ts';
import { words } from '../src/i18n/index.ts';

test('a dial fills its share of the arc and stays on it', () => {
  assert.equal(shareOf('launch', 0), 0);
  assert.equal(shareOf('launch', 412), 0.412);
  assert.equal(shareOf('frames', 60), 1);
  assert.equal(shareOf('memory', 900), 1);
  assert.equal(shareOf('memory', -1), 0);
});

test('the arc is 240° about the middle of its dial, open at the bottom', () => {
  const [x1 = 0, y1 = 0, radius = 0, , , large, sweep, x2 = 0, y2 = 0] = ARC.split(/[MA ]/)
    .filter(Boolean)
    .map(Number);
  for (const [x, y] of [
    [x1, y1],
    [x2, y2],
  ] as const) {
    assert.ok(Math.abs(Math.hypot(x - 100, y - 100) - radius) < 0.1, 'an end is on the circle');
    // 120° to each side of straight up
    assert.ok(Math.abs(Math.atan2(Math.abs(x - 100), 100 - y) - (2 * Math.PI) / 3) < 0.01);
  }
  assert.deepEqual([large, sweep], [1, 1], 'the long way round, clockwise');
});

test('every number a job sends to a dial is on its scale, in each language', () => {
  for (const id of Object.keys(SCALES) as Gauge[]) assert.ok(READINGS[id] <= SCALES[id].max);
  for (const t of Object.values(words)) {
    const jobs = jobsOf(t);
    for (const job of JOBS) {
      assert.ok(t.console[job].chip, `${job} has a chip`);
      for (const step of jobs[job])
        if ('gauge' in step) {
          const [id, value] = step.gauge;
          assert.ok(value > 0 && value <= SCALES[id].max, `${job}: ${id} reads ${value}`);
        }
    }
  }
});
