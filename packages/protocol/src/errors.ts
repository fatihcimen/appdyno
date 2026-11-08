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

/** Codes worth one retry by the caller (the device may answer the next time). */
const RETRYABLE: ReadonlySet<ErrorCode> = new Set(['TIMEOUT', 'AGENT_UNAVAILABLE', 'DEVICE_GONE']);

/** JSON-RPC error codes on the wire: -32000 minus the index of the code. */
export const rpcCode = (code: ErrorCode) => -32000 - ERROR_CODES.indexOf(code);
export const codeOfRpc = (n: number): ErrorCode => ERROR_CODES[-32000 - n] ?? 'INTERNAL';

export class DeviceError extends Error {
  readonly retryable: boolean;
  /** The action it failed on had left for the device, which may have done it: the read after a touch can fail too. */
  sent = false;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly hint?: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, options);
    this.name = 'DeviceError';
    this.retryable = options?.retryable ?? RETRYABLE.has(code);
  }
}
