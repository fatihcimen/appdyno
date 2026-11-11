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
  if (allows(policy.allowDataLoss, s)) return;
  await askPerson(s, action, DATA_LOSS[action](app, also), AHEAD);
}

/** As SECURITY.md has it: no tool does any of this, so a person does it, and a touch that would is asked of them. */
/** How a person lets the power, emergency, erase and call controls be touched with nothing asked. */
export const ALLOW_POWER =
  '--allow-power virtual for simulators and emulators, all for every device (APPDYNO_ALLOW_POWER)';

const POWER_AHEAD = `appdyno does not restart, power off, reset or erase a device, nor place a call or call for help: the person does that on the device; press_key back or home leaves this screen; a person allows it ahead in this server's own command line: ${ALLOW_POWER}`;

/** As `approve`, for an input that would act on the system's own power, emergency or erase controls: `what` names it. */
export async function approvePower(policy: Policy, s: Session, what: string) {
  if (powerAllowed(policy, s)) return;
  await askPerson(
    s,
    what,
    [
      `Let appdyno act on ${what}`,
      'The device may power off, restart, place a call, call for help, or lose all it holds',
    ],
    POWER_AHEAD,
  );
}

const allows = (flag: Policy['allowDataLoss'], s: Session) =>
  flag === 'all' || (flag === 'virtual' && s.device.virtual);

/** The power, emergency and erase controls allowed ahead on this device, by the server's own command line. */
export const powerAllowed = (policy: Policy, s: Session) => allows(policy.allowPower, s);

/** The person's yes to `name`, asked as `doing` on this device and what is `lost`; else a refusal, with nothing done. */
async function askPerson(s: Session, name: string, [doing, lost]: [string, string], ahead: string) {
  // as a person names it, iPhone 17 and not iPhone18,3
  const model = (await s.device.hardware().catch(() => undefined))?.model ?? s.device.hello?.model;
  const device = model ? `${model} (${s.device.serial})` : s.device.serial;
  const ask = callAsk();
  if (!ask)
    throw new ToolError(
      `${name} asks the person first, and this client cannot ask: nothing was done`,
      'PERMISSION_REQUIRED',
      `${ahead}; on the command line, --yes`,
    );
  // a prompt closed, or one that never came back, is no yes: and a client may answer one itself, with no person shown it
  if (!(await ask(`${doing} on ${device}? ${lost}.`).catch(() => false)))
    throw new ToolError(
      `${name} on ${device} was not allowed: its question got no yes, and nothing was done`,
      'PERMISSION_REQUIRED',
      `a client may answer no by itself, with no person shown the question; ${ahead}; ask again only if the person asks for it`,
    );
}
