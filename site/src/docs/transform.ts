import { posix } from 'node:path';
import { REPO, pathIn, type Lang } from '../site.ts';

/** A page of docs/, by its path under docs/: `guides/flows.tr.md`. */
export type Source = { lang: Lang; slug: string };

/** Where a file of docs/ is on the site: a README is its folder's index. */
export const sourceOf = (file: string): Source => ({
  lang: file.endsWith('.tr.md') ? 'tr' : 'en',
  slug: file
    .replace(/(\.tr)?\.md$/, '')
    .replace(/(^|\/)README$/, '')
    .toLowerCase(),
});

export const routeOf = ({ lang, slug }: Source) => pathIn(lang, `/docs/${slug ? `${slug}/` : ''}`);

/** A link of a page as the site has it: a page of the docs, one of their images, or the file on GitHub. */
export const linkOf = (link: string, file: string, pages: ReadonlySet<string>): string => {
  if (/^([a-z]+:|#|\/)/.test(link)) return link;
  const [path = '', anchor] = link.split('#');
  const target = posix.normalize(posix.join('docs', posix.dirname(file), path));
  const hash = anchor ? `#${anchor}` : '';
  if (target.startsWith('docs/images/')) return `/${target}`;
  // the repository's own README is no page of the docs, though docs/README.md is
  const inDocs = target.startsWith('docs/') ? target.slice('docs/'.length) : '';
  if (pages.has(inDocs)) return routeOf(sourceOf(inDocs)) + hash;
  return `${REPO}/blob/main/${target}${hash}`;
};

/** Markdown outside its code, changed by `change`: a fence and a code span stay as written. */
const outsideCode = (text: string, change: (prose: string) => string) =>
  text
    .split(/(```[^]*?```|`[^`\n]*`)/)
    .map((part, i) => (i % 2 ? part : change(part)))
    .join('');

// GitHub picks by the system's theme; the site has a theme of its own, which these two classes of Starlight follow
const PICTURE =
  /<picture>\s*<source media="\(prefers-color-scheme: dark\)" srcset="([^"]+)">\s*<img src="([^"]+)" alt="([^"]*)">\s*<\/picture>/g;

const plain = (markdown: string) =>
  markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const MAX_DESCRIPTION = 160;
const cut = (text: string) =>
  text.length <= MAX_DESCRIPTION
    ? text
    : `${text.slice(0, MAX_DESCRIPTION).replace(/\s+\S*$/, '')}…`;

/**
 * A page of docs/ as the site shows it: its heading as the title, its first paragraph as the
 * description, no link to its other language, which the site's own picker is, and its links on the site.
 */
export const pageOf = (text: string, file: string, pages: ReadonlySet<string>) => {
  const heading = /^# (.+)$/m.exec(text);
  if (!heading?.[1]) throw new Error(`docs/${file} has no heading to take its title from`);
  const rest = text
    .slice(heading.index + heading[0].length)
    .replace(/^\s*\[(?:Türkçe|English)\]\([^)]+\.md\)\s*$/m, '');
  const body = outsideCode(rest, (prose) =>
    prose
      .replace(
        PICTURE,
        (_, dark: string, light: string, alt: string) =>
          `<img class="dark:sl-hidden" src="${light}" alt="${alt}"><img class="light:sl-hidden" src="${dark}" alt="${alt}">`,
      )
      .replace(/\]\(([^)\s]+)\)/g, (_, link: string) => `](${linkOf(link, file, pages)})`)
      .replace(/ src="([^"]+)"/g, (_, link: string) => ` src="${linkOf(link, file, pages)}"`),
  ).trim();
  const first = rest
    .split(/\n\s*\n/)
    .find((p) => /^\s*[\p{L}*`[]/u.test(p) && !/^\s*\[.*\]: /.test(p));
  return {
    title: plain(heading[1]),
    description: cut(plain(first ?? heading[1])),
    body,
  };
};
