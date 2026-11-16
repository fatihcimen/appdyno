/** Every failure an agent or the host reports, with what the caller can do about it. */
export const ERROR_CODES = [
  'TIMEOUT',
  'CANCELLED',
  'DEVICE_GONE',
  'AGENT_UNAVAILABLE',
  'AGENT_CONFLICT',
  'AGENT_VERSION_MISMATCH',
  'UNSUPPORTED',
  'PERMISSION_REQUIRED',
  'NOT_FOUND',
  'NO_FOCUS',
  'APP_NOT_RUNNING',
  'POLICY_DENIED',
  'INVALID_ARGUMENT',
  /** A touch aimed at a screen another window has replaced since it was read: read it again. */
  'STALE',
  /** A touch refused on a dark screen, where it would reach no window: wake it and ask again. */
  'SCREEN_OFF',
  'INTERNAL',
  /** More than one element matches a selector. Host only, never on the wire. */
  'AMBIGUOUS',
  /** An `assert` that does not hold. Host only, never on the wire. */
  'CHECK_FAILED',
  /** A project's own build failed, with what it said. Host only, never on the wire. */
  'BUILD_FAILED',
  /** Another live process holds the device. Host only, never on the wire. */
  'DEVICE_CLAIMED',
  /** A phone locked behind what this tool cannot answer. Host only, never on the wire. */
  'DEVICE_LOCKED',
  /** The package registry, or a pinned tool's release, cannot be reached. Host only, never on the wire. */
  'OFFLINE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Where a failed action's touch stands: `refused first` by an agent before it touched anything; `may have gone` from a
 * device that stopped answering, or a call stopped, which may have touched before it did; `if sent` went if the action
 * had left for the device.
 */
export type TouchByCode = 'refused first' | 'may have gone' | 'if sent';

/** What each code says to its caller: `retryable` is worth one retry, as the device may answer the next time. */
export const ERROR_TRAITS: Record<ErrorCode, { retryable: boolean; touch: TouchByCode }> = {
  TIMEOUT: { retryable: true, touch: 'may have gone' },
  CANCELLED: { retryable: false, touch: 'may have gone' },
  DEVICE_GONE: { retryable: true, touch: 'may have gone' },
  AGENT_UNAVAILABLE: { retryable: true, touch: 'may have gone' },
  AGENT_CONFLICT: { retryable: false, touch: 'refused first' },
  AGENT_VERSION_MISMATCH: { retryable: false, touch: 'refused first' },
  UNSUPPORTED: { retryable: false, touch: 'refused first' },
  PERMISSION_REQUIRED: { retryable: false, touch: 'refused first' },
  NOT_FOUND: { retryable: false, touch: 'if sent' },
  NO_FOCUS: { retryable: false, touch: 'refused first' },
  APP_NOT_RUNNING: { retryable: false, touch: 'if sent' },
  POLICY_DENIED: { retryable: false, touch: 'refused first' },
  INVALID_ARGUMENT: { retryable: false, touch: 'refused first' },
  STALE: { retryable: false, touch: 'refused first' },
  SCREEN_OFF: { retryable: false, touch: 'refused first' },
  INTERNAL: { retryable: false, touch: 'may have gone' },
  AMBIGUOUS: { retryable: false, touch: 'if sent' },
  CHECK_FAILED: { retryable: false, touch: 'if sent' },
  BUILD_FAILED: { retryable: false, touch: 'if sent' },
  DEVICE_CLAIMED: { retryable: false, touch: 'if sent' },
  DEVICE_LOCKED: { retryable: false, touch: 'if sent' },
  OFFLINE: { retryable: false, touch: 'if sent' },
};

/**
 * JSON-RPC error codes on the wire, each code's own number for good. They were the place of each code in the list
 * above, where a code put in the middle would have moved every one after it, on a host and its agents alike: a new
 * code takes the next number, and none is given again.
 */
export const RPC_CODES: Record<ErrorCode, number> = {
  TIMEOUT: -32000,
  CANCELLED: -32001,
  DEVICE_GONE: -32002,
  AGENT_UNAVAILABLE: -32003,
  AGENT_CONFLICT: -32004,
  AGENT_VERSION_MISMATCH: -32005,
  UNSUPPORTED: -32006,
  PERMISSION_REQUIRED: -32007,
  NOT_FOUND: -32008,
  NO_FOCUS: -32009,
  APP_NOT_RUNNING: -32010,
  POLICY_DENIED: -32011,
  INVALID_ARGUMENT: -32012,
  STALE: -32013,
  SCREEN_OFF: -32014,
  INTERNAL: -32015,
  AMBIGUOUS: -32016,
  CHECK_FAILED: -32017,
  BUILD_FAILED: -32018,
  DEVICE_CLAIMED: -32019,
  DEVICE_LOCKED: -32020,
  OFFLINE: -32021,
};
const BY_NUMBER = new Map(Object.entries(RPC_CODES).map(([code, n]) => [n, code as ErrorCode]));

export const rpcCode = (code: ErrorCode) => RPC_CODES[code];
export const codeOfRpc = (n: number): ErrorCode => BY_NUMBER.get(n) ?? 'INTERNAL';

export class DeviceError extends Error {
  readonly retryable: boolean;
  /** The action it failed on had left for the device, which may have done it: the read after a touch can fail too. */
  sent = false;
  /** Nothing of the call left this host, as it never began: its touch did not go, whatever its code says of others. */
  unsent = false;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly hint?: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, options);
    this.name = 'DeviceError';
    this.retryable = options?.retryable ?? ERROR_TRAITS[code].retryable;
  }
}
