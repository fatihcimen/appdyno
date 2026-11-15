import { englishDocs, text } from '../docs/llms.ts';
import { en } from '../i18n/en.ts';
import { INSTALL, NPM, REPO, SITE } from '../site.ts';

/** The site as a model reads it: what appdyno is, and where each page of the docs is. */
export const GET = async () =>
  text(
    [
      '# appdyno',
      '',
      `> ${en.meta.description}`,
      '',
      `Install: \`${INSTALL}\``,
      '',
      '## Docs',
      '',
      ...(await englishDocs()).map((page) => `- [${page.title}](${page.url}): ${page.description}`),
      '',
      '## More',
      '',
      `- [Every page as one text](${SITE}/llms-full.txt)`,
      `- [Source](${REPO})`,
      `- [npm](${NPM})`,
      '',
    ].join('\n'),
  );
