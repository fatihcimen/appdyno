import { describe, expect, it } from 'vitest';
import { must } from '@appdyno/core';
import {
  actionOf,
  childrenIn,
  elementNamed,
  isEditing,
  isSecure,
  leafOf,
  plain,
  typed,
} from '../audit.js';
import { dtxFrame, DtxClient, DtxInt, DtxReader } from '../dtx.js';
import { archive, unarchive, type Archived } from '../keyed-archive.js';
import { plistUid, writeBplist, type Plist } from '../../webinspector.js';

describe('a keyed archive', () => {
  it('keeps what it carries', () => {
    const value = {
      name: 'Form',
      turkish: 'Düğme',
      count: 8589935168,
      on: false,
      token: Buffer.from([1, 2, 3]),
      list: [1, 'two', { three: 3 }],
      none: null,
    };
    expect(unarchive(archive(value))).toEqual(value);
    expect(unarchive(archive('deviceCapabilities'))).toBe('deviceCapabilities');
  });

  it('refuses what is not one', () => {
    expect(() => unarchive(Buffer.from('bplist00'))).toThrow();
  });

  const archived = (objects: Plist[]) =>
    writeBplist({ $top: { root: plistUid(1) }, $objects: objects });

  it('refuses one that holds itself', () => {
    expect(() => unarchive(archived(['$null', { 'NS.objects': [plistUid(1)] }]))).toThrow();
  });

  it('does not unfold a small one for ever: each of 40 lists holds the next one twice', () => {
    const lists = Array.from({ length: 40 }, (_, i) => ({
      'NS.objects': [plistUid(i + 2), plistUid(i + 2)],
    }));
    expect(() => unarchive(archived(['$null', ...lists, 'the end']))).toThrow(/more than/);
  });
});

describe('DTX frames', () => {
  const answer = (id: number, value: string) => {
    const frame = dtxFrame(id, value, [], false);
    frame.writeUInt32LE(1, 20);
    return frame;
  };

  it('reads a call back, with its arguments, however it is cut', () => {
    const frame = dtxFrame(7, 'deviceElement:', [plain(true), 'x'], true);
    const reader = new DtxReader();
    expect(reader.push(frame.subarray(0, 10))).toEqual([]);
    expect(reader.push(frame.subarray(10, 40))).toEqual([]);
    const [m] = reader.push(frame.subarray(40));
    expect(m).toEqual({
      id: 7,
      channel: 0,
      reply: false,
      selector: 'deviceElement:',
      args: [plain(true), 'x'],
    });
  });

  it('refuses a length no message has, and waits for nothing more', () => {
    const frame = dtxFrame(7, 'x', [], true);
    frame.writeUInt32LE(0xffffffff, 12);
    expect(() => new DtxReader().push(frame)).toThrow('too long');
  });

  it('sends a plain number as one, and on the channel asked for', () => {
    const [m] = new DtxReader().push(dtxFrame(2, 'on', [new DtxInt(5), 'name'], true, 3));
    expect(m?.channel).toBe(3);
    // the reader takes archives only, and stops at the number: what comes back here is from the phone
    expect(m?.args).toEqual([]);
    expect(dtxFrame(2, 'on', [new DtxInt(5)], true).readUInt32LE(32 + 16 + 16 + 4)).toBe(3);
  });

  it('joins a message sent in pieces', () => {
    const whole = dtxFrame(3, 'long', ['x'.repeat(200)], false);
    const body = whole.subarray(32);
    const head = (piece: number, size: number) => {
      const h = Buffer.from(whole.subarray(0, 32));
      h.writeUInt16LE(piece, 8);
      h.writeUInt16LE(3, 10);
      h.writeUInt32LE(size, 12);
      return h;
    };
    const cut = 100;
    const [m] = new DtxReader().push(
      Buffer.concat([
        head(0, body.length),
        head(1, cut),
        body.subarray(0, cut),
        head(2, body.length - cut),
        body.subarray(cut),
      ]),
    );
    expect(m?.selector).toBe('long');
    expect(m?.args).toEqual(['x'.repeat(200)]);
  });

  it('refuses a stream that is not DTX', () => {
    expect(() => new DtxReader().push(Buffer.alloc(40))).toThrow('not a DTX frame');
  });

  it('gives an answer to its call and the rest to whoever listens', async () => {
    const sent: Buffer[] = [];
    let incoming: (d: Buffer) => void = () => undefined;
    const client = new DtxClient({
      write: (b) => sent.push(b),
      onData: (f) => {
        incoming = f;
      },
    });
    const told: unknown[] = [];
    client.onPush = (m) => told.push(m.selector);
    const asked = client.call('deviceApiVersion');
    incoming(dtxFrame(90, 'hostApiVersion', [], true));
    incoming(answer(must(sent[0], 'a frame').readUInt32LE(16), 'its answer'));
    await expect(asked).resolves.toBe('its answer');
    expect(told).toEqual(['hostApiVersion']);
  });
});

