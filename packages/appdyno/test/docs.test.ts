import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ALPHA, FLOOR, MIN_BASELINE_RUNS, MIN_SAMPLES, RUN_SDS } from '@appdyno/perf';
import { SETTLE } from '@appdyno/ops';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter((f) => f && existsSync(join(root, f)));
// a changelog is what was true then
const pages = tracked.filter((f) => f.endsWith('.md') && f !== 'CHANGELOG.md');

/** A heading's anchor, as GitHub makes it. */
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\- ]/gu, '')
    .replace(/ /g, '-');

const anchorsOf = (text: string) =>
  [...text.replace(/```[^]*?```/g, '').matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1]!));

/** Where a page leads: each link and image, leaving out what code shows. */
const linksOf = (text: string) =>
  [
    ...text
      .replace(/```[^]*?```/g, '')
      .replace(/`[^`\n]*`/g, '')
      .matchAll(/\]\(([^)\s]+)\)|<img[^>]* src="([^"]+)"/g),
  ].map((m) => (m[1] ?? m[2])!);

describe('the docs', () => {
  it('lead only to what is there', () => {
    expect(pages.length).toBeGreaterThan(8);
    const broken = pages.flatMap((page) =>
      linksOf(read(page))
        .filter((link) => !/^[a-z]+:/.test(link))
        .flatMap((link) => {
          const [path, anchor] = link.split('#') as [string, string | undefined];
          const file = path ? relative(root, resolve(root, dirname(page), path)) : page;
          if (!existsSync(join(root, file))) return [`${page}: ${link}`];
          if (!anchor || !file.endsWith('.md')) return [];
          return anchorsOf(read(file)).includes(anchor) ? [] : [`${page}: ${link}`];
        }),
    );
    expect(broken).toEqual([]);
  });

  it('are in the index', () => {
    const index = read('docs/README.md');
    const listed = pages.filter((p) => p.startsWith('docs/') && p !== 'docs/README.md');
    expect(listed.filter((p) => !index.includes(`](${p.replace('docs/', '')}`))).toEqual([]);
  });

  it('are the docs a comment or a script names', () => {
    const named = tracked
      .filter((f) => /\.(ts|mjs|sh|kt|swift|m|h|yml)$/.test(f))
      .flatMap((f) =>
        [...read(f).matchAll(/\bdocs\/[\w/.-]+\.(?:md|yml)\b/g)].map((m) => [f, m[0]] as const),
      );
    expect(named.length).toBeGreaterThan(5);
    expect(named.filter(([, doc]) => !existsSync(join(root, doc)))).toEqual([]);
  });
});

const IMAGES = 'docs/images';
const diagrams = readdirSync(join(root, IMAGES)).filter(
  (f) => f.endsWith('.svg') && f !== 'logo.svg',
);
const drawn = (name: string) => read(`${IMAGES}/${name}.svg`).replace(/\s+/g, ' ');
const styleOf = (text: string) => /<style>[^]*<\/defs>/.exec(text)?.[0];

describe('a diagram', () => {
  it('is one of the set, in one look', () => {
    expect(diagrams.sort()).toEqual([
      'overview.svg',
      'package-map.svg',
      'perf-gate.svg',
      'tool-call.svg',
      'touch-and-frame.svg',
    ]);
    const look = styleOf(read(`${IMAGES}/overview.svg`));
    for (const f of diagrams) expect(styleOf(read(`${IMAGES}/${f}`)), f).toBe(look);
  });

  it('renders on GitHub in both themes, with no font of ours', () => {
    const look = styleOf(read(`${IMAGES}/overview.svg`))!;
    expect(look).toContain('prefers-color-scheme: dark');
    expect(look).toContain('sans-serif');
    expect(look).toContain('monospace');
    for (const f of diagrams) {
      const text = read(`${IMAGES}/${f}`);
      expect(text, f).toMatch(/<title id="title">[^<]+<\/title>\s*<desc id="desc">[^<]+<\/desc>/);
      expect(text, f).toContain('aria-labelledby="title desc"');
      expect(text, f).not.toMatch(
        /foreignObject|<image|<script|@font-face|href=|https?:\/\/(?!www\.w3)/,
      );
      // what is drawn takes its colours from the look alone
      expect(text.replace(styleOf(text)!, ''), f).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });

  it('keeps its lines on its canvas', () => {
    for (const f of diagrams) {
      const text = read(`${IMAGES}/${f}`);
      const [, width, height] = /viewBox="0 0 (\d+) (\d+)"/.exec(text)!.map(Number) as number[];
      const off = [...text.matchAll(/class="line[^"]*"[^>]* d="([^"]+)"/g)].filter(([, d]) =>
        [...d!.matchAll(/([MHV])(\d+)(?: (\d+))?/g)].some(([, op, a, b]) => {
          const [x, y] = op === 'V' ? [0, Number(a)] : [Number(a), Number(b ?? 0)];
          return x > width! || y > height!;
        }),
      );
      expect(off, f).toEqual([]);
    }
  });

  it('names only paths that are there', () => {
    const paths = diagrams.flatMap((f) =>
      [...read(`${IMAGES}/${f}`).matchAll(/class="code[^>]*>([\w./-]+\/[\w./-]+)</g)].map(
        (m) => m[1]!,
      ),
    );
    expect(paths.length).toBeGreaterThan(2);
    expect(paths.filter((p) => !existsSync(join(root, p)))).toEqual([]);
  });

  it('says of the gate what the gate does', () => {
    const gate = drawn('perf-gate');
    const { percent, absolute } = FLOOR.ms;
    for (const said of [
      `${percent} %, ${absolute} ms, and ${RUN_SDS} standard`,
      `${MIN_BASELINE_RUNS} baseline runs, and ${MIN_SAMPLES} samples`,
      `p &lt; ${ALPHA}`,
    ])
      expect(gate).toContain(said);
  });

  it('says of a settle what the settle does', () => {
    const call = drawn('tool-call');
    expect(call).toContain(`still for ${SETTLE.quietMs} ms,`);
    expect(call).toContain(`at most ${SETTLE.maxMs / 1000} s`);
  });
});
