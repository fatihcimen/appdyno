/** One part of a run split across machines: the `i`th of `n`, from 1. */
export type Shard = { i: number; n: number };

/** `i/n` as a shard; none where the words are no part of a split. */
export function shardOf(words: string): Shard | undefined {
  const m = /^(\d+)\/(\d+)$/.exec(words);
  const [i, n] = [Number(m?.[1]), Number(m?.[2])];
  return m && i >= 1 && i <= n ? { i, n } : undefined;
}

/**
 * The names that fall to a shard, in the order they were given. The split reads nothing of the machine, so that every
 * job makes the same one: the names in the order of their characters' codes, which no locale changes, dealt in turn.
 */
export function inShard<T>(all: T[], nameOf: (one: T) => string, { i, n }: Shard): T[] {
  const names = all.map(nameOf).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return all.filter((one) => names.indexOf(nameOf(one)) % n === i - 1);
}
