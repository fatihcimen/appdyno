import type { MeasureId, Unit } from '../record.js';

/** From which size a value reads in which unit. */
export const UNIT_STEPS: Record<Unit, [from: number, per: number, suffix: string][]> = {
  ms: [
    [0, 1, 'ms'],
    [10_000, 1_000, 's'],
  ],
  percent: [[0, 1, '%']],
  kb: [
    [0, 1, 'KB'],
    [1 << 10, 1 << 10, 'MB'],
    [1 << 20, 1 << 20, 'GB'],
  ],
  bytes: [
    [0, 1, 'bytes'],
    [1 << 10, 1 << 10, 'KB'],
    [1 << 20, 1 << 20, 'MB'],
    [1 << 30, 1 << 30, 'GB'],
  ],
  count: [[0, 1, '']],
  mah: [[0, 1, 'mAh']],
  mj: [[0, 1, 'mJ']],
  ratio: [[0, 1, '']],
};

export type Scale = { per: number; suffix: string };

/** The one unit a set of values reads in, from its largest. */
export function scaleOf(unit: Unit, largest: number): Scale {
  const steps = UNIT_STEPS[unit];
  const [, per, suffix] = steps.findLast(([from]) => Math.abs(largest) >= from) ?? steps[0]!;
  return { per, suffix };
}

const formatters = new Map<number, Intl.NumberFormat>();

/** Making a formatter is what costs, and a page prints thousands of numbers. */
export function withDigits(x: number, maximumFractionDigits: number) {
  const held = formatters.get(maximumFractionDigits);
  const f = held ?? new Intl.NumberFormat('en-US', { maximumFractionDigits });
  if (!held) formatters.set(maximumFractionDigits, f);
  return f.format(x);
}

const number = (x: number) => withDigits(x, Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2);

export const inScale = (v: number, s: Scale) =>
  `${number(v / s.per)}${s.suffix ? ` ${s.suffix}` : ''}`;

export const formatValue = (v: number, unit: Unit) => inScale(v, scaleOf(unit, v));

export const time = (at: string) => Date.parse(at);

export function age(at: string, now: number) {
  const s = Math.max(0, (now - time(at)) / 1_000);
  if (s < 60) return 'just now';
  if (s < 3_600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3_600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

/** A time as the page prints it: always UTC, so that a rewrite on another machine reads the same. */
export const when = (at: string) => {
  const iso = new Date(at).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
};

const KINDS: Record<string, string> = {
  'android-virtual': 'Android emulator',
  'android-physical': 'Android phone',
  'ios-virtual': 'iOS simulator',
  'ios-physical': 'iPhone',
};

export type DeviceName = { name: string; detail: string; virtual: boolean };

/** A device class in words; `model` is the record's own spelling, where the class has only a safe one. */
export function deviceName(cls: string, model?: string): DeviceName {
  const m = /^(android|ios)-(virtual|physical)-(.+)-([^-]+)$/.exec(cls);
  if (!m) return { name: cls, detail: '', virtual: false };
  const [, platform, where, safeModel, os] = m;
  const name = KINDS[`${platform}-${where}`]!;
  const version = `${platform === 'ios' ? 'iOS' : 'Android'} ${os}`;
  const shown = model ?? safeModel;
  return {
    name,
    detail: shown === name ? version : `${shown}, ${version}`,
    virtual: where === 'virtual',
  };
}

export const deviceLabel = (d: DeviceName) => (d.detail ? `${d.name} (${d.detail})` : d.name);

export const MEASURE_TITLE: Record<MeasureId, string> = {
  launch: 'Launch',
  'launch-why': 'Why launch was slow',
  frames: 'Frames',
  stalls: 'Main-thread stalls',
  memory: 'Memory',
  leaks: 'Leaks',
  cpu: 'CPU',
  network: 'Network bytes',
  energy: 'Energy',
  crashes: 'Crashes, ANRs',
  size: 'App size',
};

/** A row's title, when it is one of the measures. */
export const measureTitle = (row: string) =>
  Object.hasOwn(MEASURE_TITLE, row) ? MEASURE_TITLE[row as MeasureId] : undefined;

/** The anchor of an app's section. */
export const appAnchor = (app: string) => `app-${app.replace(/[^\w.-]+/g, '_')}`;
