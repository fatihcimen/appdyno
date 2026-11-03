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
