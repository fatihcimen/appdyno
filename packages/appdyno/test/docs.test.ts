import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { must } from '@appdyno/core';
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

/** A heading's anchor, as GitHub makes it: an İ keeps its dot, as i and U+0307. */
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{M}\p{N}\- ]/gu, '')
    .replace(/ /g, '-');

/** A page's anchors in order, a heading met again numbered as GitHub numbers it. */
const anchorsOf = (text: string) => {
  const seen = new Map<string, number>();
  return [...text.replace(/```[^]*?```/g, '').matchAll(/^#{1,6} (.+)$/gm)].map((m) => {
    const anchor = slug(must(m[1], 'a heading'));
    const times = seen.get(anchor) ?? 0;
    seen.set(anchor, times + 1);
    return times ? `${anchor}-${times}` : anchor;
  });
};

/** Where a page leads: each link, reference and image, leaving out what code shows. */
const linksOf = (text: string) =>
  [
    ...text
      .replace(/```[^]*?```/g, '')
      .replace(/`[^`\n]*`/g, '')
      .matchAll(
        /\]\(([^)\s]+)\)|<(?:img[^>]* src|source[^>]* srcset)="([^"]+)"|^\[[^\]\n]+\]: (\S+)/gm,
      ),
  ].map((m) => must(m[1] ?? m[2] ?? m[3], 'a link'));

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

  it('are in the index of their language', () => {
    const listed = pages.filter(
      (p) => p.startsWith('docs/') && !/^docs\/README(\.tr)?\.md$/.test(p),
    );
    const indexOf = (p: string) =>
      read(p.endsWith('.tr.md') ? 'docs/README.tr.md' : 'docs/README.md');
    expect(listed.filter((p) => !indexOf(p).includes(`](${p.replace('docs/', '')}`))).toEqual([]);
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

const TR = /\.tr\.md$/;
/** The pages in English alone, and why. */
const ENGLISH_ONLY: Record<string, string> = {
  'CHANGELOG.md': 'not yet in Turkish',
  'CONTRIBUTING.md': 'not yet in Turkish',
};
const english = tracked.filter((f) => f.endsWith('.md') && !f.endsWith('.tr.md'));
const turkishOf = (page: string) => page.replace(/\.md$/, '.tr.md');
const pairs = english
  .filter((page) => tracked.includes(turkishOf(page)))
  .map((page) => [page, turkishOf(page)] as const);

/** The same file in the other language where there is one: X.md and X.tr.md, X.dark.svg and X.tr.dark.svg. */
const otherOf = (file: string) => {
  const other = file.includes('.tr.')
    ? file.replace('.tr.', '.')
    : file.replace(/^(.*\/)?([^./]+)\./, '$1$2.tr.');
  return existsSync(join(root, other)) ? other : file;
};

/** What a line is to Markdown, so that a pair's lines answer one for one. */
const kindOf = (line: string) => {
  const text = line.trimStart();
  const mark = /^(?:#{1,6} |[-*] |\d+\. |> |!\[|<\/?[a-z]+|\[[^\]]+\]: |\|)/.exec(text)?.[0];
  return text ? `${line.length - text.length}${mark?.trim() ?? 'text'}` : '';
};

/** A page as a pair compares it: its lines' kinds, its code with no comments, and its prose. */
const partsOf = (text: string) => {
  const kinds: string[] = [];
  const code: string[] = [];
  const prose: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    const fence = line.trimStart().startsWith('```');
    if (fence) fenced = !fenced;
    kinds.push(fence ? '```' : fenced ? 'code' : kindOf(line));
    if (fence || fenced) code.push(line.replace(/\s*\/\*.*\*\/|(?:^|\s+)(?:#|\/\/) .*$/, ''));
    else prose.push(line);
  }
  return { kinds, code, prose: prose.join('\n') };
};

const spansOf = (prose: string) => (prose.match(/`[^`\n]+`/g) ?? []).sort();

/**
 * The numbers prose and tables say, as digits: Turkish writes 1,800 as 1.800 and 0.1 as 0,1. What a picture shows is
 * left out, as a Turkish picture may be another capture.
 */
const numbersOf = (prose: string) =>
  (
    prose
      .replace(/`[^`\n]+`|!\[[^\]]*\]|\]\([^)]*\)|<[^>]*>|https?:\/\/\S+|^\[[^\]]+\]: .*$/gm, ' ')
      .replace(/^ *\d+\. /gm, '')
      .match(/\d+(?:[.,]\d+)*/g) ?? []
  )
    .map((n) => n.replace(/,/g, '.'))
    .sort();

