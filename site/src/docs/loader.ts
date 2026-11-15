import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Loader } from 'astro/loaders';
import { REPO } from '../site.ts';
import { pageOf, routeOf, sourceOf } from './transform.ts';

/** The pages of docs/ that git has or would take: what a local build of an example leaves is not one. */
const pagesIn = (docs: string) =>
  execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.md'], {
    cwd: docs,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .sort();

/** Where each page stands in its language's index, which is the order a reader meets them in. */
const orderIn = (index: string) =>
  new Map([...index.matchAll(/\]\(([^)#\s]+\.md)\)/g)].map((m, i) => [m[1], i]));

/**
 * The docs collection, read from the repository's docs/ as it stands: `X.md` is the English page
 * and `X.tr.md` the Turkish one, so the site and GitHub show one text.
 */
export const repoDocs = (): Loader => ({
  name: 'appdyno-repo-docs',
  async load({ store, parseData, renderMarkdown, generateDigest, config, watcher }) {
    const docs = new URL('../docs/', config.root);
    const read = (file: string) => readFileSync(new URL(file, docs), 'utf8');
    const sync = async () => {
      const files = pagesIn(fileURLToPath(docs));
      const pages = new Set(files);
      const order = { en: orderIn(read('README.md')), tr: orderIn(read('README.tr.md')) };
      store.clear();
      for (const file of files) {
        const text = read(file);
        const source = sourceOf(file);
        const id = routeOf(source).slice(1, -1);
        const { title, description, body } = pageOf(text, file, pages);
        const data = await parseData({
          id,
          data: {
            title,
            description,
            editUrl: `${REPO}/edit/main/docs/${file}`,
            sidebar: { order: order[source.lang].get(file) },
          },
        });
        store.set({
          id,
          data,
          body,
          // where Starlight's own loader would have found the page: its sidebar sorts pages into folders by this
          filePath: `src/content/docs/${id}${/(^|\/)README\./.test(file) ? '/index' : ''}.md`,
          digest: generateDigest(text),
          rendered: await renderMarkdown(body, { fileURL: new URL(file, docs) }),
        });
      }
    };
    await sync();
    // in dev, a page of docs/ saved is a page of the site again
    watcher?.add(fileURLToPath(docs));
    watcher?.on('all', (_, path) => {
      if (path.startsWith(fileURLToPath(docs)) && path.endsWith('.md')) void sync();
    });
  },
});
