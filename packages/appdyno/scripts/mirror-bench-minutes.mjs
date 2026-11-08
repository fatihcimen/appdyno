/**
 * A second of a stream, as the viewer counted it, with the host's load beside it.
 * @typedef {{ load: number } & Partial<Record<'arrived' | 'loopLagMs' | Count, string | number>>} Second
 * @typedef {'lostPackets' | 'heldPictures' | 'droppedPictures' | 'frozenMs'} Count
 * @typedef {{ minute: number; lost: number; held: number; dropped: number; frozenMs: number; frames: number; lagMs: number; load: number }} Minute
 */

/**
 * What each minute of a stream lost and held, beside the load: a total says nothing of when. The counts run from the
 * stream's start, so a minute's own are told by the one before it; a reconnect shows as a fall, and is taken from zero.
 * @param {Second[]} seconds
 */
export function byMinute(seconds) {
  /** @type {Minute[]} */
  const minutes = [];
  /** @type {Second | undefined} */
  let before;
  for (const [i, n] of seconds.entries()) {
    if (n.lostPackets === undefined) continue;
    const at = Math.floor(i / 60);
    const m = (minutes[at] ??= {
      minute: at,
      lost: 0,
      held: 0,
      dropped: 0,
      frozenMs: 0,
      frames: 0,
      lagMs: 0,
      load: n.load,
    });
    /** @param {Count} key */
    const rise = (key) => {
      const now = Number(n[key]);
      const was = Number(before?.[key] ?? 0);
      return now >= was ? now - was : now;
    };
    m.lost += rise('lostPackets');
    m.held += rise('heldPictures');
    m.dropped += rise('droppedPictures');
    m.frozenMs += rise('frozenMs');
    m.frames += Number(n.arrived);
    m.lagMs = Math.max(m.lagMs, Number(n.loopLagMs ?? 0));
    m.load = Math.max(m.load, n.load);
    before = n;
  }
  return minutes.filter(Boolean);
}

/**
 * Quiet minutes against loaded ones: at a high load a figure is no proof of the path.
 * @param {Minute[]} minutes
 * @param {number} limit
 */
export function quietAndBusy(minutes, limit) {
  return [minutes.filter((m) => m.load <= limit), minutes.filter((m) => m.load > limit)].map(
    (list, i) => {
      /** @param {keyof Minute} key */
      const sum = (key) => list.reduce((a, m) => a + m[key], 0);
      return `${i ? 'above' : 'at or under'} load ${limit}: ${list.length} min, ${sum('lost')} lost, ${sum('held')} of ${sum('frames') + sum('held')} pictures held, ${(sum('frozenMs') / 1000).toFixed(1)} s frozen`;
    },
  );
}
