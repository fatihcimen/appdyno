import { fold, type Rect, type Screen, type WebPage } from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { checkApp, redactLog } from './policy.js';
import { WebOut } from './schemas.js';
import type { Session } from './session.js';
import { defineOp, DESTRUCTIVE, reply, ToolError } from './tool.js';

const MAX_ELEMENTS = 200;
const MAX_ANSWER = 20_000;

export type WebElement = {
  tag: string;
  text: string;
  selector?: string;
  role?: string;
  x: number;
  y: number;
  w: number;
  h: number;
};
type Dom = { title: string; url: string; width: number; elements: WebElement[] };

/** What a person or a script can use on the page: controls, and text with no element under it. */
const READ_DOM = `(() => {
  const controls = /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/;
  const out = [];
  for (const e of document.querySelectorAll('a,button,input,select,textarea,[role],[onclick],h1,h2,h3,h4,h5,h6,p,li,label,span,td,th,img[alt]')) {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const s = getComputedStyle(e);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    const control = controls.test(e.tagName) || e.hasAttribute('role') || e.hasAttribute('onclick');
    if (!control && e.children.length > 0) continue;
    const value = e.type === 'password' ? '' : e.value;
    const text = (e.getAttribute('aria-label') || e.innerText || value || e.placeholder || e.alt || '').trim().slice(0, 80);
    if (!text && !control) continue;
    // no key at all for what it lacks: WebKit's inspector sends an undefined as null
    const role = e.getAttribute('role');
    out.push({ tag: e.tagName.toLowerCase(), text, ...(role && { role }),
      ...(e.id && { selector: '#' + CSS.escape(e.id) }), x: r.left, y: r.top, w: r.width, h: r.height });
    if (out.length >= ${MAX_ELEMENTS}) break;
  }
  return { title: document.title, url: location.href, width: innerWidth, elements: out };
})()`;

const CLICK = (selector: string) => `(() => {
  const e = document.querySelector(${JSON.stringify(selector)});
  if (!e) return null;
  e.scrollIntoView({ block: 'center' });
  e.click();
  return { tag: e.tagName.toLowerCase(), text: (e.innerText || e.value || '').trim().slice(0, 80) };
})()`;

const endsInWebView = (type: string) => /web.?view$/i.test(type.slice(type.lastIndexOf('.') + 1));

/** Where a web view stands on the screen, for a page's coordinates in tap units. */
function webViewRect(screen: Screen): Rect | undefined {
  return screen.elements.find((e) => e.rect && endsInWebView(e.type))?.rect;
}

/** A page's elements in tap units: on the screen, when the web view shows on it. */
function placed(dom: Dom, view: Rect | undefined) {
  const k = view && dom.width > 0 ? view.width / dom.width : undefined;
  return dom.elements.map((e) => ({
    ...e,
    ...(k && view
      ? { x: Math.round(view.x + (e.x + e.w / 2) * k), y: Math.round(view.y + (e.y + e.h / 2) * k) }
      : { x: Math.round(e.x + e.w / 2), y: Math.round(e.y + e.h / 2) }),
  }));
}

const quoted = (s: string) => JSON.stringify(s);

/**
 * A screen with a web view gets what its page holds and the accessibility tree does not show, marked as
 * web: tap goes by x,y, and `webview` by selector. Undefined when it cannot be read: not debuggable.
 */
export async function webLines(
  s: Session,
  screen: Screen,
  clean: (t: string) => string,
): Promise<string | undefined> {
  const web = s.device.web;
  const view = webViewRect(screen);
  if (!web || !view) return undefined;
  const pages = await web.pages(s.appId).catch(() => [] as WebPage[]);
  const page = pages.find((p) => p.visible) ?? pages[0];
  if (!page) return undefined;
  const dom = (await web.evaluate(page, READ_DOM).catch(() => undefined)) as Dom | undefined;
  if (!dom) return undefined;
  const known = screen.list.map((e) => fold(e.label));
  const ids = new Set(screen.list.map((e) => e.id && `#${e.id}`));
  const more = placed(dom, view)
    .filter(
      (e) => !ids.has(e.selector) && (!e.text || !known.some((k) => k.includes(fold(e.text)))),
    )
    .map(
      (e) =>
        `web ${e.role ?? e.tag} ${quoted(clean(e.text))} ${e.x},${e.y}${e.selector ? ` ${e.selector}` : ''}`,
    );
  return more.length > 0 ? `not in the accessibility tree:\n${more.join('\n')}` : undefined;
}

