/**
 * `value`, which the code knows is there where the types cannot follow it: an index within bounds, a key it set, a
 * regex's group. One that is not throws, naming `what`, where a `!` went on with undefined.
 */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`${what} is missing`);
  return value;
}
