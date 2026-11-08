import { expect, it } from 'vitest';
// @ts-expect-error: a script's reckoning, with no types of its own
import { publishedReadme } from '../scripts/published-readme.mjs';

const REPOSITORY = 'git+https://github.com/o/r.git';
const HOME = 'https://github.com/o/r';

it('makes each link to a file of the repository whole, and leaves the rest', () => {
  const page = [
    '![a picture](docs/images/a.svg)',
    '<img src="docs/images/b.png" width="49%" alt="b">',
    '<source media="(prefers-color-scheme: dark)" srcset="docs/images/c.dark.svg">',
    'See [the docs](docs/README.md), [security](SECURITY.md) and [a part](docs/README.md#part).',
    'Leave [a page](https://example.com/x) and [an anchor](#install) alone.',
  ].join('\n');
  expect(publishedReadme(page, REPOSITORY).split('\n')).toEqual([
    `![a picture](${HOME}/raw/main/docs/images/a.svg)`,
    `<img src="${HOME}/raw/main/docs/images/b.png" width="49%" alt="b">`,
    `<source media="(prefers-color-scheme: dark)" srcset="${HOME}/raw/main/docs/images/c.dark.svg">`,
    `See [the docs](${HOME}/blob/main/docs/README.md), [security](${HOME}/blob/main/SECURITY.md) and [a part](${HOME}/blob/main/docs/README.md#part).`,
    'Leave [a page](https://example.com/x) and [an anchor](#install) alone.',
  ]);
});
