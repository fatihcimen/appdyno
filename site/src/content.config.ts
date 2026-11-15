import { defineCollection } from 'astro:content';
import { docsSchema } from '@astrojs/starlight/schema';
import { repoDocs } from './docs/loader.ts';

export const collections = {
  docs: defineCollection({ loader: repoDocs(), schema: docsSchema() }),
};
