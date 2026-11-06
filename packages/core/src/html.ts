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

/** A page that loads nothing it did not bring: a policy allowing only `sources` and its own style, so no script unless they name it. */
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

/**
 * Colors by role, for every page: the hub's palette, as `packages/core/test/palette.test.ts` holds it. Dark is on screen only,
 * so that a page prints as ink on paper. `--s*` are the palette's tiles, which hold white words, and none is a state's colour.
 */
const COLORS = `:root{color-scheme:light dark;--surface:#fbfbff;--plane:#eef0ff;--ink:#12163a;--ink2:#434a78;--muted:#5f6692;--grid:#dcdff5;--axis:#bcc2e8;--edge:rgba(26,32,80,.1);--series:#2447e0;
--good:#0b7a3e;--warning:#8a4c00;--critical:#c4201a;--fold:#5f6692;--tip:#12163a;--tip-ink:#f4f6ff;--tip-ink2:#d0d6f2;
--s1:#3358f0;--s2:#7b3deb;--s3:#c92aa0;--s4:#0e86c9;--s5:#4a55d8;--s6:#9a35d0;--s7:#2a6fc9;--s8:#8a5ae0;--on4:#fff;
--b1:#a6b8ff;--b2:#d3afff;--b3:#ffb3d1;--b4:#a8deff}
@media screen and (prefers-color-scheme:dark){:root{--surface:#141a45;--plane:#0a0e2e;--ink:#f4f6ff;--ink2:#d0d6f2;--muted:#aab2dc;--grid:#262d5e;--axis:#3a4278;--edge:rgba(255,255,255,.13);--series:#7ea2ff;
--good:#3ee08f;--warning:#ffbe3d;--critical:#ff6b5e;--fold:#aab2dc;--tip:#f4f6ff;--tip-ink:#12163a;--tip-ink2:#434a78;
--b1:#1f3fd6;--b2:#5b1fc4;--b3:#b81c68;--b4:#0b6dbd}}`;

/** The hub's ground as a page wears it: fixed, so that it stands behind what scrolls. */
const GROUND = `body{background:radial-gradient(58vw 58vw at 100% 0,var(--b1),transparent 72%),radial-gradient(60vw 60vw at 0 100%,var(--b2),transparent 72%),radial-gradient(40vw 40vw at 96% 100%,var(--b3),transparent 70%),radial-gradient(34vw 34vw at 0 0,var(--b4),transparent 70%),var(--plane);background-attachment:fixed}`;

/** What a product's own pages share: colors, type, the bar across the top, a card. */
export const PAGE_BASE = `${COLORS}
${GROUND}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Inter,system-ui,sans-serif;margin:0;color:var(--ink);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
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
@media print{body{background:#fff}.bar{position:static;margin:0 0 1rem;padding:0 0 .5rem;background:none;-webkit-backdrop-filter:none;backdrop-filter:none}.card{box-shadow:none}}`;

export { PAGE_MARK, SERVER_ICON_SVG } from './mark.js';
