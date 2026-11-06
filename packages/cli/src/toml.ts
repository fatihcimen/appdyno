/** A TOML settings file edited by its text: only this server's own tables change. */

type Table = { name: string; start: number; end: number };
type Key = { table: string; name: string; value: string };

const BARE_VALUE = /^(?:true|false|[+-]?(?:inf|nan)|[+-]?\d[\w.:+-]*(?: \d[\w.:+-]*)?)/;

/** A dotted name, without the quotes it can do without: a part that holds a dot is no path, and keeps them. */
const pathOf = (words: string) =>
  words.replace(/"(?:[^"\\]|\\.)*"|'[^']*'|\s+/g, (part) => {
    const inner = part.slice(1, -1);
    return /^[\w-]+$/.test(inner) ? inner : part.trim();
  });

/**
 * shortcut: the file's shape, not a full TOML reader: anything it cannot follow is refused, but a duplicate
 * key or a bad escape passes. Harmless here, as nothing but this server's tables is ever written; a
 * real parser if a client's file ever needs more than that.
 */
function scan(text: string) {
  let i = 0;
  const fail = (why: string): never => {
    throw new Error(`not TOML: line ${text.slice(0, i).split('\n').length}: ${why}`);
  };
  const spaces = () => {
    while (text[i] === ' ' || text[i] === '\t') i++;
  };
  const comment = () => {
    if (text[i] === '#') while (i < text.length && text[i] !== '\n') i++;
  };
  const blanks = () => {
    for (;;) {
      while (/\s/.test(text[i] ?? '')) i++;
      if (text[i] !== '#') return;
      comment();
    }
  };
  const lineEnd = () => {
    spaces();
    comment();
    if (text[i] === '\r') i++;
    if (i < text.length && text[i] !== '\n') fail('more on a line than it can hold');
    i = Math.min(i + 1, text.length);
  };
  const string = () => {
    const quote = text[i]!;
    const long = text.startsWith(quote.repeat(3), i);
    const end = long ? quote.repeat(3) : quote;
    i += end.length;
    for (;;) {
      if (i >= text.length || (!long && text[i] === '\n')) fail('a string has no end');
      if (quote === '"' && text[i] === '\\') i += 2;
      else if (text.startsWith(end, i)) {
        i += end.length;
        return;
      } else i++;
    }
  };
  const keyName = () => {
    const from = i;
    while (i < text.length && text[i] !== '=' && text[i] !== '\n') {
      if (text[i] === '"' || text[i] === "'") string();
      else i++;
    }
    const name = text.slice(from, i).trim();
    if (text[i] !== '=' || !name) fail('neither a table nor a key and value');
    i++;
    spaces();
    return name;
  };
  const value = () => {
    const c = text[i];
    if (c === '"' || c === "'") return string();
    if (c === '[' || c === '{') {
      const close = c === '[' ? ']' : '}';
      i++;
      for (;;) {
        blanks();
        if (text[i] === close) {
          i++;
          return;
        }
        if (c === '{') keyName();
        value();
        blanks();
        if (text[i] === ',') i++;
        else if (text[i] !== close) fail(`no end to a list opened with ${c}`);
      }
    }
    const bare = BARE_VALUE.exec(text.slice(i, i + 64));
    if (!bare) return fail('not a value');
    i += bare[0].length;
  };

  const tables: Table[] = [];
  const keys: Key[] = [];
  for (;;) {
    blanks();
    if (i >= text.length) return { tables, keys };
    const start = i;
    if (text[i] === '[') {
      const brackets = text[i + 1] === '[' ? 2 : 1;
      i += brackets;
      while (i < text.length && text[i] !== ']' && text[i] !== '\n') {
        if (text[i] === '"' || text[i] === "'") string();
        else i++;
      }
      if (!text.startsWith(']'.repeat(brackets), i)) fail('a table has no end');
      const name = pathOf(text.slice(start + brackets, i));
      i += brackets;
      lineEnd();
      tables.push({ name, start, end: i });
      continue;
    }
    const name = pathOf(keyName());
    const from = i;
    value();
    const table = tables.at(-1);
    keys.push({ table: table?.name ?? '', name, value: text.slice(from, i) });
    lineEnd();
    if (table) table.end = i;
  }
}

/**
 * A value JSON has no way to say, as the file has it: an inline table, a literal string, a date. It goes back word for
 * word, as a string in its place stops a client reading its settings, and it shows nothing to what goes through an entry.
 */
class Verbatim {
  readonly #text: string;

  constructor(text: string) {
    this.#text = text;
  }

  get text() {
    return this.#text;
  }
}

const decoded = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return new Verbatim(value);
  }
};

const encoded = (value: unknown) =>
  value instanceof Verbatim ? value.text : JSON.stringify(value).replaceAll('","', '", "');

/** The table is written as a value of a key, or under one: TOML lets no table be added to a value on one line. */
const inlined = (keys: Key[], full: string) =>
  keys.some((k) => {
    const inTable = k.table === full || k.table.startsWith(`${full}.`);
    const path = k.table ? `${k.table}.${k.name}` : k.name;
    return (
      !inTable && (path === full || path.startsWith(`${full}.`) || full.startsWith(`${path}.`))
    );
  });

/** The server's table, with any ways it is written that this tool will not touch refused. */
function located(text: string, key: string, name: string) {
  const full = `${key}.${name}`;
  const shape = scan(text);
  if (inlined(shape.keys, full)) throw new Error(`${full} is written inline: edit it by hand`);
  return { full, ...shape, table: shape.tables.find((t) => t.name === full) };
}

function cut(text: string, { start, end }: Table) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  if (after.trim() === '') return before.trim() === '' ? '' : `${before.trimEnd()}\n`;
  return before.endsWith('\n\n') && after.startsWith('\n')
    ? before + after.slice(1)
    : before + after;
}

export const tomlEdit = {
  read(text: string, key: string, name: string): unknown {
    const { full, keys, table } = located(text, key, name);
    if (!table) return undefined;
    return Object.fromEntries(
      keys.filter((k) => k.table === full).map((k) => [k.name, decoded(k.value)]),
    );
  },

  write(text: string, key: string, name: string, entry: Record<string, unknown>) {
    const { full, table } = located(text, key, name);
    const lines = Object.entries(entry).map(([k, v]) => `${k} = ${encoded(v)}`);
    const section = `[${full}]\n${lines.join('\n')}\n`;
    if (table) return text.slice(0, table.start) + section + text.slice(table.end);
    const gap = text === '' || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
    return `${text}${gap}${section}`;
  },

  remove(text: string, key: string, name: string) {
    const { full, tables } = located(text, key, name);
    return tables
      .filter((t) => t.name === full || t.name.startsWith(`${full}.`))
      .reverse()
      .reduce(cut, text);
  },
};
