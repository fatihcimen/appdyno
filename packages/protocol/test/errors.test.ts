import { describe, expect, it } from 'vitest';
import { DeviceError, ERROR_CODES, ERROR_TRAITS, codeOfRpc, rpcCode } from '../src/errors.js';

describe('error codes', () => {
  it('maps every code to a JSON-RPC number and back', () => {
    for (const c of ERROR_CODES) expect(codeOfRpc(rpcCode(c))).toBe(c);
    expect(codeOfRpc(-32601)).toBe('INTERNAL');
  });
  it('marks transient failures retryable', () => {
    expect(new DeviceError('TIMEOUT', 'x').retryable).toBe(true);
    expect(new DeviceError('NOT_FOUND', 'x').retryable).toBe(false);
  });
  it('says of each code whether it is worth a retry and where its touch stands', () => {
    const where = (touch: string) => ERROR_CODES.filter((c) => ERROR_TRAITS[c].touch === touch);
    expect(ERROR_CODES.filter((c) => ERROR_TRAITS[c].retryable)).toEqual([
      'TIMEOUT',
      'DEVICE_GONE',
      'AGENT_UNAVAILABLE',
    ]);
    expect(where('refused first').toSorted()).toEqual([
      'AGENT_CONFLICT',
      'AGENT_VERSION_MISMATCH',
      'INVALID_ARGUMENT',
      'NO_FOCUS',
      'PERMISSION_REQUIRED',
      'POLICY_DENIED',
      'SCREEN_OFF',
      'STALE',
      'UNSUPPORTED',
    ]);
    expect(where('may have gone')).toEqual([
      'TIMEOUT',
      'CANCELLED',
      'DEVICE_GONE',
      'AGENT_UNAVAILABLE',
      'INTERNAL',
    ]);
  });
});
