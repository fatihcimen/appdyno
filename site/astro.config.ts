import starlight from '@astrojs/starlight';
import { defineConfig, fontProviders } from 'astro/config';
import { docsImages } from './src/docs/images.ts';
import { SITE_HEAD } from './src/head.ts';
import { en } from './src/i18n/en.ts';
import { tr } from './src/i18n/tr.ts';
import { REPO, SITE } from './src/site.ts';

/** A group of the docs' sidebar, named in both languages. */
const group = (name: keyof typeof en.docs) => ({
  label: en.docs[name],
  translations: { tr: tr.docs[name] },
});

// the letters Turkish adds are in latin-ext
const subsets: [string, ...string[]] = ['latin', 'latin-ext'];

export default defineConfig({
  site: SITE,
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'appdyno',
      description: en.meta.description,
      logo: {
        light: '../docs/images/logo.svg',
        dark: '../docs/images/logo.dark.svg',
        replacesTitle: true,
      },
      favicon: '/favicon.svg',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        tr: { label: 'Türkçe', lang: 'tr' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      head: SITE_HEAD,
      // the pages are read from the repository's docs/, where Starlight's own Markdown steps are to run too
      markdown: { processedDirs: ['../docs'] },
      // one 404.html is all GitHub Pages serves: src/pages/404.astro says it in both languages
      disable404Route: true,
      components: { Footer: './src/components/starlight/Footer.astro' },
      sidebar: [
        { ...group('guides'), items: [{ autogenerate: { directory: 'docs/guides' } }] },
        { ...group('reference'), items: [{ autogenerate: { directory: 'docs/reference' } }] },
        { ...group('examples'), items: ['docs/examples/shop'] },
        { ...group('architecture'), items: ['docs/architecture'] },
      ],
    }),
    docsImages(),
  ],
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Bricolage Grotesque',
      cssVariable: '--f-display',
      weights: [500, 800],
      styles: ['normal'],
      subsets,
      fallbacks: ['system-ui', 'sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'JetBrains Mono',
      cssVariable: '--f-mono',
      weights: [400, 700],
      styles: ['normal'],
      subsets,
      fallbacks: ['ui-monospace', 'Menlo', 'monospace'],
    },
  ],
});
