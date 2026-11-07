import { DtxInt, greeted, type DtxClient } from './dtx.js';
import type { IpStack, TcpConnection } from './ipstack.js';
import { isDict, type Archived } from './keyed-archive.js';
import type { ServiceList } from './services.js';

const HUB = 'com.apple.instruments.dtservicehub';
const INDUCER = 'com.apple.instruments.server.services.ConditionInducer';
const CHANNEL = 1;
const CAPABILITIES = {
  'com.apple.private.DTXBlockCompression': 0,
  'com.apple.private.DTXConnection': 1,
};

/** One of the phone's conditions, as Xcode's Devices window offers them: slow network, thermal state. */
export type Condition = { id: string; profiles: string[]; on?: string };

const text = (v: Archived | undefined) => (typeof v === 'string' ? v : undefined);

/** The phone's answer to `availableConditionInducers`, by identifiers. */
export function conditionsOf(answer: Archived): Condition[] {
  const list = Array.isArray(answer) ? answer : [];
  return list.flatMap((c) => {
    const id = isDict(c) ? text(c.identifier) : undefined;
    if (!isDict(c) || !id) return [];
    const profiles = (Array.isArray(c.profiles) ? c.profiles : []).flatMap(
      (p) => (isDict(p) && text(p.identifier)) || [],
    );
    const on = c.isActive === true ? text(c.activeProfile) : undefined;
    return [{ id, profiles, ...(on && { on }) }];
  });
}

/** The phone's condition service on the instruments hub: one condition at a time. */
export class ConditionInducer {
  private constructor(
    private readonly connection: TcpConnection,
    private readonly dtx: DtxClient,
  ) {}

  static async open(stack: IpStack, services: ServiceList) {
    const port = services.ports[HUB];
    if (!port) throw new Error("the phone's developer disk image is not mounted");
    const connection = await stack.connect(port);
    const dtx = await greeted(connection, undefined, CAPABILITIES);
    await dtx.call('_requestChannelWithCode:identifier:', new DtxInt(CHANNEL), INDUCER);
    return new ConditionInducer(connection, dtx);
  }

  async list() {
    return conditionsOf(await this.dtx.callOn(CHANNEL, 'availableConditionInducers'));
  }

  async enable(condition: string, profile: string) {
    await this.dtx.callOn(
      CHANNEL,
      'enableConditionWithIdentifier:profileIdentifier:',
      condition,
      profile,
    );
  }

  async disable() {
    await this.dtx.callOn(CHANNEL, 'disableActiveCondition');
  }

  close() {
    this.connection.close();
  }
}
