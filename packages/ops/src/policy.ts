import { ToolError } from './tool.js';

/** What this server may do; set by its command line, never by a tool call. */
export type Policy = {
  /** Device serials this server may drive (a pattern); others are listed but refused. */
  devices?: RegExp;
  /** Apps that may be launched and stopped; empty: any. */
  apps: string[];
  /** Links `open_link` may open; empty: any http(s) link or app scheme. */
  urls?: RegExp;
  /** The home key leaves the app: off where nothing may leave it. */
  allowHome: boolean;
  /** Texts never typed, set on the clipboard or shown back (a test account's secrets). */
  secrets: string[];
  /** What loses data goes ahead with no question asked: on simulators and emulators, or on every device. */
  allowDataLoss?: 'virtual' | 'all';
};

export const DEFAULT_POLICY: Policy = { apps: [], allowHome: true, secrets: [] };

/** Schemes that reach the device's files, other components or code, not a page or an app screen. */
const UNSAFE_SCHEME = /^(file|content|intent|javascript|data|android-app|jar):/i;

export function checkUrl(policy: Policy, url: string): string {
  const u = url.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u))
    throw new ToolError('give a link with its scheme (https://… or app://…)', 'INVALID_ARGUMENT');
  if (UNSAFE_SCHEME.test(u))
    throw new ToolError(`this scheme is not opened: ${u.split(':')[0]}`, 'POLICY_DENIED');
  if (policy.urls && !policy.urls.test(u))
    throw new ToolError("this link is not on this server's allow list", 'POLICY_DENIED');
  return u;
}

export function checkApp(policy: Policy, pkg: string): string {
  if (policy.apps.length > 0 && !policy.apps.includes(pkg))
    throw new ToolError(
      `${pkg} is not an allowed app (${policy.apps.join(', ')})`,
      'POLICY_DENIED',
    );
  return pkg;
}

export function checkDevice(policy: Policy, serial: string): string {
  if (policy.devices && !policy.devices.test(serial))
    throw new ToolError(`${serial} is not allowed on this server`, 'POLICY_DENIED');
  return serial;
}

/** What a log may hold that nobody listed: tokens by their shape or by the word in front of them. */
const LOG_SECRETS: [RegExp, string][] = [
  [/\b(authorization\s*[:=]\s*)(?:bearer\s+|basic\s+)?[^\s,;"']+/gi, '$1•••'],
  [/\bbearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer •••'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, '•••'],
  [
    /\b(pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|session[_-]?id|cookie)(["']?\s*[:=]\s*["']?)[^\s,;&"']+/gi,
    '$1$2•••',
  ],
];

/** As `redact`, and hides what looks like a credential: for logs, which nobody wrote for an agent's eyes. */
export const redactLog = (policy: Policy, s: string) =>
  LOG_SECRETS.reduce((acc, [re, to]) => acc.replace(re, to), redact(policy, s));

/** Hides every secret in a text shown to the agent. */
export const redact = (policy: Policy, s: string) =>
  policy.secrets.reduce((acc, secret) => (secret ? acc.split(secret).join('•••') : acc), s);
