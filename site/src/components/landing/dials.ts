/** The demo's dials: what each reads, in the words a developer says in any language, its unit and where its arc ends. */
export const SCALES = {
  launch: { label: 'Cold launch', unit: 'ms', max: 1000 },
  frames: { label: 'FPS', unit: '', max: 60 },
  memory: { label: 'Memory', unit: 'MB', max: 400 },
} as const;

export type Gauge = keyof typeof SCALES;

/** The share of its arc a dial's value fills, kept on the arc. */
export const shareOf = (id: Gauge, value: number) =>
  Math.min(1, Math.max(0, value / SCALES[id].max));

/** A dial's arc in a box 200 by 152: 240° about 100,100 at radius 84, open at the bottom. */
export const ARC = 'M27.3 142A84 84 0 1 1 172.7 142';
