import {
  DEFAULT_POLICY,
  secretsOf,
  ToolError,
  writeDirsOf,
  type Policy as ToolPolicy,
} from '@appdyno/ops';
import type { ConnectOptions, Policy, Signing } from './library.js';

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

/** A list of texts as a program gave it, said here where it is none. */
function texts(given: unknown, name: string): string[] {
  if (given === undefined) return [];
  if (Array.isArray(given) && given.every((x) => typeof x === 'string')) return given;
  throw new ToolError(`${name} takes a list of texts, as ['a', 'b']`, 'INVALID_ARGUMENT');
}

/** What a program allows, by either spelling: the options `connect` has by name, and `policy`, which adds to them. */
type Allowed = Pick<
  ConnectOptions,
  'allowDevices' | 'allowUrls' | 'allowWrite' | 'allowBuild' | 'secrets'
> & { policy?: Policy };

/**
 * A program's options as the policy the tools keep, for `connect` and for a device opened from code alike. A link's
 * list is `policy.urls`, else `allowUrls`; secrets and folders are those of both, and those the environment names for
 * a server: `APPDYNO_SECRETS`, `APPDYNO_SECRETS_FILE` and `APPDYNO_ALLOW_WRITE`.
 */
export function policyFor(given: Allowed): ToolPolicy {
  const { policy = {} } = given;
  const devices = regularExpression(given.allowDevices);
  const urls =
    regularExpression(policy.urls, ['policy.urls', '/^myapp:/']) ??
    regularExpression(given.allowUrls, ['allowUrls', '/^myapp:/']);
  return {
    ...DEFAULT_POLICY,
    ...(devices && { devices }),
    ...(urls && { urls }),
    ...(given.allowBuild === true && { allowBuild: true }),
    apps: texts(policy.apps, 'policy.apps'),
    // `secrets` by its name takes one text too, as it did before `policy` was there
    secrets: secretsOf(process.env, [
      ...[given.secrets ?? []].flat(),
      ...texts(policy.secrets, 'policy.secrets'),
    ]),
    writeDirs: writeDirsOf([
      ...texts(given.allowWrite, 'allowWrite'),
      ...texts(policy.write, 'policy.write'),
    ]),
  };
}

/** An iPhone's signing as a program gave it: a profile's path, and no other field but a keychain and its password. */
export function signingOf(given: unknown): Signing | undefined {
  if (given === undefined) return undefined;
  const { profile, keychain, keychainPassword } = given as Partial<Record<keyof Signing, unknown>>;
  const text = (x: unknown): x is string | undefined => x === undefined || typeof x === 'string';
  if (typeof profile !== 'string' || !profile || !text(keychain) || !text(keychainPassword))
    throw new ToolError(
      "signing takes a provisioning profile's path as profile, and a keychain and keychainPassword as texts",
      'INVALID_ARGUMENT',
    );
  return {
    profile,
    ...(keychain !== undefined && { keychain }),
    ...(keychainPassword !== undefined && { keychainPassword }),
  };
}
