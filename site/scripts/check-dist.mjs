#!/usr/bin/env node
/**
 * Checks the built site in dist/: every link and image inside the site leads to a file, and to an
 * anchor that page has, and every page says what a search engine and a share need of it.
 *
 *   pnpm --filter @appdyno/site build && pnpm --filter @appdyno/site check:dist
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://appdyno.dev';
const BEACON = 'https://static.cloudflareinsights.com/beacon.min.js';
/** What the footer's line about the counter has in both languages. */
const COUNTED = 'Cloudflare Web Analytics';
const dist = fileURLToPath(new URL('../dist', import.meta.url));

/** @type {string[]} */
const problems = [];
/** Each page by its path on the site: `/docs/guides/flows/`. */
const pages = new Map(
  readdirSync(dist, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.html'))
    .map((file) => [
      `/${relative(dist, join(dist, file)).split(sep).join('/')}`.replace(/index\.html$/, ''),
      readFileSync(join(dist, file), 'utf8'),
    ]),
);

/** @param {string} html */
const idsOf = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
/** @type {Map<string, Set<string | undefined>>} */
const ids = new Map();
/** @param {string} path */
const idsAt = (path) => {
  const html = pages.get(path);
  if (html && !ids.has(path)) ids.set(path, idsOf(html));
  return ids.get(path);
};

/**
 * All a tag's values of one attribute.
 * @param {string} html
 * @param {string} tag
 * @param {string} attribute
 */
const valuesOf = (html, tag, attribute) =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*?\\s${attribute}="([^"]*)"`, 'g'))].map(
    (m) => m[1] ?? '',
  );

/**
 * The one value of a tag picked by another of its attributes, or what is wrong with it.
 * @param {string} html
 * @param {RegExp} tag
 */
const one = (html, tag) => {
  const found = [...html.matchAll(tag)];
  return found.length === 1 ? (found[0]?.[1] ?? '') : undefined;
};

/** @type {Map<string, string>} */
const titles = new Map();
let checked = 0;

for (const [path, html] of pages) {
  // what leads somewhere inside the site
  const links = [
    ...valuesOf(html, 'a', 'href'),
    ...valuesOf(html, 'link', 'href'),
    ...valuesOf(html, '(?:img|script|source)', '(?:src|srcset)'),
    // the models the bench's scene fetches
    ...valuesOf(html, 'canvas', 'data-[a-z]+'),
    ...valuesOf(html, 'meta', 'content').filter((value) => value.startsWith(SITE)),
  ]
    // an address of the site said whole, as a canonical one or a share's image, is inside it too
    .map((link) => (link.startsWith(SITE) ? link.slice(SITE.length) || '/' : link))
    .filter((link) => !/^([a-z]+:|\/\/)/.test(link));
  for (const link of new Set(links)) {
    const [to = '', anchor] = decodeURIComponent(link.replaceAll('&amp;', '&')).split('#');
    const target = to ? posix.resolve(path, to.split('?')[0] ?? '') : path;
    const file = join(dist, target);
    const page = pages.has(target) ? target : pages.has(`${target}/`) ? `${target}/` : undefined;
    if (!page && !(existsSync(file) && statSync(file).isFile()))
      problems.push(`${path}: ${link} leads to nothing`);
    else if (anchor && page && !idsAt(page)?.has(anchor))
      problems.push(`${path}: ${link} has no such anchor`);
    checked += 1;
  }

  // a script in the head that holds the page back
  for (const script of html.matchAll(/<script\b[^>]*\ssrc="[^"]*"[^>]*>/g))
    if (!/\s(type="module"|async|defer)/.test(script[0]))
      problems.push(`${path}: a script blocks the page: ${script[0]}`);

  if (html.split(BEACON).length !== 2) problems.push(`${path}: not exactly one visit counter`);
  if (!html.includes(COUNTED)) problems.push(`${path}: does not say that it counts visits`);
  const title = one(html, /<title>([^<]+)<\/title>/g);
  if (!title) problems.push(`${path}: not exactly one title`);
  if (!one(html, /<meta name="description" content="([^"]+)"/g))
    problems.push(`${path}: not exactly one description`);
  if (!one(html, /<meta property="og:image" content="(https:[^"]+)"/g))
    problems.push(`${path}: no image for a share`);

  // the page GitHub Pages serves for a missing one stands at no address of its own
  if (path === '/404.html') continue;
  // a name, as an example's, is the same in both languages: a title is a page's own in its language
  const titled = `${path.startsWith('/tr/')} ${title}`;
  if (titles.has(titled)) problems.push(`${path}: its title is also ${titles.get(titled)}'s`);
  titles.set(titled, path);
  if (one(html, /<link rel="canonical" href="([^"]+)"/g) !== SITE + path)
    problems.push(`${path}: its canonical address is not ${SITE + path}`);
  const bare = path.replace(/^\/tr(?=\/)/, '');
  for (const [lang, to] of [
    ['en', bare],
    ['tr', `/tr${bare}`],
    ['x-default', bare],
  ])
    if (
      one(html, new RegExp(`<link rel="alternate" hreflang="${lang}" href="([^"]+)"`, 'g')) !==
      SITE + to
    )
      problems.push(`${path}: its hreflang ${lang} is not ${SITE + to}`);
  if (!pages.has(bare) || !pages.has(`/tr${bare}`))
    problems.push(`${path}: is not there in both languages`);
}

for (const file of [
  'CNAME',
  'robots.txt',
  'sitemap.xml',
  'sitemap-index.xml',
  'llms.txt',
  'llms-full.txt',
])
  if (!existsSync(join(dist, file))) problems.push(`${file} is missing`);

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s) in ${pages.size} pages`);
  process.exit(1);
}
console.log(`${pages.size} pages, ${checked} links: links, anchors and heads are in order`);
