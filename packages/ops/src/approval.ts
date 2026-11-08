import { callAsk } from '@appdyno/core';
import type { Policy } from './policy.js';
import type { Session } from './session.js';
import { ToolError } from './tool.js';

/**
 * What loses what a person may want, by op and action whatever the platform: what it asks, and what is lost. Each goes
 * ahead only on a person's yes, or by the flag a person put in the server's own command line.
 */
export const DATA_LOSS = {
  'app uninstall': (app: string) => [
    `Uninstall ${app}`,
    'The app and all it keeps there are lost for good',
  ],
  'app clear': (app: string) => [`Clear the data of ${app}`, 'All it keeps there is lost for good'],
  'app replace_data': (app: string) => [
    `Replace the data of ${app} with a folder's`,
    'All it keeps there now is lost for good',
  ],
  'app revoke': (app: string, service = '') => [
    `Revoke ${service} from ${app}`,
    'The permission it was given is lost until it is granted again',
  ],
  'app grant': (app: string, service = '') => [
    `Grant ${service} to ${app}, which here resets it to ask`,
    'The answer the person gave is lost, and the app asks again',
  ],
  'device_setting keychain': () => [
    'Empty the keychain',
    'Every item apps keep in it is lost for good',
  ],
} satisfies Record<string, (app: string, also?: string) => [string, string]>;

export type DataLoss = keyof typeof DATA_LOSS;

/** What loses data only on some devices, and on which: a driver says so of its own. */
const ONLY: Partial<Record<DataLoss, string>> = { 'app grant': 'on an iPhone' };

/** Each, as the server's instructions name them. */
export const DATA_LOSS_WORDS = Object.keys(DATA_LOSS)
  .map((k) => [k, ONLY[k as DataLoss]].filter(Boolean).join(' '))
  .join(', ');

/** How a person allows it ahead, as SECURITY.md has it: in what starts the server, which no tool call reaches. */
const AHEAD =
  "a person allows it ahead in this server's own command line: --allow-data-loss virtual for simulators and emulators, all for every device (APPDYNO_ALLOW_DATA_LOSS)";

/** Returns once the person said yes, or the policy allows it on this device; else refuses, with nothing done. */
export async function approve(policy: Policy, s: Session, action: DataLoss, app = '', also = '') {
  const flag = policy.allowDataLoss;
  if (flag === 'all' || (flag === 'virtual' && s.device.virtual)) return;
  // as a person names it, iPhone 17 and not iPhone18,3
  const model = (await s.device.hardware().catch(() => undefined))?.model ?? s.device.hello?.model;
  const device = model ? `${model} (${s.device.serial})` : s.device.serial;
  const [doing, lost] = DATA_LOSS[action](app, also);
  const ask = callAsk();
  if (!ask)
    throw new ToolError(
      `${action} asks the person first, and this client cannot ask: nothing was done`,
      'PERMISSION_REQUIRED',
      `${AHEAD}; on the command line, --yes`,
    );
  // a prompt closed, or one that never came back, is no yes: and a client may answer one itself, with no person shown it
  if (!(await ask(`${doing} on ${device}? ${lost}.`).catch(() => false)))
    throw new ToolError(
      `${action} on ${device} was not allowed: its question got no yes, and nothing was done`,
      'PERMISSION_REQUIRED',
      `a client may answer no by itself, with no person shown the question; ${AHEAD}; ask again only if the person asks for it`,
    );
}
