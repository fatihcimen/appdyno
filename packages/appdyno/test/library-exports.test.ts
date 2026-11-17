import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

describe("the library's entry point", () => {
  it('exports every type its connect and its answers are written in', () => {
    const declared = [...source('library.ts').matchAll(/^export (?:type|function) (\w+)/gm)].map(
      (m) => m[1],
    );
    const exported = source('index.ts');
    expect(declared.length).toBeGreaterThan(10);
    expect(declared.filter((name) => !new RegExp(`\\b${String(name)}\\b`).test(exported))).toEqual(
      [],
    );
  });
});