/** Where a page's links lead, a heading by its place in its page; `across` names what the other language's page would. */
const targetsOf = (page: string, across = false) =>
  linksOf(read(page))
    .map((link) => {
      if (/^[a-z]+:/.test(link)) return link;
      const [path, anchor] = link.split('#') as [string, string | undefined];
      const file = path ? relative(root, resolve(root, dirname(page), path)) : page;
      if (!existsSync(join(root, file))) return link;
      const heading = anchor === undefined ? '' : `#${anchorsOf(read(file)).indexOf(anchor)}`;
      return (across ? otherOf(file) : file) + heading;
    })
    .sort();

describe('a page', () => {
  it('is in English and in Turkish, but for the few named', () => {
    expect(pairs.length).toBeGreaterThan(1);
    expect(english.filter((p) => !tracked.includes(turkishOf(p)) && !(p in ENGLISH_ONLY))).toEqual(
      [],
    );
    expect(
      Object.keys(ENGLISH_ONLY).filter(
        (p) => !english.includes(p) || tracked.includes(turkishOf(p)),
      ),
    ).toEqual([]);
    expect(
      tracked.filter((f) => f.endsWith('.tr.md') && !english.includes(f.replace(TR, '.md'))),
    ).toEqual([]);
  });

  it('leads to its other language at the top', () => {
    const top = (page: string) => must(read(page).split('\n## ')[0], `the top of ${page}`);
    for (const [en, tr] of pairs) {
      expect(top(en), en).toContain(`[Türkçe](${must(tr.split('/').pop(), tr)})`);
      expect(top(tr), tr).toContain(`[English](${must(en.split('/').pop(), en)})`);
    }
  });

  for (const [en, tr] of pairs)
    it(`says in ${tr} what ${en} says`, () => {
      const [a, b] = [partsOf(read(en)), partsOf(read(tr))];
      expect(b.kinds, 'a line for each line').toEqual(a.kinds);
      expect(b.code, 'the same code').toEqual(a.code);
      expect(spansOf(b.prose), 'the same code in the prose').toEqual(spansOf(a.prose));
      expect(numbersOf(b.prose), 'the same numbers').toEqual(numbersOf(a.prose));
      expect(targetsOf(tr), 'the same links, to its own language').toEqual(targetsOf(en, true));
    });
});

const IMAGES = 'docs/images';
const diagrams = readdirSync(join(root, IMAGES)).filter(
  (f) => f.endsWith('.svg') && !f.startsWith('logo.'),
);
const drawn = (name: string) => read(`${IMAGES}/${name}.svg`).replace(/\s+/g, ' ');
const styleOf = (text: string) => /<style>[^]*<\/defs>/.exec(text)?.[0];
/** The look's colours, in one rule: a dark file holds the dark ones. */
const COLOURS = /svg \{[^}]*\}/;
const lightOf = (dark: string) => dark.replace(/\.dark\.svg$/, '.svg');
/**
 * A diagram as a page shows it, made light and made dark for its <picture> to pick by GitHub's theme: a media query in
 * the SVG follows the system's, and draws a dark diagram on a light page.
 */
