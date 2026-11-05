/** Every text a page shows from a device or a store goes through this: a label could hold anything. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// XML 1.0 has no form for most control characters, not even as a reference
// eslint-disable-next-line no-control-regex
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/** A text or an attribute's value in XML. */
export const xmlText = (s: string) =>
  s
    .replace(NOT_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A page that loads nothing it did not bring: no script, and a policy allowing only `sources` and its own style. */
export const selfContainedPage = (p: {
  title: string;
  style: string;
  body: string;
  /** Directives beyond the default, each ending in `; `. */
  sources?: string;
  head?: string;
}) =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${p.sources ?? ''}style-src 'unsafe-inline'">
${p.head ?? ''}<title>${esc(p.title)}</title><style>${p.style}</style></head>
<body>${p.body}</body></html>\n`;

/** Colors by role, for every page; dark is on screen only, so that a page prints as ink on paper. */
const COLORS = `:root{color-scheme:light dark;--surface:#fcfcfb;--plane:#f9f9f7;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--edge:rgba(11,11,11,.1);--series:#2a78d6;
--good:#0ca30c;--warning:#fab219;--critical:#d03b3b;--fold:#898781;--tip:#0b0b0b;--tip-ink:#f0efec;--tip-ink2:#c3c2b7;
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--s6:#008300;--s7:#6250d6;--s8:#e34948;--on4:#0b0b0b}
@media screen and (prefers-color-scheme:dark){:root{--surface:#1a1a19;--plane:#0d0d0d;--ink:#f0efec;--ink2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;--edge:rgba(255,255,255,.1);--series:#3987e5;--tip:#f0efec;--tip-ink:#0b0b0b;--tip-ink2:#52514e;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#008300;--s7:#9085e9;--s8:#e66767;--on4:#fff}}`;

/** What a product's own pages share: colors, type, the bar across the top, a card. */
export const PAGE_BASE = `${COLORS}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Inter,system-ui,sans-serif;margin:0;background:var(--plane);color:var(--ink);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:inherit;text-decoration-color:var(--axis);text-underline-offset:.18em}a:hover{text-decoration-color:currentColor}
h1,h2,h3,h4{line-height:1.2;letter-spacing:-.012em;margin:0;font-weight:650}
pre{font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--surface);border:1px solid var(--edge);border-radius:10px;padding:.75rem .9rem;overflow-x:auto;margin:.6rem 0}
.bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:.3rem 1.25rem;align-items:center;padding:.8rem max(2rem,calc((100vw - 1240px)/2));margin:0 calc(50% - 50vw) 2.25rem;background:color-mix(in srgb,var(--plane) 80%,transparent);-webkit-backdrop-filter:saturate(180%) blur(18px);backdrop-filter:saturate(180%) blur(18px);border-bottom:1px solid var(--edge)}
.bar h1{display:flex;align-items:center;gap:.5rem;font-size:1.02rem;letter-spacing:-.01em}.bar h1 span{color:var(--muted);font-weight:500}
.mark{width:22px;height:22px;flex:none}
.bar nav{display:flex;flex-wrap:wrap;gap:.25rem}.bar nav a{padding:.16rem .65rem;border-radius:999px;font-size:.84rem;text-decoration:none;color:var(--ink2)}.bar nav a:hover{background:var(--edge);color:var(--ink)}
.bar .m{margin-left:auto}
.card{background:var(--surface);border:1px solid var(--edge);border-radius:14px;padding:1.15rem 1.3rem;box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 28px -22px rgba(0,0,0,.28)}
.m{color:var(--ink2);font-size:.8rem;font-weight:400;font-variant-numeric:tabular-nums}
@media screen and (max-width:720px){.bar{padding:.7rem 1rem}.bar .m{margin-left:0}}
@media print{.bar{position:static;margin:0 0 1rem;padding:0 0 .5rem;background:none;-webkit-backdrop-filter:none;backdrop-filter:none}.card{box-shadow:none}}`;

/** A phone with a pulse on it: drawn here, and the only picture a page has of its own. */
export const PAGE_MARK = `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="1.5" width="13" height="21" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 13h2.2l1.4-4 2 6.5 1.3-2.5H16" fill="none" stroke="var(--series)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
