import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { NetworkDetail, NetworkEntry } from '@appdyno/core';
import { stepLine } from '@appdyno/flows';
import { defined } from './flow/shared.js';
import { fits, HAR_DIR, type Filter } from './network-answer.js';
import { fileInside, MAX_RULES } from './network-rules.js';
import type { Policy } from './policy.js';
import { ToolError } from './tool.js';
import { writeInside } from './writes.js';

/** A HAR read whole to make rules of: past this it is a proxy's session, and a part of it is what a run replays. */
const MAX_HAR_BYTES = 64 * 1024 * 1024;

/** An answer as it was given: what a rule that gives it again is made of. */
type Answered = {
  method: string;
  url: string;
  status: number;
  type?: string | undefined;
  body?: string | undefined;
};

/** Rules made of answers, each as its line, and what is to be known of them. */
export type Made = { lines: string[]; notes: string[] };

const slug = (text: string) =>
  text
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'root';

const extension = (type = '') =>
  /json/i.test(type) ? 'json' : /xml/i.test(type) ? 'xml' : /html/i.test(type) ? 'html' : 'txt';

/**
 * The line of a rule that answers a request as it was answered: by its method, host and path, with `query` its query
 * too, the answer's status and type, and its body in a file of that name, which the rule reads at each request.
 */
function ruleOf(
  policy: Policy,
  r: Answered,
  file: string,
  overwrite: boolean | undefined,
  query?: (u: URL) => string | undefined,
) {
  const u = new URL(r.url);
  const body =
    r.body === undefined || r.body === ''
      ? undefined
      : writeInside(policy, `${file}.${extension(r.type)}`, r.body, overwrite);
  return stepLine({
    action: 'mock',
    line: 0,
    flags: [],
    args: defined({
      request: `${u.host}${u.pathname}`,
      method: r.method === 'GET' ? undefined : r.method,
      query: query?.(u),
      status: r.status,
      type: r.type,
      body: body && `@${body}`,
    }),
  }).replace(/^mock /, '');
}

const typeOf = (headers: Record<string, string> = {}) =>
  Object.entries(headers).find(([name]) => /^content-type$/i.test(name))?.[1];

/**
 * A rule of one captured request's answer. Its body goes to a file cleaned as an answer is, so that a credential the
 * server sent is in no file of the project; one kept only in part makes no rule, as half an answer is none.
 */
export function ruleFromRequest(
  policy: Policy,
  e: NetworkEntry,
  d: NetworkDetail | undefined,
  clean: (text: string) => string,
  overwrite: boolean | undefined,
): Made {
  const id = e.id ?? 0;
  if (e.inFlight || !e.status || !e.url)
    throw new ToolError(`request ${id} got no answer to make a rule of`, 'INVALID_ARGUMENT');
  const body = d?.responseBody;
  const size = d?.responseBodySize ?? 0;
  if (body !== undefined && size > Buffer.byteLength(body))
    throw new ToolError(
      `request ${id} answered ${size} B and its first ${Buffer.byteLength(body)} were kept: half an answer makes no rule`,
      'UNSUPPORTED',
      'save the whole answer to a file and give a rule with body=@file',
    );
  const cleaned = body === undefined ? undefined : clean(body);
  const u = new URL(e.url);
  const line = ruleOf(
    policy,
    {
      method: e.method ?? 'GET',
      url: e.url,
      status: e.status,
      type: typeOf(d?.responseHeaders),
      body: cleaned,
    },
    join(HAR_DIR, `mock-${slug(`${u.host}${u.pathname}`)}-${id}`),
    overwrite,
  );
  return {
    lines: [line],
    notes: [
      ...(!d
        ? ['its body was not kept (start with bodies: true): the rule answers with none']
        : body === undefined && size > 0
          ? ['its body is no text and was not kept: the rule answers with none']
          : []),
      ...(cleaned !== body
        ? ['what names a credential in the body is hidden in the file (•••)']
        : []),
    ],
  };
}

