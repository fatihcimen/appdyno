type Band = 'good' | 'warn' | 'slow';
/** A dial's scale: where it ends, where its ticks and numbers are, and its bands as [up to, kind]. */
type Scale = {
  max: number;
  major: number;
  minor: number;
  unit: string;
  bands: readonly (readonly [to: number, kind: Band])[];
};

const launch = {
  max: 1000,
  major: 200,
  minor: 50,
  unit: 'ms',
  bands: [
    [500, 'good'],
    [800, 'warn'],
    [1000, 'slow'],
  ],
} as const;

/** The dials of the page: the bench's three, and the story's, which reads a launch too. */
export const SCALES = {
  launch,
  frames: {
    max: 60,
    major: 10,
    minor: 2,
    unit: 'fps',
    bands: [
      [30, 'slow'],
      [50, 'warn'],
      [60, 'good'],
    ],
  },
  memory: {
    max: 400,
    major: 100,
    minor: 25,
    unit: 'MB',
    bands: [
      [200, 'good'],
      [300, 'warn'],
      [400, 'slow'],
    ],
  },
  story: launch,
} as const satisfies Record<string, Scale>;

export type Gauge = keyof typeof SCALES;

/** A needle goes from -120° to 120°, clockwise from straight up, over its dial's whole scale. */
const SWEEP = 120;
export const angleOf = (share: number) => -SWEEP + Math.min(Math.max(share, 0), 1) * 2 * SWEEP;
export const turn = (share: number) => `rotate(${angleOf(share)}deg)`;

/** The point at a radius and an angle of a dial drawn 200 wide around 100,100. */
export const pointAt = (radius: number, angle: number) => {
  const a = (angle * Math.PI) / 180;
  return [100 + radius * Math.sin(a), 100 - radius * Math.cos(a)].map((n) => +n.toFixed(1)) as [
    number,
    number,
  ];
};

/** An arc of the dial between two angles, as a path. */
export const arcOf = (radius: number, from: number, to: number) =>
  `M${pointAt(radius, from).join(' ')}A${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${pointAt(radius, to).join(' ')}`;

/** What a dial's face has: each band's arc, and each tick with its number where it is a major one. */
export const faceOf = ({ max, major, minor, bands }: Scale) => {
  const at = (value: number) => angleOf(value / max);
  return {
    bands: bands.map(([to, kind], i) => ({
      kind,
      d: arcOf(78, at(bands[i - 1]?.[0] ?? 0), at(to)),
    })),
    ticks: Array.from({ length: max / minor + 1 }, (_, i) => i * minor).map((value) => {
      const big = value % major === 0;
      return {
        value,
        big,
        from: pointAt(big ? 62 : 68, at(value)),
        to: pointAt(74, at(value)),
        number: pointAt(47, at(value)),
      };
    }),
  };
};
