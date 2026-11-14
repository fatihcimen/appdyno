import { must, type AppLink } from '@appdyno/core';

const VIEW = '"android.intent.action.VIEW"';

/** Each of a package's filters that opens a link, from `dumpsys package`: `scheme://host/path`, once each. */
export function linkFilters(dump: string): AppLink[] {
  const found = new Set<string>();
  // a filter is listed under each scheme it has: its lines follow its header, deeper in
  for (const block of dump.split(/\n(?=\s+[0-9a-f]+ \S+ filter [0-9a-f]+\s*$)/m).slice(1)) {
    const depth = (l: string) => l.length - l.trimStart().length;
    const [header = '', ...rest] = block.split('\n');
    const own = rest.filter((l) => depth(l) > depth(header));
    if (!own.some((l) => l.includes(VIEW))) continue;
    const of = (key: string) =>
      own.flatMap((l) => {
        const m = new RegExp(`^\\s*${key}: "([^"]*)"`).exec(l);
        return m ? [must(m[1], 'a value')] : [];
      });
    // a host given as `*.example.com` is listed without its `*`, and said WILD
    const hosts = own.flatMap((l) => {
      const m = /^\s*Authority: "([^"]*)": -?\d+( WILD)?/.exec(l);
      return m ? [`${m[2] ? '*' : ''}${must(m[1], 'a host')}`] : [];
    });
    // a glob, simple or advanced, matches the whole path as it is written, and may hold a `}` of its own
    const paths = own.flatMap((l) => {
      const m = /^\s*Path: "PatternMatcher\{(\w+): (.*)\}"\s*$/.exec(l);
      if (!m) return [];
      const path = must(m[2], 'a path');
      if (m[1] === 'PREFIX') return [path.endsWith('*') ? path : `${path}*`];
      return [m[1] === 'SUFFIX' ? `*${path}` : path];
    });
    for (const scheme of of('Scheme'))
      for (const host of hosts.length > 0 ? hosts : [''])
        for (const path of paths.length > 0 ? paths : ['']) found.add(`${scheme}://${host}${path}`);
  }
  return [...found].map((url) => ({ url, kind: 'filter' as const }));
}

/** The verification state of each App Link domain, from `pm get-app-links`. */
export function linkStates(out: string): AppLink[] {
  const after = out.split(/Domain verification state:\s*\n/)[1] ?? '';
  return [...after.matchAll(/^\s+([\w.*-]+): (\w+)\s*$/gm)].map((m) => ({
    url: `https://${must(m[1], 'a domain')}`,
    kind: 'domain' as const,
    state: must(m[2], 'a state'),
  }));
}

/** What an installed app says it opens: the filters of its activities, and its App Links as verified. */
export async function androidLinks(
  sh: (command: string) => Promise<string>,
  pkg: string,
): Promise<AppLink[]> {
  const filters = linkFilters(await sh(`dumpsys package ${pkg}`));
  // API 31+: older systems have no such command, and no states to read
  const states = linkStates(await sh(`pm get-app-links ${pkg}`));
  return [...filters, ...states];
}
