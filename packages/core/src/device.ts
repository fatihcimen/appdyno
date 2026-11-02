import type { Read, SettleInput } from '@appdyno/protocol';

/** Per-command limits (ms); the settle cap is added to an action's. */
export const TIMEOUTS = {
  hello: 10_000,
  action: 15_000,
  text: 30_000,
  read: 15_000,
  screenshot: 30_000,
  app: 60_000,
  /** The iOS platform audit takes seconds on a busy screen: a stuck-runner restart must not cut it. */
  audit: 30_000,
} as const;

export type ActOptions = { settle?: SettleInput | false; read?: Read; before?: string };

/** A measurement and the raw output it was read from (kept as its proof). */
export type Measured<T> = { value: T; raw: string; at: string };

export type ProfileEntry = { percent: number; samples: number; symbol: string };
export type CpuProfile = { durationMs: number; samples: number; top: ProfileEntry[] };
