import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ERROR_CODES } from '../src/errors.js';
import {
  FRAME_BINARY,
  FRAME_JSON,
  FRAME_VIDEO,
  MAX_FRAME_BYTES,
  VIDEO_HEADER_BYTES,
} from '../src/frame.js';
import { keyOfUsage, KEYS } from '../src/keys.js';
import {
  METHODS,
  NODE_FLAGS,
  NOTIFICATIONS,
  PROTOCOL,
  type Notification,
} from '../src/messages.js';

const read = (path: string) => readFileSync(join(import.meta.dirname, '../../..', path), 'utf8');

const AGENT = 'android/agent/src/main/kotlin/dev/appdyno/agent';
const CORE = 'ios/RunnerCore/Sources/RunnerCore';

/** The codes an agent may send: the host's own come after these. */
const WIRE_CODES = ERROR_CODES.slice(0, ERROR_CODES.indexOf('INTERNAL') + 1);

const inside = (text: string, open: RegExp, close: string) => {
  const m = open.exec(text);
  if (!m) throw new Error(`no ${open.source}`);
  const start = m.index + m[0].length;
  return text.slice(start, text.indexOf(close, start));
};

/** What a constant of a native file comes to, written as a number or as a product. */
const valueOf = (text: string, name: string) => {
  const m = new RegExp(`\\b${name} = ([\\d *]+)`).exec(text);
  if (!m) throw new Error(`no ${name}`);
  return m[1]!.split('*').reduce((all, n) => all * Number(n), 1);
};

const quoted = (text: string) => [...text.matchAll(/"(\w+)"/g)].map((m) => m[1]);

