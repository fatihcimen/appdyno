/** A place in a JSON value: a key of an object, or the index of an array's element. */
export type PathKey = string | number;

/**
 * What a body must hold: `text` as it is written, somewhere in it; and where the words are `path=value`, as
 * `data.items[0].name=Tea`, the value at that path of a body that is JSON. A body that is no JSON has no paths, and is
 * searched for the text as written, so `name=Grace` finds a form's field too.
 */
export type BodyMatch = { text: string; path?: PathKey[]; equals?: string };

const KEY = String.raw`[\w$-]+`;
const PATH = new RegExp(String.raw`^(?:${KEY}|\[\d+\])(?:\.${KEY}|\[\d+\])*$`);

/** A path's keys in order, `data.items[0].price` as `data`, `items`, 0, `price`; none where the words are no path. */
export function pathKeys(path: string): PathKey[] | undefined {
  if (!PATH.test(path)) return undefined;
  return [...path.matchAll(new RegExp(String.raw`\[(\d+)\]|(${KEY})`, 'g'))].map((m) =>
    m[1] === undefined ? String(m[2]) : Number(m[1]),
  );
}

/** The words of a `has=` as what they ask of a body. */
export function bodyMatch(has: string): BodyMatch {
  const at = has.indexOf('=');
  const path = at > 0 ? pathKeys(has.slice(0, at)) : undefined;
  return path ? { text: has, path, equals: has.slice(at + 1) } : { text: has };
}

/** The value at a path of a JSON value; nothing where the path leads nowhere. */
export function valueAt(json: unknown, path: PathKey[]): unknown {
  let at = json;
  for (const key of path) {
    if (at === null || typeof at !== 'object') return undefined;
    at = Array.isArray(at)
      ? typeof key === 'number'
        ? (at as unknown[])[key]
        : undefined
      : Object.hasOwn(at, String(key))
        ? (at as Record<string, unknown>)[String(key)]
        : undefined;
  }
  return at;
}

/** A value as the words of a match name it: a text as it is, anything else as JSON writes it. */
export const valueText = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

/** A body read as JSON; nothing where it is none. */
export function jsonOf(body: string | undefined): { value: unknown } | undefined {
  if (body === undefined) return undefined;
  try {
    return { value: JSON.parse(body) as unknown };
  } catch {
    return undefined;
  }
}

/** Whether a body holds what was asked of it. */
export function bodyHas(body: string | undefined, m: BodyMatch): boolean {
  if (body === undefined) return false;
  const json = m.path ? jsonOf(body) : undefined;
  if (!json || !m.path) return body.includes(m.text);
  const found = valueAt(json.value, m.path);
  return found !== undefined && valueText(found) === m.equals;
}
