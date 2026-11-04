import { describe, expect, it } from 'vitest';
// @ts-expect-error: a script's reckoning, with no types of its own
import { byMinute, quietAndBusy } from '../scripts/mirror-bench-minutes.mjs';

const second = (o: Record<string, number>) => ({
  lostPackets: 0,
  heldPictures: 0,
  droppedPictures: 0,
  frozenMs: 0,
  arrived: 60,
  load: 10,
  ...o,
});

describe('a stream, minute by minute', () => {
  it('gives each minute its own rise, its worst load, and takes a reconnect from zero', () => {
    const seconds = [
      ...Array.from({ length: 60 }, () => second({})),
      second({ lostPackets: 100, heldPictures: 30, frozenMs: 500, load: 300, loopLagMs: 80 }),
      ...Array.from({ length: 59 }, () =>
        second({ lostPackets: 100, heldPictures: 30, frozenMs: 500 }),
      ),
      second({ lostPackets: 5, heldPictures: 2, frozenMs: 40 }),
    ];
    const minutes = byMinute(seconds);
    expect(minutes.map((m: { lost: number }) => m.lost)).toEqual([0, 100, 5]);
    expect(minutes[1]).toMatchObject({ held: 30, frozenMs: 500, load: 300, lagMs: 80 });
    expect(minutes[2]).toMatchObject({ held: 2, frozenMs: 40 });
  });

  it('leaves out seconds with no counts, and tells quiet minutes from loaded ones', () => {
    const seconds = [{ arrived: 1, load: 1 }, second({ lostPackets: 3, load: 100 }), second({})];
    const minutes = byMinute(seconds);
    expect(minutes).toHaveLength(1);
    expect(quietAndBusy(minutes, 60)).toEqual([
      'at or under load 60: 0 min, 0 lost, 0 of 0 pictures held, 0.0 s frozen',
      'above load 60: 1 min, 3 lost, 0 of 120 pictures held, 0.0 s frozen',
    ]);
  });
});
