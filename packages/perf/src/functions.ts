/** A function must move this far in ms of CPU a second, about 2 % of a core, and this share of itself. */
const FLOOR_MS_A_SECOND = 20;
const FLOOR_SHARE = 0.25;

/** What a diff reads of a profile; on either platform a sample is a millisecond of CPU. */
type Profile = {
  durationMs: number;
  top: { symbol: string; samples: number }[];
  appTop?: { symbol: string; samples: number }[] | undefined;
};

export type FunctionChange = {
  symbol: string;
  beforeMs: number;
  afterMs: number;
  changeMs: number;
};

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Each function's CPU a second, so that windows of other lengths compare: the app's own, where the profile has them. */
const rates = (p: Profile) =>
  new Map(
    (p.appTop?.length ? p.appTop : p.top).map((e) => [e.symbol, (e.samples / p.durationMs) * 1000]),
  );

/**
 * What moved between two profiles, most first: what a gate's alarm comes down to. A function neither lists counts as
 * nothing, which is below the floor either way, and two runs of the same work name nothing.
 */
export function functionDiff(before: Profile, after: Profile): FunctionChange[] {
  const [a, b] = [rates(before), rates(after)];
  return [...new Set([...a.keys(), ...b.keys()])]
    .map((symbol) => {
      const [was, is] = [a.get(symbol) ?? 0, b.get(symbol) ?? 0];
      return { symbol, was, is, moved: is - was };
    })
    .filter(
      ({ was, is, moved }) =>
        Math.abs(moved) >= FLOOR_MS_A_SECOND && Math.abs(moved) >= FLOOR_SHARE * Math.max(was, is),
    )
    .sort((x, y) => Math.abs(y.moved) - Math.abs(x.moved))
    .map(({ symbol, was, is, moved }) => ({
      symbol,
      beforeMs: r1(was),
      afterMs: r1(is),
      changeMs: r1(moved),
    }));
}
