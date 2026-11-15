import type { Lang } from '../site.ts';
import { en, type Words } from './en.ts';
import { tr } from './tr.ts';

export type { Words };
/** The site's words in each language. */
export const words: Record<Lang, Words> = { en, tr };
