import type { AppLink } from '@appdyno/core';

const VIEW = '"android.intent.action.VIEW"';

/** Each of a package's filters that opens a link, from `dumpsys package`: `scheme://host/path`, once each. */
export function linkFilters(dump: string): AppLink[] {
  const found = new Set<string>();
  // a filter is listed under each scheme it has: its lines follow its header, deeper in
  for (const block of dump.split(/\n(?=\s+[0-9a-f]+ \S+ filter [0-9a-f]+\s*$)/m).slice(1)) {
    const lines = block.split('\n');
    const indent = /^\s*/.exec(lines[0]!)![0].length;
    const own = lines.slice(1).filter((l) => /^\s*/.exec(l)![0].length > indent);
    if (!own.some((l) => l.includes(VIEW))) continue;
    const of = (key: string) =>
      own.flatMap((l) => {
        const m = new RegExp(`^\\s*${key}: "([^"]*)"`).exec(l);
        return m ? [m[1]!] : [];
      });
    const paths = own.flatMap((l) => {
      const m = /^\s*Path: "PatternMatcher\{(\w+): ([^}]*)\}"/.exec(l);
      return m ? [m[1] === 'LITERAL' ? m[2]! : `${m[2]}*`] : [];
    });
    for (const scheme of of('Scheme'))
      for (const host of of('Authority').length > 0 ? of('Authority') : [''])
        for (const path of paths.length > 0 ? paths : ['']) found.add(`${scheme}://${host}${path}`);
  }
  return [...found].map((url) => ({ url, kind: 'filter' as const }));
}

/** The verification state of each App Link domain, from `pm get-app-links`. */
export function linkStates(out: string): AppLink[] {
  const after = out.split(/Domain verification state:\s*\n/)[1] ?? '';
  return [...after.matchAll(/^\s+([\w.*-]+): (\w+)\s*$/gm)].map((m) => ({
    url: `https://${m[1]}`,
    kind: 'domain' as const,
    state: m[2]!,
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
