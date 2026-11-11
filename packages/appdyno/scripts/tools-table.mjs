// The inputs of every tool in the reference's tables, read from the tools' own schemas so that none is kept by hand:
//   pnpm build && node packages/appdyno/scripts/tools-table.mjs
// writes them into both languages' pages, and tools-table.test.ts fails while a page and the schemas differ. What a tool
// does is each page's own words.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { format, resolveConfig } from 'prettier';
import { z } from 'zod';

/** Each page, the heading of its tables, and its word for a default. */
export const PAGES = [
  { page: 'docs/reference/tools.md', heading: '## Every tool', word: 'default' },
  { page: 'docs/reference/tools.tr.md', heading: '## Her araç', word: 'varsayılan' },
];

/** A row of those tables: `| `name` | what it does | inputs |`. */
const ROW = /^(\| `([a-z_]+)` +\|[^|\n]*\| )(.*?)( *\|)$/gm;

/**
 * An op's inputs as a page writes them: a required one bold, then the values it takes or its default, the default marked.
 * @param {{ input: z.ZodType }} op
 * @param {string} word
 */
export function inputsOf(op, word) {
  const schema = z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'any' });
  const required = new Set(schema.required);
  const said = Object.entries(schema.properties ?? {}).map(([name, part]) => {
    const s = typeof part === 'object' ? part : {};
    const items = typeof s.items === 'object' && !Array.isArray(s.items) ? s.items : {};
    const values = s.enum ?? items.enum ?? (s.default === undefined ? [] : [s.default]);
    const label = required.has(name) ? `**\`${name}\`**` : `\`${name}\``;
    const shown = values.map(
      (v) =>
        `\`${typeof v === 'string' ? v : JSON.stringify(v)}\`${v === s.default ? ` (${word})` : ''}`,
    );
    return shown.length ? `${label}: ${shown.join(', ')}` : label;
  });
  return said.join('; ') || '–';
}

/**
 * The part of a page that holds its tables of tools.
 * @param {string} text
 * @param {string} heading
 */
const sectionOf = (text, heading) => {
  const start = `\n${text}`.indexOf(`\n${heading}\n`);
  const end = text.indexOf('\n## ', start + 1);
  return start < 0 ? '' : text.slice(start, end < 0 ? undefined : end);
};

/**
 * What a page says of the tools that their schemas do not: a tool with no row, a row of no tool, inputs that differ.
 * @param {string} text
 * @param {Record<string, { input: z.ZodType }>} ops
 * @param {{ heading: string; word: string }} page
 */
export function differences(text, ops, { heading, word }) {
  const rows = [...sectionOf(text, heading).matchAll(ROW)].map((m) => ({
    name: m[2] ?? '',
    inputs: m[3] ?? '',
  }));
  const named = rows.map((r) => r.name);
  return [
    ...Object.keys(ops)
      .filter((name) => !named.includes(name))
      .map((name) => `${name}: no row`),
    ...named.filter((name, i) => named.indexOf(name) !== i).map((name) => `${name}: two rows`),
    ...rows.flatMap(({ name, inputs }) => {
      const op = ops[name];
      if (!op) return [`${name}: no such tool`];
      const want = inputsOf(op, word);
      return inputs === want ? [] : [`${name}: ${inputs}, where its schema takes ${want}`];
    }),
  ];
}

/**
 * The page with each row's inputs as its tool's schema has them.
 * @param {string} text
 * @param {Record<string, { input: z.ZodType }>} ops
 * @param {{ heading: string; word: string }} page
 */
export function filled(text, ops, { heading, word }) {
  const section = sectionOf(text, heading);
  if (!section) return text;
  const done = section.replace(ROW, (row, start, name, _inputs, end) => {
    const op = ops[String(name)];
    return op ? `${String(start)}${inputsOf(op, word)}${String(end)}` : row;
  });
  return text.replace(section, () => done);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  const ops = opsFor(new ServerContext(DEFAULT_POLICY, []));
  let left = 0;
  for (const page of PAGES) {
    const file = join(root, page.page);
    const text = filled(readFileSync(file, 'utf8'), ops, page);
    writeFileSync(file, await format(text, { ...(await resolveConfig(file)), filepath: file }));
    const wrong = differences(readFileSync(file, 'utf8'), ops, page);
    for (const line of wrong) console.error(`${page.page}: ${line}`);
    left += wrong.length;
  }
  process.exit(left ? 1 : 0);
}
