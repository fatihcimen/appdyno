import { PAGE_BASE, selfContainedPage } from '@appdyno/core';

const STYLE = `${PAGE_BASE}
main{max-width:1040px;margin:auto;padding:0 2rem 5rem}
.who{font-size:1.75rem;font-weight:700;letter-spacing:-.022em;margin:0}.facts{color:var(--ink2);margin:.35rem 0 0}
.note{color:var(--ink2);font-size:.86rem}.bad{color:var(--critical)}
h2{font-size:.78rem;letter-spacing:.05em;text-transform:uppercase;color:var(--ink2);font-weight:600;margin:2.5rem 0 .75rem}
h3{font-size:1rem;margin:0 0 .5rem;display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}h3 span{font-size:.8rem;font-weight:400}
.n{display:inline-grid;place-items:center;min-width:1.5rem;height:1.5rem;padding:0 .3rem;border-radius:999px;background:var(--edge);font-size:.76rem;font-weight:600}
.step{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1.25rem;margin-bottom:.9rem}.step.failed{border-color:var(--critical)}
.step:not(:has(>img)){grid-template-columns:minmax(0,1fr)}
pre{white-space:pre-wrap;word-break:break-word}
img,video{max-height:24rem;max-width:100%;border-radius:14px;display:block;box-shadow:0 1px 2px rgba(0,0,0,.08),0 10px 24px -14px rgba(0,0,0,.35)}
summary{cursor:pointer;font-size:.85rem;color:var(--ink2)}
@media (max-width:720px){main{padding:0 1rem 2rem}.step{grid-template-columns:minmax(0,1fr)}}`;

/** A report as one file, its styles in it. */
export const reportPage = (title: string, body: string) =>
  selfContainedPage({
    title,
    body: `<main>${body}</main>`,
    style: STYLE,
    sources: "img-src 'self' file:; media-src 'self' file:; ",
  });
