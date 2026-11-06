export type LogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error';

export type LogsQuery = {
  app: string;
  /** Epoch ms; absent: the newest lines. */
  since?: number;
  level: LogLevel;
  maxLines: number;
  /** Each line's time too, in `LogsAnswer.marks`; `since` is then by the device's clock. */
  timed?: boolean;
  /** The process, for one that may have ended: a crash's own lines are read after it is gone. */
  pid?: string;
};

/** A line's place on the device's clock, in ms since the epoch, and how the platform ranked it. */
export type LogMark = { at: number; level?: 'warn' | 'error' };

/** The app's log lines as the platform prints them, and what the platform could not give. */
export type LogsAnswer = {
  lines: string[];
  source: string;
  note?: string;
  /** Asked with `timed`, one for each of `lines`. */
  marks?: LogMark[];
};

export type CrashesQuery = {
  app: string;
  /** Epoch ms; absent: any time. */
  since?: number;
  limit: number;
  /** A build's symbols: a `.dSYM` or a folder of them; on Android a folder of libraries that keep theirs. */
  symbols?: string;
};

export type CrashReport = {
  /** When, as the platform says it. */
  at: string;
  reason: string;
  /** The first lines of its stack or description. */
  detail?: string;
  /** The whole report on this machine. */
  file?: string;
  /** Its stack with the names `symbols` gave, on this machine. */
  symbolicated?: string;
};

/** One way an app's processes ended, as the system keeps them, with how many went that way. */
export type ExitCount = { reason: string; count: number; newest: string; memory?: string };

export type CrashesAnswer = {
  reports: CrashReport[];
  source: string;
  note?: string;
  /** Every exit the system keeps, by reason, what no one calls a crash too (Android). */
  exits?: ExitCount[];
};
