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
  'device_setting keychain': () => [
    'Empty the keychain',
    'Every item apps keep in it is lost for good',
  ],
} satisfies Record<string, (app: string, also?: string) => [string, string]>;

export type DataLoss = keyof typeof DATA_LOSS;

const ALLOW =
  "a person allows it in this server's own command line: --allow-data-loss virtual for simulators and emulators, all for every device (APPDYNO_ALLOW_DATA_LOSS); on the command line, --yes";

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
      ALLOW,
    );
  // a prompt closed, or one that never came back, is no yes
  if (!(await ask(`${doing} on ${device}? ${lost}.`).catch(() => false)))
    throw new ToolError(
      `the person declined ${action} on ${device}: nothing was done`,
      'PERMISSION_REQUIRED',
      'ask again only if the person asks for it',
    );
}
