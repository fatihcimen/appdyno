import { must, SETTINGS_APP } from '@appdyno/core';
import type { Platform } from '@appdyno/protocol';
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
  /** An input on the system's own power, emergency or erase controls goes ahead with no question asked, as above. */
  allowPower?: 'virtual' | 'all';
};

export const DEFAULT_POLICY: Policy = { apps: [], allowHome: true, secrets: [] };

/** Schemes that reach the device's files, other components or code, not a page or an app screen. */
const UNSAFE_SCHEME = /^(file|content|intent|javascript|data|android-app|jar):/i;

/**
 * Links that open Settings, at a page or at an app's: iOS's prefs and App-prefs (a simulator opens App-prefs), and what
 * Android's VIEW could take to it. Each is Settings, an app of its own, whatever the page.
 */
const SETTINGS_LINK =
  /^((app-)?prefs|app-settings|settings-navigation|package|android\.settings\.[\w.]*):/i;

/** What a person does to allow what this server refuses by its flag: no call changes one. */
export const byPerson = (how: string) =>
  `the person who runs this server allows it ${how}, and no call can`;

/** Under --allow-apps Settings is an app like any other: it opens, by any route, only with its own id on the list. */
export function checkSettings(policy: Policy, platform: Platform) {
  const settings = SETTINGS_APP[platform];
  if (policy.apps.length > 0 && !policy.apps.includes(settings))
    throw new ToolError(
      `Settings is an app of its own, ${settings}, and not an allowed one (${policy.apps.join(', ')})`,
      'POLICY_DENIED',
      byPerson(`by adding ${settings} to --allow-apps`),
    );
}

export function checkUrl(policy: Policy, url: string, platform: Platform): string {
  const u = url.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u))
    throw new ToolError('give a link with its scheme (https://… or app://…)', 'INVALID_ARGUMENT');
  if (UNSAFE_SCHEME.test(u))
    throw new ToolError(
      `this scheme is not opened: ${must(u.split(':')[0], 'its scheme')}`,
      'POLICY_DENIED',
    );
  if (policy.urls && !policy.urls.test(u))
    throw new ToolError(
      "this link is not on this server's allow list",
      'POLICY_DENIED',
      byPerson('by --allow-urls'),
    );
  if (SETTINGS_LINK.test(u)) checkSettings(policy, platform);
  return u;
}

/** Where an app's id is found, and how one is held: what a call that names no app, with none selected, is to do. */
export const NO_APP_HINT =
  'app action list names the installed apps by id; use_device with app selects one for the calls after';

export const noApp = () =>
  new ToolError('give app (or select one with use_device)', 'INVALID_ARGUMENT', NO_APP_HINT);

export function checkApp(policy: Policy, pkg: string): string {
  if (policy.apps.length > 0 && !policy.apps.includes(pkg))
    throw new ToolError(
      `${pkg} is not an allowed app (${policy.apps.join(', ')})`,
      'POLICY_DENIED',
      byPerson('by --allow-apps'),
    );
  return pkg;
}

export function checkDevice(policy: Policy, serial: string): string {
  if (policy.devices && !policy.devices.test(serial))
    throw new ToolError(
      `${serial} is not allowed on this server`,
      'POLICY_DENIED',
      byPerson('by --allow-devices'),
    );
  return serial;
}

/**
 * A new simulator's id is not known before it is made, so no allow list names it: none is made only to be refused, by
 * `simulator create` or the hub's New Simulator alike.
 */
export function checkCreate(policy: Policy) {
  if (policy.devices)
    throw new ToolError(
      'create is off while this server has a device allow list',
      'POLICY_DENIED',
      byPerson('by starting it without --allow-devices'),
    );
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