type HarFile = {
  log?: {
    entries?: {
      request?: { method?: string; url?: string };
      response?: {
        status?: number;
        content?: { mimeType?: string; text?: string; encoding?: string };
      };
    }[];
  };
};

/** A HAR by the name a client gave: by a bare name it is where `save` puts one by a bare name. */
export function harFile(name: string) {
  const saved = join(HAR_DIR, name);
  return fileInside(!existsSync(resolve(name)) && existsSync(resolve(saved)) ? saved : name);
}

/**
 * A rule for each answer of a HAR file, the ones asked for where a part of an address, a method or a status narrows
 * them: a request asked twice is answered as it was last, and one asked with several queries has a rule for each. The
 * bodies go to a folder of the file's name, written again each time, as a flow that replays it runs more than once.
 */
export function rulesFromHar(
  policy: Policy,
  name: string,
  asked: Filter,
  clean: (text: string) => string,
): Made {
  const file = harFile(name);
  if (statSync(file).size > MAX_HAR_BYTES)
    throw new ToolError(
      `${file} is over ${MAX_HAR_BYTES / 1024 / 1024} MB: save the part to replay`,
      'UNSUPPORTED',
    );
  let har: HarFile;
  try {
    har = JSON.parse(readFileSync(file, 'utf8')) as HarFile;
  } catch (e) {
    throw new ToolError(`${file} is no HAR: ${(e as Error).message}`, 'INVALID_ARGUMENT');
  }
  let binary = 0;
  const last = new Map<string, Answered>();
  for (const { request, response } of har.log?.entries ?? []) {
    const r = {
      method: request?.method ?? 'GET',
      url: request?.url ?? '',
      status: response?.status ?? 0,
    };
    if (
      !/^https?:\/\//i.test(r.url) ||
      r.status < 100 ||
      !fits(r, { contains: asked.contains, method: asked.method, status: asked.status })
    )
      continue;
    const content = response?.content;
    const text = content?.encoding === undefined ? content?.text : undefined;
    if (content?.encoding !== undefined && content.text) binary++;
    const u = new URL(r.url);
    last.set(`${r.method} ${u.host}${u.pathname}${u.search}`, {
      ...r,
      type: content?.mimeType,
      body: text,
    });
  }
  if (last.size === 0)
    throw new ToolError(
      `${file} has no answered request${(asked.contains ?? asked.method ?? asked.status) ? ' that fits' : ''}`,
      'NOT_FOUND',
    );
  if (last.size > MAX_RULES)
    throw new ToolError(
      `${file} has ${last.size} different requests, and a capture holds ${MAX_RULES} rules: contains, method or status narrows them`,
      'INVALID_ARGUMENT',
    );
  const place = (r: Answered) => `${r.method} ${new URL(r.url).host}${new URL(r.url).pathname}`;
  // one asked with a query before the same with none, whose rule would take them all
  const all = [...last.values()].sort(
    (a, b) => new URL(b.url).search.length - new URL(a.url).search.length,
  );
  const dir = join(HAR_DIR, slug(basename(file).replace(/\.har$/i, '')));
  // the pairs of a query that tell one request from another, less any that names a credential: a rule's line is read
  // by whoever lists the rules
  const told = (u: URL) =>
    [...u.searchParams]
      .filter(([k, v]) => clean(`${k}=${v}`) === `${k}=${v}`)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&') || undefined;
  const lines = all.map((r, i) =>
    ruleOf(
      policy,
      r,
      join(dir, `${i + 1}-${slug(new URL(r.url).pathname)}`),
      true,
      all.filter((o) => place(o) === place(r)).length > 1 ? told : undefined,
    ),
  );
  return {
    lines,
    notes: [
      `${lines.length} ${lines.length === 1 ? 'rule' : 'rules'} from ${file}, their bodies in ${dir}`,
      ...(binary > 0 ? [`${binary} bodies are no text: those rules answer with none`] : []),
      ...(all.some((r) => r.body?.includes('•••'))
        ? ['what was hidden when it was saved (•••) is answered as it is written']
        : []),
    ],
  };
}
