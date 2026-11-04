/** A function must move this far in ms of CPU a second, about 2 % of a core, and this share of itself. */
const FLOOR_MS_A_SECOND = 20;
const FLOOR_SHARE = 0.25;

/** What a diff reads of a profile; on either platform a sample is a millisecond of CPU. */
export type Profile = {
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
 * What moved between two readings past both floors, most first. A name one of them lacks counts as nothing there, and
 * only what passes both floors is called: two runs of the same work name nothing.
 */
export function moved(
  before: Map<string, number>,
  after: Map<string, number>,
  floor: number,
  share: number,
) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .map((name) => {
      const [was, is] = [before.get(name) ?? 0, after.get(name) ?? 0];
      return { name, was, is, change: is - was };
    })
    .filter(
      ({ was, is, change }) =>
        Math.abs(change) >= floor && Math.abs(change) >= share * Math.max(was, is),
    )
    .sort((x, y) => Math.abs(y.change) - Math.abs(x.change))
    .map(({ name, was, is, change }) => ({
      name,
      beforeMs: r1(was),
      afterMs: r1(is),
      changeMs: r1(change),
    }));
}

/** What moved between two profiles, most first: what a gate's alarm comes down to. */
export const functionDiff = (before: Profile, after: Profile): FunctionChange[] =>
  moved(rates(before), rates(after), FLOOR_MS_A_SECOND, FLOOR_SHARE).map(({ name, ...change }) => ({
    symbol: name,
    ...change,
  }));
