import { expect, it } from 'vitest';
import { publishedReadme } from '../scripts/published-readme.mjs';

const REPOSITORY = 'git+https://github.com/o/r.git';
const HOME = 'https://github.com/o/r';

it("makes each link to a file of the repository whole, at the version's tag, and leaves the rest", () => {
  const page = [
    '![a picture](docs/images/a.svg)',
    '<img src="docs/images/b.png" width="49%" alt="b">',
    '<source media="(prefers-color-scheme: dark)" srcset="docs/images/c.dark.svg">',
    'See [the docs](docs/README.md), [security](SECURITY.md) and [a part](docs/README.md#part).',
    '[![a badge](https://example.com/b.svg)](LICENSE) [![another](https://example.com/c.svg)](https://example.com/c)',
    'Leave [a page](https://example.com/x) and [an anchor](#install) alone.',
  ].join('\n');
  expect(publishedReadme(page, REPOSITORY, '1.2.3').split('\n')).toEqual([
    `![a picture](${HOME}/raw/v1.2.3/docs/images/a.svg)`,
    `<img src="${HOME}/raw/v1.2.3/docs/images/b.png" width="49%" alt="b">`,
    `<source media="(prefers-color-scheme: dark)" srcset="${HOME}/raw/v1.2.3/docs/images/c.dark.svg">`,
    `See [the docs](${HOME}/blob/v1.2.3/docs/README.md), [security](${HOME}/blob/v1.2.3/SECURITY.md) and [a part](${HOME}/blob/v1.2.3/docs/README.md#part).`,
    `[![a badge](https://example.com/b.svg)](${HOME}/blob/v1.2.3/LICENSE) [![another](https://example.com/c.svg)](https://example.com/c)`,
    'Leave [a page](https://example.com/x) and [an anchor](#install) alone.',
  ]);
});
