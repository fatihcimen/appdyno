import { describe, expect, it } from 'vitest';
import { SERVER } from '../src/clients.js';
import { jsonEdit } from '../src/jsonc.js';

const edit = jsonEdit(false);
const KEY = 's';
const ENTRY = { command: 'npx', args: ['-y', 'a [ b'] };

/** The same files each run: a failure here is one to read, and any seed goes. */
function generator(seed: number) {
  let s = seed;
  const next = (n: number) => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s % n;
  };
  let comments = 0;
  const gap = () =>
    Array.from({ length: next(4) }, () => {
      const c = `c${++comments}`;
      return [' ', '\n', '\n  ', '\t', `// ${c}\n`, ` /* ${c} */ `, `/* ${c}\n   more */`][
        next(7)
      ]!;
    }).join('');
  const object = (members: string[]) =>
    `{${gap()}${members
      .map((m, i) =>
        i < members.length - 1 ? `${m},${gap()}` : `${m}${next(3) ? '' : ','}${gap()}`,
      )
      .join('')}}`;
  const value = () =>
    ['1', '"x"', 'null', '[1, 2]', '{ "n": 1 }', '"a // b"', '"/* c */"', '"}"'][next(8)]!;
  const member = (name: string) => `"${name}"${gap()}:${gap()}${value()}${gap()}`;
  const list = () => {
    const members = Array.from({ length: next(4) }, (_, i) => member(`m${i}`));
    if (next(2)) members.splice(next(members.length + 1), 0, `"${SERVER}": { "command": "old" }`);
    return object(members);
  };
  return () => {
    const members = Array.from({ length: next(3) }, (_, i) => member(`t${i}`));
    if (next(5)) members.splice(next(members.length + 1), 0, `"${KEY}"${gap()}:${gap()}${list()}`);
    return `${gap()}${object(members)}${gap()}`;
  };
}

const commentsOf = (text: string) => text.match(/\/\/ c\d+|\/\* c\d+/g) ?? [];

describe('a generated JSON file with comments anywhere', () => {
  it('reads back after an edit as asked, with all else in it and every comment kept', () => {
    const file = generator(20_261_106);
    for (let i = 0; i < 3_000; i++) {
      const text = file();
      const others = edit.others(text, KEY, SERVER);
      const had = edit.read(text, KEY, SERVER);
      const written = edit.write(text, KEY, SERVER, ENTRY);
      expect(edit.read(written, KEY, SERVER), text).toEqual(ENTRY);
      expect(edit.others(written, KEY, SERVER), text).toEqual(others);
      if (had === undefined) expect(commentsOf(written), text).toEqual(commentsOf(text));
      const removed = edit.remove(written, KEY, SERVER);
      expect(edit.read(removed, KEY, SERVER), text).toBeUndefined();
      expect(edit.others(removed, KEY, SERVER), text).toEqual(others);
    }
  });
});
