/**
 * A tap's answer, with the settle and the read a run asked for: it cannot go on without them.
 * @template T
 * @param {T & { settle?: unknown }} r
 * @returns {{ [K in keyof T]-?: NonNullable<T[K]> }}
 */
export function answered(r) {
  if (!r.settle) throw new Error('a tap came back with no settle');
  return /** @type {any} */ (r);
}

/**
 * `count` timed calls after 3 that warm up; failures are counted and said, and the run goes on.
 * @param {number} count
 * @param {() => Promise<unknown>} fn
 * @param {() => Promise<unknown>} [between]
 */
export async function timedCalls(count, fn, between, label = '') {
  /** @type {number[]} */
  const ms = [];
  let failed = 0;
  for (let i = 0; i < count + 3; i++) {
    const t = performance.now();
    try {
      await fn();
      if (i >= 3) ms.push(performance.now() - t);
    } catch (e) {
      if (i >= 3) failed++;
      console.error(`${label}${e instanceof Error ? e.message : String(e)}`);
    }
    if (between) await between();
  }
  return { ms, failed };
}
