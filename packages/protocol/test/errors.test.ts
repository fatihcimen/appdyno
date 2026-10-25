import { describe, expect, it } from 'vitest';
import { DeviceError, ERROR_CODES, codeOfRpc, rpcCode } from '../src/errors.js';

describe('error codes', () => {
  it('maps every code to a JSON-RPC number and back', () => {
    for (const c of ERROR_CODES) expect(codeOfRpc(rpcCode(c))).toBe(c);
    expect(codeOfRpc(-32601)).toBe('INTERNAL');
  });
  it('marks transient failures retryable', () => {
    expect(new DeviceError('TIMEOUT', 'x').retryable).toBe(true);
    expect(new DeviceError('NOT_FOUND', 'x').retryable).toBe(false);
  });
});
