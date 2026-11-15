import { ToolError } from '@appdyno/ops';

/** An `allowDevices` as a program gave it: plain JavaScript can give anything, said here, not as a TypeError on every call. */
export function regularExpression(given: unknown): RegExp | undefined {
  if (given === undefined || given instanceof RegExp) return given;
  throw new ToolError(
    `allowDevices takes a regular expression, as /^emulator-/, not ${typeof given === 'object' ? 'an object' : `a ${typeof given}`}`,
    'INVALID_ARGUMENT',
    'new RegExp(text) makes one of a pattern held as text',
  );
}
