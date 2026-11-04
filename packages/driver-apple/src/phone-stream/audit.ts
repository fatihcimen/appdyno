import { DeviceError } from '@appdyno/protocol';
import { parsePlist, plistXml } from '../usbmux.js';
import { readBplist } from '../webinspector.js';
import { greeted, within, type DtxClient } from './dtx.js';
import type { IpStack, TcpConnection } from './ipstack.js';
import type { Archived } from './keyed-archive.js';
import type { ServiceList } from './services.js';

const SERVICE = 'com.apple.accessibility.axAuditDaemon.remoteserver.shim.remote';
const ACTIVATE = 'AXAction-2010';
const NEXT = 4;
/** A screen longer than this is walked no further. */
const MOST_ELEMENTS = 300;
const MOVE_MS = 1_000;
const READY_MS = 300;
const SHOWN = 20;

type Dict = { [k: string]: Archived };

/** One element as a walk met it. The token is good for this connection only. */
export type AuditElement = { caption: string; identifier?: string; token: Archived };

/**
 * The service aborts on a call in any other form, which leaves a crash report on the phone: these are the forms Xcode's
 * own inspector sends, and a test holds them.
 */
export const plain = (Value: Archived): Dict => ({ ObjectType: 'passthrough', Value });

export const typed = (ObjectType: string, fields: Dict): Dict => ({
  ObjectType,
  Value: plain(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, plain(v)]))),
});

export const actionOf = (name: string) =>
  typed('AXAuditElementAttribute_v1', {
    AttributeNameValue_v1: name,
    DisplayAsTree_v1: false,
    DisplayInlineValue_v1: false,
    IsInternal_v1: false,
    PerformsActionValue_v1: true,
    SettableValue_v1: false,
    ValueTypeValue_v1: 1,
  });

export const moveOptions = () =>
  plain({
    allowNonAX: plain(false),
    direction: plain(NEXT),
    includeContainers: plain(true),
  });

const isDict = (v: Archived | undefined): v is Dict =>
  !!v && typeof v === 'object' && !Buffer.isBuffer(v) && !Array.isArray(v);
const fieldsOf = (v: Archived | undefined): Dict => {
  const outer = isDict(v) ? v.Value : undefined;
  const inner = isDict(outer) ? outer.Value : undefined;
  return isDict(inner) ? inner : {};
};
const valueOf = (v: Archived | undefined) => (isDict(v) ? v.Value : undefined);

/** What a focus told by the service comes to. */
export function elementOf(focus: Archived | undefined): AuditElement | undefined {
  const fields = fieldsOf(focus);
  const token = fields.ElementValue_v1;
  const caption = valueOf(fields.CaptionTextValue_v1);
  if (!token || typeof caption !== 'string') return undefined;
  const identifier = valueOf(fieldsOf(token).AccessibilityIdentifier_v1);
  return { caption, token, ...(typeof identifier === 'string' && { identifier }) };
}

const idOf = (e: AuditElement) =>
  JSON.stringify(valueOf(fieldsOf(e.token).PlatformElementValue_v1));

/** What a name means on a screen: an id first, then the words, whole or up to the first comma, as `Form` of `Form, Button`. */
export function elementNamed(list: AuditElement[], name: string): AuditElement {
  const byId = list.filter((e) => e.identifier === name);
  const hits = byId.length
    ? byId
    : list.filter((e) => e.caption === name || e.caption.split(', ')[0] === name);
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1)
    throw new DeviceError('AMBIGUOUS', `${hits.length} elements are named ${name}`);
  const shown = list.map((e) => e.caption).slice(0, SHOWN);
  throw new DeviceError(
    'NOT_FOUND',
    `nothing on the screen is named ${name}; it shows: ${shown.join(' | ')}`,
  );
}

/** The phone's accessibility inspector, read and pressed by the same service Xcode's own uses. */
export class Audit {
  private constructor(
    private readonly connection: TcpConnection,
    private readonly dtx: DtxClient,
  ) {}

  static async open(stack: IpStack, services: ServiceList): Promise<Audit> {
    const port = services.ports[SERVICE];
    if (!port) throw new Error('the phone lists no accessibility service');
    const connection = await stack.connect(port);
    const rest = await within(checkIn(connection));
    const dtx = await greeted(connection, rest);
    return new Audit(connection, dtx);
  }

  /** The screen, each element once, in reading order. */
  async elements(): Promise<AuditElement[]> {
    await this.dtx.call('deviceInspectorShowVisuals:', false);
    await this.dtx.call('deviceInspectorEnable:', true);
    await new Promise((r) => setTimeout(r, READY_MS));
    try {
      const seen: AuditElement[] = [];
      while (seen.length < MOST_ELEMENTS) {
        const next = await this.move();
        if (!next || seen.some((e) => idOf(e) === idOf(next))) break;
        seen.push(next);
      }
      return seen;
    } finally {
      await this.dtx.call('deviceInspectorEnable:', false);
    }
  }

  private move() {
    return new Promise<AuditElement | undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), MOVE_MS);
      this.dtx.onPush = (m) => {
        if (m.selector !== 'hostInspectorCurrentElementChanged:') return;
        clearTimeout(timer);
        resolve(elementOf(m.args[0]));
      };
      this.dtx.call('deviceInspectorMoveWithOptions:', moveOptions()).catch(() => undefined);
    });
  }

  /** What a person's activate does, by the element and no place on the screen. */
  async press(element: AuditElement) {
    await this.dtx.call(
      'deviceElement:performAction:withValue:',
      element.token,
      actionOf(ACTIVATE),
      plain(true),
    );
  }

  async close() {
    await this.dtx.call('devicePerformFinalCleanup').catch(() => undefined);
    this.connection.close();
  }
}

/** A service reached over the tunnel is told who calls, in lockdown's framing, and answers twice; what follows is its own. */
async function checkIn(connection: TcpConnection) {
  let held = Buffer.alloc(0);
  const answers: unknown[] = [];
  const twice = new Promise<Buffer>((resolve) => {
    connection.onData((d) => {
      held = Buffer.concat([held, d]);
      while (held.length >= 4 && held.length >= 4 + held.readUInt32BE(0)) {
        const body = held.subarray(4, 4 + held.readUInt32BE(0));
        held = held.subarray(4 + body.length);
        const binary = body.toString('latin1', 0, 6) === 'bplist';
        answers.push(binary ? readBplist(body) : parsePlist(body.toString()));
      }
      if (answers.length >= 2) resolve(held);
    });
  });
  const hello = Buffer.from(
    plistXml({ Label: 'appdyno', ProtocolVersion: '2', Request: 'RSDCheckin' }),
  );
  const size = Buffer.alloc(4);
  size.writeUInt32BE(hello.length);
  connection.write(Buffer.concat([size, hello]));
  return twice;
}