export function webOps(ctx: ServerContext) {
  const clean = (t: string) => redactLog(ctx.policy, t);

  const inspector = (s: Session) => {
    if (!s.device.web)
      throw new ToolError(
        "this device's web views cannot be inspected from here: read them with screen",
        'UNSUPPORTED',
      );
    return s.device.web;
  };

  /** The page asked for, else the one showing; an app that has none says what that means. */
  const pageOf = async (s: Session, app: string | undefined, wanted: string | undefined) => {
    const pages = await inspector(s).pages(app);
    const hits = wanted
      ? pages.filter((p) => p.id === wanted || p.title.includes(wanted) || p.url.includes(wanted))
      : pages;
    const page = hits.find((p) => p.visible) ?? hits[0];
    if (!page)
      throw new ToolError(
        `no web page to inspect${app ? ` in ${app}` : ''}: an app's web view shows here only while it is on the screen and the app is debuggable, or set its debugging on`,
        'NOT_FOUND',
      );
    return page;
  };

  return [
    defineOp({
      name: 'webview',
      title: 'Web views',
      description:
        "Inside a debuggable app's web view. pages; elements (the DOM, at tap coordinates); click (selector: CSS); eval (js). page: id or part of a title or URL.",
      input: z
        .object({
          action: z.enum(['pages', 'elements', 'click', 'eval']),
          page: z.string().max(500).optional(),
          selector: z.string().max(500).optional(),
          js: z.string().max(10_000).optional(),
          app: z.string().max(200).optional(),
        })
        .strict(),
      output: WebOut,
      annotations: DESTRUCTIVE,
      run: async ({ action, page, selector, js, app }) => {
        const s = await ctx.session();
        const target = checkApp(ctx.policy, app ?? s.appId ?? '') || undefined;
        if (action === 'pages') {
          const pages = await inspector(s).pages(target);
          const t =
            pages
              .map(
                (p) =>
                  `${p.id} ${quoted(clean(p.title))} ${clean(p.url)}${p.app ? ` in ${p.app}` : ''}${p.visible ? ' (showing)' : ''}`,
              )
              .join('\n') ||
            `no web page to inspect${target ? ` in ${target}` : ''}: its web view must be showing and the app debuggable`;
          return reply(t, { done: t, pages });
        }
        const on = await pageOf(s, target, page);
        const web = inspector(s);
        if (action === 'elements') {
          const dom = (await web.evaluate(on, READ_DOM)) as Dom;
          const list = placed(dom, webViewRect(await s.current())).map((e) => ({
            ...e,
            text: clean(e.text),
          }));
          const head = `${quoted(clean(dom.title))} ${clean(dom.url)}: ${list.length} elements (${list.length >= MAX_ELEMENTS ? 'more not shown; ' : ''}tag or role "label" x,y selector)`;
          const lines = list.map(
            (e) =>
              `${e.role ?? e.tag} ${quoted(e.text)} ${e.x},${e.y}${e.selector ? ` ${e.selector}` : ''}`,
          );
          return reply([head, ...lines].join('\n'), {
            page: on.id,
            elements: list,
          });
        }
        if (action === 'click') {
          if (!selector)
            throw new ToolError('click needs selector: a CSS selector', 'INVALID_ARGUMENT');
          const hit = (await web.evaluate(on, CLICK(selector))) as {
            tag: string;
            text: string;
          } | null;
          if (!hit) throw new ToolError(`nothing on the page matches ${selector}`, 'NOT_FOUND');
          s.acted();
          const t = `clicked ${hit.tag} ${quoted(clean(hit.text))}`;
          return reply(t, { done: t, page: on.id });
        }
        if (!js) throw new ToolError('eval needs js', 'INVALID_ARGUMENT');
        const value = await web.evaluate(on, js);
        s.acted();
        const t = clean(value === undefined ? 'undefined' : JSON.stringify(value)).slice(
          0,
          MAX_ANSWER,
        );
        return reply(t, { done: t, page: on.id });
      },
    }),
  ];
}
