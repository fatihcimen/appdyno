import { DeviceError } from '@appdyno/protocol';
import { greeted, within, type DtxClient } from './dtx.js';
import type { IpStack, TcpConnection } from './ipstack.js';
import { isDict, type Archived } from './keyed-archive.js';
import type { ServiceList } from './services.js';
import { checkIn } from './shim.js';

const SERVICE = 'com.apple.accessibility.axAuditDaemon.remoteserver.shim.remote';
const ACTIVATE = 'AXAction-2010';
/** A screen longer than this is walked no further. */
const MOST_ELEMENTS = 300;
const SHOWN = 20;

type Dict = Record<string, Archived>;

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

const attribute = (name: string) =>
  typed('AXAuditElementAttribute_v1', {
    AttributeNameValue_v1: name,
    DisplayAsTree_v1: false,
    DisplayInlineValue_v1: false,
    IsInternal_v1: false,
    PerformsActionValue_v1: false,
    SettableValue_v1: false,
    ValueTypeValue_v1: 1,
  });

const fieldsOf = (v: Archived | undefined): Dict => {
  const outer = isDict(v) ? v.Value : undefined;
  const inner = isDict(outer) ? outer.Value : undefined;
  return isDict(inner) ? inner : {};
};
const valueOf = (v: Archived | undefined) => (isDict(v) ? v.Value : undefined);

const idOf = (token: Archived | undefined) =>
  JSON.stringify(valueOf(fieldsOf(token).PlatformElementValue_v1));

const kidsOf = (node: Archived | undefined): Archived[] => {
  const kids = valueOf(fieldsOf(node).ChildrenValue_v1);
  return Array.isArray(kids) ? kids : [];
};

/**
 * What the service says of an element is its way down from the app, with its own children: those are found by its token,
 * as the way down holds its parent's other children too.
 */
export function childrenIn(tree: Archived | undefined, token: Archived): Archived[] {
  const id = idOf(token);
  if (idOf(fieldsOf(tree).AuditElementValue_v1) === id) return kidsOf(tree);
  for (const kid of kidsOf(tree)) {
    const inner = childrenIn(kid, token);
    if (inner.length) return inner;
  }
  return [];
}

/** A node with no children, as a list shows it: what stands for a view with nothing to say is left out. */
export function leafOf(node: Archived, label: Archived | undefined): AuditElement | undefined {
  const fields = fieldsOf(node);
  const token = fields.AuditElementValue_v1;
  if (!token || valueOf(fields.IsIgnoredValue_v1) === true) return undefined;
  const words = valueOf(label) ?? valueOf(fields.HumanReadableDescriptionValue_v1);
  if (typeof words !== 'string' || !words.trim() || words.startsWith('<')) return undefined;
  const identifier = valueOf(fieldsOf(token).AccessibilityIdentifier_v1);
  return { caption: words, token, ...(typeof identifier === 'string' && { identifier }) };
}

/** Traits as read on iOS 27.2: being typed in, and secure, seen on a password field against the others beside it. */
const EDITING = 0x200000;
const SECURE = 0x1000000;
const hasBit = (traits: number, bit: number) => Math.floor(traits / bit) % 2 === 1;
export const isEditing = (traits: number) => hasBit(traits, EDITING);
export const isSecure = (traits: number) => hasBit(traits, SECURE);

/** What a name means on a screen: an id first, then the words, whole or up to the first comma, as `Form` of `Form, Button`. */
export function elementNamed(list: AuditElement[], name: string): AuditElement {
  const byId = list.filter((e) => e.identifier === name);
  const hits = byId.length
    ? byId
    : list.filter((e) => e.caption === name || e.caption.split(', ')[0] === name);
  const [hit] = hits;
  if (hit && hits.length === 1) return hit;
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

  /**
   * What the screen holds, by going down the app's tree a node at a time. Moving the inspector along a screen would be
   * quicker, and scrolls what it reads: reading must leave the screen as it was.
   */
  elements() {
    return this.inspecting(() => this.walk());
  }

  /** The field being typed in, by its traits: reads the whole screen, so only when it matters. */
  private editing() {
    return this.inspecting(async () => {
      let editing: { traits: number; name: string } | undefined;
      await this.walk(async (element) => {
        const traits = valueOf(await this.read(element.token, 'Traits'));
        if (typeof traits !== 'number' || !isEditing(traits)) return false;
        editing = { traits, name: element.identifier ?? element.caption };
        return true;
      });
      return editing;
    });
  }

  async secureFocused() {
    const field = await this.editing();
    return field !== undefined && isSecure(field.traits);
  }

  async focusedField() {
    return (await this.editing())?.name;
  }

  /** The service answers of an element only with its inspector on. */
  private async inspecting<T>(work: () => Promise<T>) {
    await this.dtx.call('deviceInspectorShowVisuals:', false);
    await this.dtx.call('deviceInspectorEnable:', true);
    try {
      return await work();
    } finally {
      await this.dtx.call('deviceInspectorEnable:', false);
    }
  }

  /** Down the tree, each element once; `stop` ends it at the element it was looking for. */
  private async walk(stop?: (element: AuditElement) => Promise<boolean>) {
    const start = await this.dtx.call('deviceFetchSpecialElement:', 0);
    const found: AuditElement[] = [];
    const seen = new Set<string>();
    let done = false;
    const visit = async (node: Archived) => {
      const token = fieldsOf(node).AuditElementValue_v1;
      if (done || !token || seen.has(idOf(token)) || found.length >= MOST_ELEMENTS) return;
      seen.add(idOf(token));
      const kids = childrenIn(await this.tree(token), token);
      if (kids.length) {
        for (const kid of kids) await visit(kid);
        return;
      }
      const leaf = leafOf(node, await this.read(token, 'Label'));
      if (!leaf) return;
      found.push(leaf);
      done = (await stop?.(leaf)) ?? false;
    };
    await visit(await this.tree(start));
    return found;
  }

  private read(element: Archived, name: string) {
    return this.dtx.call('deviceElement:valueForAttribute:', element, attribute(name));
  }

  private tree(element: Archived) {
    return this.read(element, '_AXHierarchyElementsAttribute');
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
