import type { NetworkEntry } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { compactList } from '../src/network-list.js';

const get = (id: number, url: string, more: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id,
  method: 'GET',
  url,
  status: 200,
  ms: 100 + id,
  bytes: 10,
  ...more,
});

describe('a list of requests as few lines as tell them apart', () => {
  it('has failures first and whole, each host once, repeats folded, a query by its names, pictures counted', () => {
    const entries = [
      get(0, 'https://api.test/v1/items?page=1&limit=20'),
      get(1, 'https://api.test/v1/items?page=2&limit=20'),
      get(2, 'https://cdn.test/a/1.png'),
      get(3, 'https://api.test/v1/items?page=3&limit=20', { status: 304, ms: 9 }),
      get(4, 'https://api.test/v1/cart', { method: 'POST', status: 422 }),
      get(5, 'https://img.test/b/2.JPG?w=200'),
      get(6, 'https://api.test/v1/me', { how: 'mocked' }),
      get(7, 'https://other.test/ping', { status: 0, error: 'timed out' }),
    ];
    const lines = compactList(
      entries,
      (e) => `${String(e.id)} ${String(e.url)}`,
      (e) => (e.how ? ` [${e.how}]` : ''),
    );
    expect(lines.map((l) => l.text)).toEqual([
      '! 4 https://api.test/v1/cart',
      '! 7 https://other.test/ping',
      'api.test:',
      '  GET /v1/items?page&limit ×3 200/304 median 100 ms (ids 0 to 3)',
      '  6 GET /v1/me 200 106 ms 10 B [mocked]',
      'images: 2 from cdn.test, img.test',
    ]);
    // every request is in one line, and no other
    expect(lines.reduce((n, l) => n + l.requests, 0)).toBe(entries.length);
  });

  it('counts the failures past the most it lists, and takes an address that is none as it is', () => {
    const many = Array.from({ length: 23 }, (_, i) =>
      get(i, `https://a.test/${i}`, { status: 500 }),
    );
    const lines = compactList([...many, get(23, 'not a link')], (e) => String(e.id));
    expect(lines[0]).toEqual({
      text: '! 3 more failed before these: status failed, 4xx or 5xx lists them',
      requests: 3,
    });
    expect(lines[1]?.text).toBe('! 3');
    expect(lines.slice(21).map((l) => l.text)).toEqual([
      ':',
      '  23 GET not a link 200 123 ms 10 B',
    ]);
  });
});
