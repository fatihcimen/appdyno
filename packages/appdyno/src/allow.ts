import { ToolError } from '@appdyno/ops';

/** An `allowDevices` or `allowUrls` as a program gave it: plain JavaScript can give anything, said here, not as a TypeError on every call. */
export function regularExpression(
  given: unknown,
  [name, example] = ['allowDevices', '/^emulator-/'],
): RegExp | undefined {
  if (given === undefined || given instanceof RegExp) return given;
  throw new ToolError(
    `${name} takes a regular expression, as ${example}, not ${typeof given === 'object' ? 'an object' : `a ${typeof given}`}`,
    'INVALID_ARGUMENT',
    'new RegExp(text) makes one of a pattern held as text',
  );
}
