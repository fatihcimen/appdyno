import { getCollection } from 'astro:content';
import { SITE } from '../site.ts';

/** The English pages of the docs, in the order their index lists them, the index first. */
export const englishDocs = async () => {
  const last = Number.MAX_SAFE_INTEGER;
  const rank = (page: { id: string; data: { sidebar: { order?: number | undefined } } }) =>
    page.id === 'docs' ? -1 : (page.data.sidebar.order ?? last);
  return (await getCollection('docs'))
    .filter((page) => !page.id.startsWith('tr/'))
    .sort((a, b) => rank(a) - rank(b))
    .map((page) => ({
      title: page.data.title,
      description: page.data.description ?? '',
      url: `${SITE}/${page.id}/`,
      // a link of the site, said whole: the text is read away from the site
      body: (page.body ?? '').replace(/(\]\(| src=")\/(?!\/)/g, `$1${SITE}/`),
    }));
};

export const text = (body: string) =>
  new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
