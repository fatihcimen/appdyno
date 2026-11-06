import { plistUid, readBplist, uidOf, writeBplist, type Plist } from '../webinspector.js';

/** What a keyed archive can carry here: strings, numbers, data, lists and dictionaries. */
export type Archived =
  string | number | boolean | Buffer | null | Archived[] | { [k: string]: Archived };

export function archive(root: Archived): Buffer {
  const objects: Plist[] = ['$null'];
  const classOf = (...names: string[]) => {
    objects.push({ $classname: names[0]!, $classes: [...names, 'NSObject'] });
    return plistUid(objects.length - 1);
  };
  const put = (v: Archived): Plist => {
    if (v === null) return plistUid(0);
    if (typeof v !== 'object') {
      objects.push(v);
      return plistUid(objects.length - 1);
    }
    const at = objects.length;
    objects.push(null);
    if (Buffer.isBuffer(v)) {
      objects[at] = { 'NS.data': v, $class: classOf('NSMutableData', 'NSData') };
    } else if (Array.isArray(v)) {
      objects[at] = { 'NS.objects': v.map(put), $class: classOf('NSMutableArray', 'NSArray') };
    } else {
      const names = Object.keys(v);
      const keys = names.map(put);
      const values = names.map((n) => put(v[n]!));
      objects[at] = {
        'NS.keys': keys,
        'NS.objects': values,
        $class: classOf('NSMutableDictionary', 'NSDictionary'),
      };
    }
    return plistUid(at);
  };
  const top = { root: put(root) };
  return writeBplist({
    $version: 100000,
    $archiver: 'NSKeyedArchiver',
    $top: top,
    $objects: objects,
  });
}

/** What of an archived value has keys: the rest is a value of its own, a list or bytes. */
export const isDict = <T extends Plist | Archived>(
  v: T | undefined,
): v is Extract<T, { [k: string]: unknown }> =>
  !!v && typeof v === 'object' && !Buffer.isBuffer(v) && !Array.isArray(v);

/** An archive as plain values: an object of any other class comes as its fields. */
export function unarchive(bytes: Buffer): Archived {
  const whole = readBplist(bytes);
  if (!isDict(whole) || !isDict(whole.$top) || !Array.isArray(whole.$objects))
    throw new Error('not a keyed archive');
  const objects = whole.$objects;
  const value = (ref: Plist): Archived => {
    const uid = uidOf(ref);
    const v = uid === undefined ? ref : objects[uid];
    if (v === undefined || v === '$null') return null;
    if (!isDict(v) || uidOf(v) !== undefined) return v as Archived;
    const list = v['NS.objects'];
    const keys = v['NS.keys'];
    if (Array.isArray(keys) && Array.isArray(list)) {
      return Object.fromEntries(keys.map((k, i) => [String(value(k)), value(list[i]!)]));
    }
    if (Array.isArray(list)) return list.map(value);
    if ('NS.data' in v) return value(v['NS.data']!);
    if ('NS.string' in v) return value(v['NS.string']!);
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => k !== '$class')
        .map(([k, x]) => [k, value(x)]),
    );
  };
  return value(whole.$top.root!);
}
