/** Pure numbers of a measurement: the same answer every time for the same samples. */

export const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return Number.NaN;
  const i = (s.length - 1) * q;
  const low = Math.floor(i);
  return s[low]! + (s[Math.min(low + 1, s.length - 1)]! - s[low]!) * (i - low);
};

/** The middle sample, or the mean of the two in the middle; NaN for no samples. */
export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return Number.NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export const round1 = (x: number) => Math.round(x * 10) / 10;
