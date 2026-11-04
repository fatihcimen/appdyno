/** A JSON settings file edited by its text: all but the one entry stays as it was, comments included. */

type Member = { name: string; start: number; value: number; end: number; comma?: number };
type Members = { members: Member[]; close: number };

const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

function spaceAfter(t: string, at: number) {
  let i = at;
  while (isSpace(t[i])) i++;
  return i;
}

function spaceBefore(t: string, at: number) {
  let i = at;
  while (i > 0 && isSpace(t[i - 1])) i--;
  return i;
}

function stringEnd(t: string, at: number) {
  let i = at + 1;
  while (i < t.length && t[i] !== '"') i += t[i] === '\\' ? 2 : 1;
  return i + 1;
}

/** The text with what `change` makes of its parts outside strings. */
function outsideStrings(text: string, change: (i: number) => { to: string; next: number } | void) {
  const parts: string[] = [];
  let from = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      i = stringEnd(text, i);
      continue;
    }
    const changed = change(i);
    if (!changed) {
      i++;
      continue;
    }
    parts.push(text.slice(from, i), changed.to);
    from = i = changed.next;
  }
  return parts.join('') + text.slice(from);
}

/** Comments blanked at their offsets, so that a place in this is the same place in the file. */
const uncommented = (text: string) =>
  outsideStrings(text, (i) => {
    const line = text.startsWith('//', i);
    if (!line && !text.startsWith('/*', i)) return;
    const found = text.indexOf(line ? '\n' : '*/', i);
    if (found < 0 && !line) throw new Error('a comment has no end');
    const next = found < 0 ? text.length : line ? found : found + 2;
    return { to: text.slice(i, next).replace(/[^\n]/g, ' '), next };
  });

const withoutTrailingCommas = (text: string) =>
  outsideStrings(text, (i) => {
    if (text[i] !== ',') return;
    const next = text[spaceAfter(text, i + 1)];
    return next === '}' || next === ']' ? { to: ' ', next: i + 1 } : undefined;
  });

function valueEnd(t: string, at: number) {
  if (t[at] === '"') return stringEnd(t, at);
  let i = at;
  if (t[at] !== '{' && t[at] !== '[') {
    while (!isSpace(t[i]) && !',}]'.includes(t[i]!)) i++;
    return i;
  }
  for (let depth = 0; ;) {
    if (t[i] === '"') {
      i = stringEnd(t, i);
      continue;
    }
    if (t[i] === '{' || t[i] === '[') depth++;
    if ((t[i] === '}' || t[i] === ']') && --depth === 0) return i + 1;
    i++;
  }
}

/** The members of the object that opens at `open`, in text already known to be JSON. */
function membersOf(t: string, open: number): Members {
  const members: Member[] = [];
  let i = spaceAfter(t, open + 1);
  while (t[i] !== '}') {
    const nameEnd = stringEnd(t, i);
    const value = spaceAfter(t, spaceAfter(t, nameEnd) + 1);
    const end = valueEnd(t, value);
    const after = spaceAfter(t, end);
    const comma = t[after] === ',' ? after : undefined;
    const name = JSON.parse(t.slice(i, nameEnd)) as string;
    members.push({ name, start: i, value, end, ...(comma !== undefined && { comma }) });
    i = comma === undefined ? after : spaceAfter(t, comma + 1);
  }
  return { members, close: i };
}

const lineIndent = (t: string, at: number) =>
  /^[ \t]*/.exec(t.slice(t.lastIndexOf('\n', at - 1) + 1, at))![0];

const splice = (t: string, from: number, to: number, text: string) =>
  t.slice(0, from) + text + t.slice(to);

