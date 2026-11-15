import { englishDocs, text } from '../docs/llms.ts';
import { en } from '../i18n/en.ts';

/** Every English page of the docs as one text, each under its title and its address. */
export const GET = async () =>
  text(
    [
      `# appdyno\n\n> ${en.meta.description}`,
      ...(await englishDocs()).map(
        (page) => `# ${page.title}\n\nSource: ${page.url}\n\n${page.body}`,
      ),
    ].join('\n\n---\n\n') + '\n',
  );
