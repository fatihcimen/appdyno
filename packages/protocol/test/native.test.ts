import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/errors.js';
import { NODE_FLAGS, PROTOCOL } from '../src/messages.js';

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

  it('all speak one version', () => {
    expect(read(`${AGENT}/Errors.kt`)).toContain(`PROTOCOL_MAJOR = ${PROTOCOL.major}\n`);
    expect(read(`${CORE}/Errors.swift`)).toContain(`protocolMajor = ${PROTOCOL.major}\n`);
    expect(read('mirror/Viewer/SourceStream.m')).toContain(`@"protocol": @${PROTOCOL.major}}`);
  });
});
