import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkOf, pageOf, routeOf, sourceOf } from '../src/docs/transform.ts';

const pages = new Set([
  'README.md',
  'README.tr.md',
  'guides/flows.md',
  'guides/flows.tr.md',
  'reference/perf.md',
  'reference/perf.tr.md',
  'examples/shop/README.md',
]);

test('a file of docs/ has its route in its language', () => {
  assert.equal(routeOf(sourceOf('README.md')), '/docs/');
  assert.equal(routeOf(sourceOf('README.tr.md')), '/tr/docs/');
  assert.equal(routeOf(sourceOf('guides/flows.tr.md')), '/tr/docs/guides/flows/');
  assert.equal(routeOf(sourceOf('examples/shop/README.md')), '/docs/examples/shop/');
});

test('a link leads to a page, an image or the file on GitHub', () => {
  const from = (link: string) => linkOf(link, 'guides/flows.tr.md', pages);
  assert.equal(from('../reference/perf.tr.md#kapı'), '/tr/docs/reference/perf/#kapı');
  assert.equal(from('flows.md'), '/docs/guides/flows/');
  assert.equal(from('../README.tr.md'), '/tr/docs/');
  assert.equal(from('../images/perf-gate.tr.svg'), '/docs/images/perf-gate.tr.svg');
  assert.equal(
    from('../../CONTRIBUTING.tr.md#commits'),
    'https://github.com/fatihcimen/appdyno/blob/main/CONTRIBUTING.tr.md#commits',
  );
  assert.equal(
    from('../examples/perf-gate.yml'),
    'https://github.com/fatihcimen/appdyno/blob/main/docs/examples/perf-gate.yml',
  );
  assert.equal(
    from('../../README.md'),
    'https://github.com/fatihcimen/appdyno/blob/main/README.md',
  );
  assert.equal(from('#here'), '#here');
  assert.equal(from('https://example.com/a.md'), 'https://example.com/a.md');
});

test('a page gives its title, its description and its body on the site', () => {
  const text = [
    '# Flows',
    '',
    '[Türkçe](flows.tr.md)',
    '',
    'A flow is what an agent did, **kept**. See [Performance](../reference/perf.md#the-gate).',
    '',
    '<picture>',
    '  <source media="(prefers-color-scheme: dark)" srcset="../images/a.dark.svg">',
    '  <img src="../images/a.svg" alt="A picture">',
    '</picture>',
    '',
    'In code `[x](flows.md)` stays.',
    '',
    '```md',
    '[y](flows.md)',
    '```',
  ].join('\n');
  const page = pageOf(text, 'guides/flows.md', pages);
  assert.equal(page.title, 'Flows');
  assert.equal(page.description, 'A flow is what an agent did, kept. See Performance.');
  assert.ok(!page.body.includes('Türkçe'));
  assert.ok(page.body.includes('[Performance](/docs/reference/perf/#the-gate)'));
  assert.ok(
    page.body.includes(
      '<img class="dark:sl-hidden" src="/docs/images/a.svg" alt="A picture"><img class="light:sl-hidden" src="/docs/images/a.dark.svg" alt="A picture">',
    ),
  );
  assert.ok(page.body.includes('`[x](flows.md)`'));
  assert.ok(page.body.includes('```md\n[y](flows.md)\n```'));
});

test('a long first paragraph is cut at a word', () => {
  const page = pageOf(`# T\n\n${'word '.repeat(60)}`, 'a.md', pages);
  assert.ok(page.description.length <= 161);
  assert.ok(page.description.endsWith('word…'));
});

test('a page with no heading is refused', () => {
  assert.throws(() => pageOf('no heading', 'a.md', pages), /no heading/);
});
