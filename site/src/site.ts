/** What every page of the site says about where it is and what it leads to. */
export const SITE = 'https://appdyno.dev';
export const REPO = 'https://github.com/fatihcimen/appdyno';
export const NPM = 'https://www.npmjs.com/package/appdyno';
export const RELEASES = `${REPO}/releases`;
/** The image a share shows: the repository's own, served with the docs' images. */
export const SHARE_IMAGE = { path: '/docs/images/social.png', width: 1280, height: 640 };

/** Cloudflare Web Analytics, cookie-free. The token ships in every page, and is public. */
export const ANALYTICS = {
  src: 'https://static.cloudflareinsights.com/beacon.min.js',
  token: 'a6ab8b72c9b444bcb25cf35fdbaa7135',
};

/** What a person runs first: a command, the same in every language. */
export const INSTALL = 'npx -y appdyno install';
/** The name appdyno is listed under in the official MCP registry, as server.json has it. */
export const REGISTRY = 'io.github.fatihcimen/appdyno';

export const LANGS = ['en', 'tr'] as const;
export type Lang = (typeof LANGS)[number];

/** A path of the site in a language: English at the root, Turkish under /tr. */
export const pathIn = (lang: Lang, path: string) => (lang === 'en' ? path : `/tr${path}`);
export const langOf = (path: string): Lang => (/^\/tr(\/|$)/.test(path) ? 'tr' : 'en');