describe('what is written three times', () => {
  it('the Android agent has the wire error codes in their order', () => {
    expect(quoted(inside(read(`${AGENT}/Errors.kt`), /ERROR_CODES = listOf\(/, ')'))).toEqual(
      WIRE_CODES,
    );
  });

  it('the iOS runner has the wire error codes in their order', () => {
    expect(quoted(inside(read(`${CORE}/Errors.swift`), /errorCodes = \[/, ']'))).toEqual(
      WIRE_CODES,
    );
  });

  it('the Android agent numbers every node flag as the host does', () => {
    const block = inside(read(`${AGENT}/LayoutHash.kt`), /object Flags \{/, '}');
    const named = Object.fromEntries(
      [...block.matchAll(/const val (\w+) = (\d+)/g)].map((m) => [
        m[1]!.toLowerCase().replace(/_(\w)/g, (_, c: string) => c.toUpperCase()),
        Number(m[2]),
      ]),
    );
    expect(named).toEqual(NODE_FLAGS);
  });

  it('the iOS runner numbers the node flags it uses as the host does', () => {
    const block = inside(read(`${CORE}/Layout.swift`), /enum Flag \{/, '}');
    const named = [...block.matchAll(/(\w+) = (\d+)/g)];
    expect(named.length).toBeGreaterThan(0);
    for (const [, name, value] of named)
      expect(NODE_FLAGS[name as keyof typeof NODE_FLAGS]).toBe(Number(value));
  });

  it('the Android agent has every key', () => {
    expect(quoted(inside(read(`${AGENT}/Input.kt`), /val KEYS = mapOf\(/, '\n        )'))).toEqual([
      ...KEYS,
    ]);
  });

  it('the iOS runner has every key but those a phone has no way to press', () => {
    const device = read('ios/Runner/DeviceActions.swift');
    const keyboard = quoted(inside(device, /keyboard: \[String: XCUIKeyboardKey\] = \[/, ']'));
    const cases = [...inside(device, /switch k \{/, 'default:').matchAll(/case (.+):/g)].flatMap(
      (m) => quoted(m[1]!),
    );
    expect([...new Set([...keyboard, ...cases])].sort()).toEqual(
      KEYS.filter((k) => k !== 'back' && k !== 'appSwitch').sort(),
    );
  });

  it('the Mac keyboard sends the usage of every key it has', () => {
    const table = inside(
      read('mirror/Viewer/Input.m'),
      /MVUsageOfKeyCode\(uint16_t keyCode\) \{/,
      'default:',
    );
    const usages = [...table.matchAll(/return (0x[0-9a-f]+);/g)].map((m) => Number(m[1]));
    const named = [
      'enter',
      'escape',
      'delete',
      'tab',
      'arrowUp',
      'arrowDown',
      'arrowLeft',
      'arrowRight',
    ];
    expect(named.filter((k) => !usages.some((u) => keyOfUsage(u) === k))).toEqual([]);
  });

  it('the Android agent frames as the host does', () => {
    const frames = read(`${AGENT}/Frames.kt`);
    expect(valueOf(frames, 'FRAME_JSON')).toBe(FRAME_JSON);
    expect(valueOf(frames, 'FRAME_BINARY')).toBe(FRAME_BINARY);
    expect(valueOf(frames, 'FRAME_VIDEO')).toBe(FRAME_VIDEO);
    expect(valueOf(frames, 'VIDEO_HEADER_BYTES')).toBe(VIDEO_HEADER_BYTES);
    expect(valueOf(frames, 'MAX_FRAME_BYTES')).toBe(MAX_FRAME_BYTES);
  });

  it('the iOS runner frames as the host does', () => {
    const frames = read(`${CORE}/Frames.swift`);
    expect(valueOf(frames, 'maxFrameBytes')).toBe(MAX_FRAME_BYTES);
    expect(frames).toContain(`header(payload.count, ${FRAME_JSON})`);
    expect(frames).toContain(`header(data.count + 4, ${FRAME_BINARY})`);
  });

  it('the viewer reads frames as the host writes them', () => {
    const stream = read('mirror/Viewer/SourceStream.m');
    expect(valueOf(stream, 'kFrameJson')).toBe(FRAME_JSON);
    expect(valueOf(stream, 'kFrameVideo')).toBe(FRAME_VIDEO);
    expect(valueOf(stream, 'kVideoHeader')).toBe(VIDEO_HEADER_BYTES);
    expect(valueOf(stream, 'kMaxFrame')).toBe(MAX_FRAME_BYTES);
  });

  it('both agents wait alike after a touch that changed nothing', () => {
    const kotlin = /INERT_QUIET_MS = (\d+)L/.exec(read(`${AGENT}/Settling.kt`));
    const swift = /inertQuietMs = (\d+)/.exec(read(`${CORE}/Settler.swift`));
    expect(kotlin?.[1]).toBeDefined();
    expect(kotlin?.[1]).toBe(swift?.[1]);
  });

  it('the host calls a region cut at an edge by the tile the viewer looks in', () => {
    const tile = /MVTile = (\d+)/.exec(read('mirror/Viewer/Motion.m'));
    const width = /MVWatchWidth = (\d+)/.exec(read('mirror/Viewer/Watch.m'));
    const edge = /const EDGE = ([\d.]+)/.exec(read('packages/ops/src/watch.ts'));
    expect(Number(edge![1])).toBeCloseTo(Number(tile![1]) / Number(width![1]), 2);
  });

  it('all speak one version', () => {
    expect(read(`${AGENT}/Errors.kt`)).toContain(`PROTOCOL_MAJOR = ${PROTOCOL.major}\n`);
    expect(read(`${CORE}/Errors.swift`)).toContain(`protocolMajor = ${PROTOCOL.major}\n`);
    expect(read('mirror/Viewer/SourceStream.m')).toContain(`@"protocol": @${PROTOCOL.major}}`);
  });
});

describe('the stream, which a viewer speaks to the agent with no host between them', () => {
  const VIEWER = 'mirror/Viewer/SourceStream.m';
  const names = (path: string) => [
    ...new Set([...read(path).matchAll(/["'](stream\.\w+)["']/g)].map((m) => m[1]!)),
  ];
  const read$ = (text: string, of: RegExp) => [...text.matchAll(of)].map((m) => m[1]!);
  const fields = (name: Notification) =>
    Object.keys((NOTIFICATIONS[name] as unknown as z.ZodObject).shape);

  // a phone's stream holds its own writer to these, in its own folder, which can go whole
  it.each([VIEWER, `${AGENT}/Stream.kt`, `${AGENT}/Server.kt`])(
    '%s says no name the protocol has not got',
    (path) => {
      const known = [...Object.keys(METHODS), ...Object.keys(NOTIFICATIONS)];
      expect(names(path).length).toBeGreaterThan(0);
      expect(names(path).filter((name) => !known.includes(name))).toEqual([]);
    },
  );

  it('the viewer asks by the names of the table, and hears every notification', () => {
    const asked = read$(read(VIEWER), /sendMethod:@"([\w.]+)"/g);
    expect(asked.filter((m) => !(m in METHODS))).toEqual([]);
    expect(asked).toEqual(expect.arrayContaining(['stream.start', 'stream.clock']));
    const heard = read$(read(VIEWER), /isEqual:@"(stream\.\w+)"/g);
    expect(heard.sort()).toEqual(Object.keys(NOTIFICATIONS).sort());
  });

  it('the viewer reads no field a notification has not got', () => {
    const viewer = read(VIEWER);
    expect(
      read$(viewer, /info\[@"(\w+)"\]/g).filter((f) => !fields('stream.info').includes(f)),
    ).toEqual([]);
    expect(viewer).toContain(`[@"params"][@"${fields('stream.turns')[0]}"]`);
    expect(viewer).toContain(`[@"params"][@"${fields('stream.end')[0]}"]`);
  });

  it('the viewer reads its clock by the field the table has', () => {
    const clock = METHODS['stream.clock'].result as unknown as z.ZodObject;
    expect(read(VIEWER)).toContain(`[@"result"][@"${Object.keys(clock.shape)[0]}"]`);
  });

  it('the Android agent reads the whole of a start, and nothing else', () => {
    const from = inside(
      read(`${AGENT}/Stream.kt`),
      /fun from\(p: JSONObject\) = StreamRequest\(/,
      '\n        )',
    );
    const start = METHODS['stream.start'].params as unknown as z.ZodObject;
    expect(read$(from, /p\.opt\w+\("(\w+)"/g).sort()).toEqual(Object.keys(start.shape).sort());
  });
});
