import type { NetworkEntry } from '@appdyno/core';

/** A picture by its path: what an app loads most of, and reads least of when it looks for a fault. */
const IMAGE = /\.(png|jpe?g|gif|webp|heic|heif|avif|svg|ico|bmp)$/i;
/** Failed requests each have a line, to here: past it they are counted. */
const MAX_FAILED = 20;

/** Where a request went: its host, and its path with the names of its query and none of their values. */
function placeOf(url: string) {
  try {
    const u = new URL(url);
    const names = [...new Set(u.searchParams.keys())];
    return {
      host: u.host,
      path: `${u.pathname}${names.length > 0 ? `?${names.join('&')}` : ''}`,
      image: IMAGE.test(u.pathname),
    };
  } catch {
    return { host: '', path: url, image: false };
  }
}

const failed = (e: NetworkEntry) => !!e.error || (e.status ?? 0) >= 400;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const distinct = <T>(xs: T[]) => [...new Set(xs)];

/** A line of the list, and how many requests it stands for: a host's heading stands for none. */
export type ListLine = { text: string; requests: number };

/**
 * The requests of a capture as few lines as tell them apart, for a reader who pays for each: those that failed or
 * were refused first, each whole, as they are what a list is read for; then each host once, with under it each
 * method and path once, a query by its names, and the ones asked several times folded into one line with how many,
 * their statuses and their median time; pictures last, counted. `whole` writes a request's own line, and `mark` what
 * a rule did to it.
 */
export function compactList(
  entries: NetworkEntry[],
  whole: (e: NetworkEntry) => string,
  mark: (e: NetworkEntry) => string = () => '',
): ListLine[] {
  const bad = entries.filter(failed);
  const good = entries.filter((e) => !failed(e));
  const images = good.filter((e) => placeOf(e.url ?? '').image);
  const hosts = new Map<string, Map<string, NetworkEntry[]>>();
  for (const e of good) {
    const { host, path, image } = placeOf(e.url ?? '');
    if (image) continue;
    const paths = hosts.get(host) ?? new Map<string, NetworkEntry[]>();
    hosts.set(host, paths);
    const key = `${e.method ?? 'GET'} ${path}`;
    paths.set(key, [...(paths.get(key) ?? []), e]);
  }
  const how = (group: NetworkEntry[]) => {
    const all = distinct(group.map(mark));
    return all.length === 1 ? (all[0] ?? '') : '';
  };
  const one = (key: string, group: NetworkEntry[]): ListLine => {
    const [e] = group;
    const ids = group.flatMap((g) => (g.id === undefined ? [] : [g.id]));
    if (group.length === 1 && e)
      return {
        text: `  ${e.id === undefined ? '' : `${e.id} `}${key}${e.status ? ` ${e.status}` : ''}${e.ms !== undefined ? ` ${e.ms} ms` : ''}${e.bytes !== undefined ? ` ${e.bytes} B` : ''}${how(group)}`,
        requests: 1,
      };
    const statuses = distinct(group.flatMap((g) => (g.status ? [g.status] : []))).join('/');
    return {
      text: `  ${key} ×${group.length}${statuses ? ` ${statuses}` : ''} median ${median(group.map((g) => g.ms ?? 0))} ms${ids.length > 0 ? ` (ids ${Math.min(...ids)} to ${Math.max(...ids)})` : ''}${how(group)}`,
      requests: group.length,
    };
  };
  return [
    ...(bad.length > MAX_FAILED
      ? [
          {
            text: `! ${bad.length - MAX_FAILED} more failed before these: status failed, 4xx or 5xx lists them`,
            requests: bad.length - MAX_FAILED,
          },
        ]
      : []),
    ...bad.slice(-MAX_FAILED).map((e) => ({ text: `! ${whole(e)}`, requests: 1 })),
    ...[...hosts].flatMap(([host, paths]) => [
      { text: `${host}:`, requests: 0 },
      ...[...paths].map(([key, group]) => one(key, group)),
    ]),
    ...(images.length > 0
      ? [
          {
            text: `images: ${images.length} from ${distinct(images.map((e) => placeOf(e.url ?? '').host)).join(', ')}`,
            requests: images.length,
          },
        ]
      : []),
  ];
}
