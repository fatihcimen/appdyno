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
};

export const DEFAULT_POLICY: Policy = { apps: [], allowHome: true, secrets: [] };

/** Schemes that reach the device's files, other components or code, not a page or an app screen. */
const UNSAFE_SCHEME = /^(file|content|intent|javascript|data|android-app|jar):/i;

export function checkUrl(policy: Policy, url: string): string {
  const u = url.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u))
    throw new ToolError('bir link ver (şema ile: https://… ya da uygulama://…)');
  if (UNSAFE_SCHEME.test(u)) throw new ToolError(`bu şema açılmaz: ${u.split(':')[0]}`);
  if (policy.urls && !policy.urls.test(u))
    throw new ToolError('bu link bu sunucunun izin listesinde yok');
  return u;
}

export function checkApp(policy: Policy, pkg: string): string {
  if (policy.apps.length > 0 && !policy.apps.includes(pkg))
    throw new ToolError(`${pkg} izinli uygulamalardan değil (${policy.apps.join(', ')})`);
  return pkg;
}

export function checkDevice(policy: Policy, serial: string): string {
  if (policy.devices && !policy.devices.test(serial))
    throw new ToolError(`${serial} bu sunucuya verilmemiş`);
  return serial;
}

/** Hides every secret in a text shown to the agent. */
export const redact = (policy: Policy, s: string) =>
  policy.secrets.reduce((acc, secret) => (secret ? acc.split(secret).join('•••') : acc), s);
