import english from '../../README.md?raw';
import turkish from '../../README.tr.md?raw';
import type { Lang } from './site.ts';

/**
 * The README's line that names the MCP clients, in a language. A client's name is written in the
 * README and the files beside it, and in no page of the site: the two READMEs answer line for line.
 */
export const clientsLine = (lang: Lang) => {
  const at = english.split('\n').findIndex((line) => line.startsWith('Works with '));
  const line = (lang === 'en' ? english : turkish).split('\n')[at];
  if (!line) throw new Error('the README has no line of clients to show');
  return line;
};
