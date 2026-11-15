import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCALES, angleOf, arcOf, faceOf, pointAt, turn } from '../src/components/landing/dials.ts';

test('a needle sweeps 240 degrees and stays on its scale', () => {
  assert.equal(angleOf(0), -120);
  assert.equal(angleOf(0.5), 0);
  assert.equal(angleOf(1), 120);
  assert.equal(angleOf(1.4), 120);
  assert.equal(angleOf(-1), -120);
  assert.equal(turn(0.75), 'rotate(60deg)');
});

test('a point is clockwise from straight up, around the middle of the dial', () => {
  assert.deepEqual(pointAt(50, 0), [100, 50]);
  assert.deepEqual(pointAt(50, 90), [150, 100]);
  assert.deepEqual(pointAt(50, -90), [50, 100]);
});

test('an arc is the long way round only past a half turn', () => {
  assert.equal(arcOf(50, -90, 90), 'M50 100A50 50 0 0 1 150 100');
  assert.equal(arcOf(50, -120, 120).split(' ')[5], '1');
});

test("a face's bands meet end to end over the whole scale, and its numbers are on the major ticks", () => {
  for (const scale of Object.values(SCALES)) {
    const face = faceOf(scale);
    const ends = face.bands.map((band) => band.d.split(/[MA]/).map((part) => part.trim()));
    assert.equal(ends[0]?.[1], pointAt(78, -120).join(' '));
    assert.ok(ends.at(-1)?.[2]?.endsWith(pointAt(78, 120).join(' ')));
    ends.slice(1).forEach((band, i) => assert.ok(ends[i]?.[2]?.endsWith(band[1] ?? '-')));
    assert.equal(face.ticks.at(-1)?.value, scale.max);
    assert.deepEqual(
      face.ticks.filter((tick) => tick.big).map((tick) => tick.value),
      Array.from({ length: scale.max / scale.major + 1 }, (_, i) => i * scale.major),
    );
  }
});