describe('what goes to the phone audit service', () => {
  // as Xcode's own framework writes these: any other form aborts the service on the phone
  it('names an action in the form the service takes', () => {
    expect(actionOf('AXAction-2010')).toEqual({
      ObjectType: 'AXAuditElementAttribute_v1',
      Value: {
        ObjectType: 'passthrough',
        Value: {
          AttributeNameValue_v1: { ObjectType: 'passthrough', Value: 'AXAction-2010' },
          DisplayAsTree_v1: { ObjectType: 'passthrough', Value: false },
          DisplayInlineValue_v1: { ObjectType: 'passthrough', Value: false },
          IsInternal_v1: { ObjectType: 'passthrough', Value: false },
          PerformsActionValue_v1: { ObjectType: 'passthrough', Value: true },
          SettableValue_v1: { ObjectType: 'passthrough', Value: false },
          ValueTypeValue_v1: { ObjectType: 'passthrough', Value: 1 },
        },
      },
    });
  });

  const token = (n: number, id?: string) =>
    typed('AXAuditElement_v1', {
      PlatformElementValue_v1: Buffer.from([n]),
      ...(id && { AccessibilityIdentifier_v1: id }),
    });
  const node = (element: Archived, words: string, kids: Archived[] = []): Archived => ({
    ObjectType: 'AXAuditNode_v1',
    Value: plain({
      AuditElementValue_v1: element,
      HumanReadableDescriptionValue_v1: plain(words),
      IsIgnoredValue_v1: plain(false),
      ...(kids.length && { ChildrenValue_v1: plain(kids) }),
    }),
  });

  it('finds an element children in its way down, past its parent others', () => {
    const [app, list, row, other] = [token(1), token(2), token(3), token(4)];
    const tree = node(app, 'app', [
      node(other, '<Other>'),
      node(list, '<List>', [node(row, 'Row')]),
    ]);
    expect(childrenIn(tree, list)).toEqual([node(row, 'Row')]);
    expect(childrenIn(tree, other)).toEqual([]);
    expect(childrenIn(undefined, list)).toEqual([]);
  });

  it('keeps an element with words and its id, and no bare view', () => {
    const element = token(5, 'open_form');
    expect(leafOf(node(element, 'Form Button'), plain('Form'))).toEqual({
      caption: 'Form',
      identifier: 'open_form',
      token: element,
    });
    expect(leafOf(node(element, 'Title'), undefined)?.caption).toBe('Title');
    expect(leafOf(node(element, '<UIWindow>'), undefined)).toBeUndefined();
    expect(leafOf(node(element, '  '), undefined)).toBeUndefined();
  });

  it('tells a secure field being typed in, by its traits as a phone gave them', () => {
    expect(isEditing(0x2201240000) && isSecure(0x2201240000)).toBe(true);
    expect(isEditing(0x2201040000)).toBe(false);
    expect(isEditing(0x2200240000) && isSecure(0x2200240000)).toBe(false);
  });

  it('finds a name by id first, then by its words, and never guesses', () => {
    const list = [
      { caption: 'Form, Button', identifier: 'open_form', token: 1 },
      { caption: 'List, Button', token: 2 },
      { caption: 'Save, Button', token: 3 },
      { caption: 'Save', token: 4 },
    ];
    expect(elementNamed(list, 'open_form').token).toBe(1);
    expect(elementNamed(list, 'Form').token).toBe(1);
    expect(elementNamed(list, 'List, Button').token).toBe(2);
    expect(() => elementNamed(list, 'Save')).toThrow(/2 elements are named Save/);
    expect(() => elementNamed(list, 'Gone')).toThrow(/it shows: Form, Button/);
  });
});