const oneLine = (entry: unknown) =>
  JSON.stringify(entry, null, 1).replace(/\n\s*/g, ' ').replace(/\[ /g, '[').replace(/ \]/g, ']');

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Text with its first member at the front: no comma already there needs touching, and removing is its inverse. */
function insert(
  text: string,
  plain: string,
  open: number,
  at: Members,
  unit: string,
  member: (indent: string) => string,
) {
  const outer = lineIndent(plain, open);
  const first = at.members[0];
  if (!first) {
    const line = `\n${outer}${unit}${member(outer + unit)}`;
    return text.slice(open + 1, at.close).trim() === ''
      ? splice(text, open + 1, at.close, `${line}\n${outer}`)
      : splice(text, open + 1, open + 1, line);
  }
  if (!plain.slice(open + 1, first.start).includes('\n'))
    return splice(text, first.start, first.start, `${member(outer)}, `);
  const indent = lineIndent(plain, first.start);
  const eol = plain.indexOf('\n', open);
  return splice(text, eol, eol, `\n${indent}${member(indent)},`);
}

function cut(text: string, open: number, { members }: Members, i: number) {
  const m = members[i]!;
  const next = members[i + 1];
  const previous = members[i - 1];
  const past = m.comma === undefined ? m.end : m.comma + 1;
  if (members.length === 1) {
    const close = spaceAfter(text, past);
    const from =
      text.slice(open + 1, m.start).trim() === '' ? open + 1 : spaceBefore(text, m.start);
    return splice(text, from, text[close] === '}' ? close : past, '');
  }
  if (next && !text.slice(past, next.start).includes('\n'))
    return splice(text, m.start, spaceAfter(text, past), '');
  const left = splice(text, spaceBefore(text, m.start), past, '');
  // a last member with no comma of its own leaves the one before it trailing
  return !next && m.comma === undefined && previous?.comma !== undefined
    ? splice(left, previous.comma, previous.comma + 1, '')
    : left;
}

export function jsonEdit(strict: boolean) {
  /** The file as JSON, or the reason it is not; an empty file is an empty object. */
  function parsed(file: string) {
    const text = file.trim() === '' ? '{}\n' : file;
    const plain = strict ? text : uncommented(text);
    let root: unknown;
    try {
      root = JSON.parse(strict ? text : withoutTrailingCommas(plain));
    } catch (e) {
      throw new Error(`not JSON: ${(e as Error).message}`, { cause: e });
    }
    if (!isObject(root)) throw new Error('not a JSON object');
    return { text, plain, root, open: spaceAfter(plain, 0) };
  }

  const listIn = (root: Record<string, unknown>, key: string) => {
    const list = root[key];
    if (list !== undefined && !isObject(list)) throw new Error(`"${key}" is not an object`);
    return list;
  };

  return {
    read: (file: string, key: string, name: string) => listIn(parsed(file).root, key)?.[name],

    write(file: string, key: string, name: string, entry: unknown) {
      const { text, plain, root, open } = parsed(file);
      listIn(root, key);
      const top = membersOf(plain, open);
      const first = top.members[0];
      const unit =
        (first && plain.slice(open + 1, first.start).includes('\n')
          ? lineIndent(plain, first.start)
          : '') || '  ';
      const line = `${JSON.stringify(name)}: ${oneLine(entry)}`;
      const list = top.members.findLast((m) => m.name === key);
      if (!list)
        return insert(
          text,
          plain,
          open,
          top,
          unit,
          (indent) => `${JSON.stringify(key)}: {\n${indent}${unit}${line}\n${indent}}`,
        );
      const inner = membersOf(plain, list.value);
      const have = inner.members.findLast((m) => m.name === name);
      return have
        ? splice(text, have.value, have.end, oneLine(entry))
        : insert(text, plain, list.value, inner, unit, () => line);
    },

    /** A list left empty stays: it is the user's, and only the entry is this tool's. */
    remove(file: string, key: string, name: string) {
      const { text, plain, open } = parsed(file);
      const list = membersOf(plain, open).members.findLast((m) => m.name === key);
      if (!list) return text;
      const inner = membersOf(plain, list.value);
      const i = inner.members.findLastIndex((m) => m.name === name);
      return i < 0 ? text : cut(text, list.value, inner, i);
    },
  };
}
