import { ANALYTICS, SHARE_IMAGE, SITE } from './site.ts';

type Tag = { tag: 'meta' | 'script'; attrs: Record<string, string | boolean> };

const image = SITE + SHARE_IMAGE.path;

/**
 * What every page's head has, the landing page's and the docs' alike: the image a share shows, and
 * the visit counter. `layouts/Base.astro` and Starlight's `head` both take it from here.
 */
export const SITE_HEAD: Tag[] = [
  { tag: 'meta', attrs: { property: 'og:image', content: image } },
  { tag: 'meta', attrs: { property: 'og:image:width', content: String(SHARE_IMAGE.width) } },
  { tag: 'meta', attrs: { property: 'og:image:height', content: String(SHARE_IMAGE.height) } },
  { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
  { tag: 'meta', attrs: { name: 'twitter:image', content: image } },
  {
    tag: 'script',
    attrs: {
      type: 'module',
      src: ANALYTICS.src,
      'data-cf-beacon': JSON.stringify({ token: ANALYTICS.token }),
    },
  },
];
