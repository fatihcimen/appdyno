import { describe, expect, it } from 'vitest';
import { reportPage } from '../src/report-page.js';

describe("a report's page", () => {
  it('shows pictures and video from its own folder alone, whoever named the others', () => {
    const named = [
      'shots/0001.jpg',
      'video/a.mp4',
      '../x.png',
      'shots/../../x.png',
      '/etc/x.png',
      'file:///etc/x.png',
      'https://example.test/x.png',
      'C:\\x.png',
      '\\\\host\\x.png',
    ];
    const page = reportPage(
      'a report',
      named
        .map((src) => `<img alt="a" src="${src}"><video controls src="${src}"></video>`)
        .join(''),
    );
    const shown = [...page.matchAll(/ src="([^"]*)"/g)].map((m) => m[1]);
    expect(shown).toEqual(['shots/0001.jpg', 'shots/0001.jpg', 'video/a.mp4', 'video/a.mp4']);
  });
});
