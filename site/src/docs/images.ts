import { cpSync, createReadStream, existsSync } from 'node:fs';
import { extname } from 'node:path';
import type { AstroIntegration } from 'astro';

const TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
};

/** Serves the repository's docs/images at /docs/images, in dev and in a build, with no copy kept in git. */
export const docsImages = (): AstroIntegration => {
  let images: URL;
  return {
    name: 'appdyno-docs-images',
    hooks: {
      'astro:config:done': ({ config }) => {
        images = new URL('../docs/images/', config.root);
      },
      'astro:server:setup': ({ server }) => {
        server.middlewares.use('/docs/images', (request, response, next) => {
          const file = new URL(`.${(request.url ?? '/').split('?')[0] ?? '/'}`, images);
          const type = TYPES[extname(file.pathname)];
          if (!file.href.startsWith(images.href) || !type || !existsSync(file)) return next();
          response.setHeader('Content-Type', type);
          createReadStream(file).pipe(response);
        });
      },
      'astro:build:done': ({ dir }) => {
        cpSync(images, new URL('docs/images/', dir), { recursive: true });
      },
    },
  };
};
