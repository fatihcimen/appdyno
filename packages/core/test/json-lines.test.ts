import { describe, expect, it } from 'vitest';
import { jsonLines } from '../src/index.js';

const reader = () => {
  const heard: unknown[] = [];
  return { heard, feed: jsonLines((m) => heard.push(m)) };
};

describe('a helper’s lines', () => {
  it('takes each whole line, however the chunks fall', () => {
    const { heard, feed } = reader();
    feed(Buffer.from('{"a":1}\n{"b"'));
    expect(heard).toEqual([{ a: 1 }]);
    feed(Buffer.from(':2}\n{"c":3}\n'));
    expect(heard).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('is not broken by a chunk that ends inside a character', () => {
    const { heard, feed } = reader();
    const line = Buffer.from('{"word":"ş"}\n');
    const middle = line.indexOf(0xc5) + 1;
    feed(line.subarray(0, middle));
    feed(line.subarray(middle));
    expect(heard).toEqual([{ word: 'ş' }]);
  });

  it('passes over what is no JSON, and goes on', () => {
    const { heard, feed } = reader();
    feed(Buffer.from('a framework says hello\n{"a":1}\n'));
    expect(heard).toEqual([{ a: 1 }]);
  });
});