const PICTURE =
  /<source media="\(prefers-color-scheme: dark\)" srcset="([^"]+)">\s*<img src="([^"]+)"/g;

describe('a diagram', () => {
  it('is one of the set, in English and in Turkish, light and dark, in one look', () => {
    expect(diagrams.sort()).toEqual(
      [
        'approval',
        'devices',
        'one-call',
        'overview',
        'package-map',
        'perf-gate',
        'tool-call',
        'touch-and-frame',
      ].flatMap((name) => [
        `${name}.dark.svg`,
        `${name}.svg`,
        `${name}.tr.dark.svg`,
        `${name}.tr.svg`,
      ]),
    );
    const light = must(styleOf(read(`${IMAGES}/overview.svg`)), 'the light look');
    const dark = must(styleOf(read(`${IMAGES}/overview.dark.svg`)), 'the dark look');
    expect(dark).not.toBe(light);
    expect(dark.replace(COLOURS, '')).toBe(light.replace(COLOURS, ''));
    for (const f of diagrams)
      expect(styleOf(read(`${IMAGES}/${f}`)), f).toBe(f.endsWith('.dark.svg') ? dark : light);
    // a dark file is its light one in the dark colours, and nothing else
    for (const f of diagrams.filter((f) => f.endsWith('.dark.svg')))
      expect(read(`${IMAGES}/${f}`), f).toBe(
        read(`${IMAGES}/${lightOf(f)}`).replace(light, () => dark),
      );
  });

  it("is shown as its pair wherever a page shows it, picked by GitHub's theme", () => {
    const isDiagram = (f: string) => /^docs\/images\/(?!logo\.)[^/]+\.svg$/.test(f);
    const shown: string[] = [];
    for (const page of pages) {
      const at = (f: string) => relative(root, resolve(root, dirname(page), f));
      const pictures = [...read(page).matchAll(PICTURE)].map(
        ([, dark, light]): [string, string] => [
          at(must(dark, 'a dark picture')),
          at(must(light, 'its light one')),
        ],
      );
      expect(
        pictures.filter(([dark, light]) => isDiagram(dark) && light !== lightOf(dark)),
        page,
      ).toEqual([]);
      const pictured = pictures.flat().filter(isDiagram).sort();
      const linked = linksOf(read(page))
        .filter((link) => !/^[a-z]+:/.test(link))
        .map(at)
        .filter(isDiagram)
        .sort();
      expect(linked, page).toEqual(pictured);
      shown.push(...pictured);
    }
    expect(diagrams.filter((f) => !shown.includes(`${IMAGES}/${f}`))).toEqual([]);
  });

  it('renders on GitHub, with no font of ours', () => {
    const look = must(styleOf(read(`${IMAGES}/overview.svg`)), 'the look');
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
      expect(text.replace(must(styleOf(text), f), ''), f).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });

  it('keeps its lines on its canvas', () => {
    for (const f of diagrams) {
      const text = read(`${IMAGES}/${f}`);
      const size = must(/viewBox="0 0 (\d+) (\d+)"/.exec(text), `the size of ${f}`);
      const [width, height] = [Number(size[1]), Number(size[2])];
      const off = [...text.matchAll(/class="line[^"]*"[^>]* d="([^"]+)"/g)].filter(([, d]) =>
        [...must(d, 'a line').matchAll(/([MHV])(\d+)(?: (\d+))?/g)].some(([, op, a, b]) => {
          const [x, y] = op === 'V' ? [0, Number(a)] : [Number(a), Number(b ?? 0)];
          return x > width || y > height;
        }),
      );
      expect(off, f).toEqual([]);
    }
  });

  it('names only paths that are there', () => {
    const paths = diagrams.flatMap((f) =>
      [...read(`${IMAGES}/${f}`).matchAll(/class="code[^>]*>([\w./-]+\/[\w./-]+)</g)].map((m) =>
        must(m[1], 'a path'),
      ),
    );
    expect(paths.length).toBeGreaterThan(2);
    expect(paths.filter((p) => !existsSync(join(root, p)))).toEqual([]);
  });

  it('says of the gate what the gate does', () => {
    const { percent, absolute } = FLOOR.ms;
    for (const gate of ['perf-gate', 'perf-gate.dark'].map(drawn))
      for (const said of [
        `${percent} %, ${absolute} ms, and ${RUN_SDS} standard`,
        `${MIN_BASELINE_RUNS} baseline runs, and ${MIN_SAMPLES} samples`,
        `p &lt; ${ALPHA}`,
      ])
        expect(gate).toContain(said);
    for (const gate of ['perf-gate.tr', 'perf-gate.tr.dark'].map(drawn))
      for (const said of [
        `%${percent}, ${absolute} ms ve`,
        `${RUN_SDS} standart sapma`,
        `${MIN_BASELINE_RUNS} baseline çalıştırması ve her iki yanda ${MIN_SAMPLES} örnek`,
        `p &lt; ${String(ALPHA).replace('.', ',')}`,
      ])
        expect(gate).toContain(said);
  });

  it('says of a settle what the settle does', () => {
    for (const call of ['tool-call', 'tool-call.dark', 'one-call', 'one-call.dark'].map(drawn)) {
      expect(call).toContain(`still for ${SETTLE.quietMs} ms,`);
      expect(call).toContain(`at most ${SETTLE.maxMs / 1000} s<`);
    }
    for (const call of ['tool-call.tr', 'tool-call.tr.dark', 'one-call.tr', 'one-call.tr.dark'].map(
      drawn,
    )) {
      expect(call).toContain(`${SETTLE.quietMs} ms durgun`);
      expect(call).toContain(`en çok ${SETTLE.maxMs / 1000} s<`);
    }
  });
});
