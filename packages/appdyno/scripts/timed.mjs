/** `count` timed calls after 3 that warm up; failures are counted and said, and the run goes on. */
export async function timedCalls(count, fn, between, label = '') {
  const ms = [];
  let failed = 0;
  for (let i = 0; i < count + 3; i++) {
    const t = performance.now();
    try {
      await fn();
      if (i >= 3) ms.push(performance.now() - t);
    } catch (e) {
      if (i >= 3) failed++;
      console.error(`${label}${e.message}`);
    }
    if (between) await between();
  }
  return { ms, failed };
}
