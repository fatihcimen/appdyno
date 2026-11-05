/**
 * The icon as vector and nothing else: a device cut by the curve a dyno pull draws.
 * Every picture the project shows comes from here, through scripts/build-icons.mjs.
 *
 * Two drawings of one idea. From 128 px up, a device on a red body. At 64 px and below that closes into
 * a ring of red and reads as a letter, so the body itself becomes the device, cut by the same curve.
 */

const RED = '#DE3222';
const INK = '#17181E';
/** The mark's upper part: light enough to hold on a dark background, where ink would vanish. */
const SLATE = '#3A3C46';
const WHITE = '#FFFFFF';

const SVG = 'xmlns="http://www.w3.org/2000/svg"';
const n = (v) => +v.toFixed(2);

/** A continuous corner. At r = 217 on an 824 body it fits a Mac's own icons to within a pixel. */
function rounded(x, y, w, h, r) {
  const [a, b, c, d, e, f, g] = [
    1.528665, 1.08849, 0.86841, 0.63149, 0.07491, 0.37282, 0.16906,
  ].map((v) => v * r);
  const X = x + w;
  const Y = y + h;
  const P = (...v) => v.map(n).join(' ');
  return [
    `M${P(x + a, y)}H${n(X - a)}C${P(X - b, y, X - c, y, X - d, y + e)}`,
    `C${P(X - f, y + g, X - g, y + f, X - e, y + d)}C${P(X, y + c, X, y + b, X, y + a)}`,
    `V${n(Y - a)}C${P(X, Y - b, X, Y - c, X - e, Y - d)}`,
    `C${P(X - g, Y - f, X - f, Y - g, X - d, Y - e)}C${P(X - c, Y, X - b, Y, X - a, Y)}`,
    `H${n(x + a)}C${P(x + b, Y, x + c, Y, x + d, Y - e)}`,
    `C${P(x + f, Y - g, x + g, Y - f, x + e, Y - d)}C${P(x, Y - c, x, Y - b, x, Y - a)}`,
    `V${n(y + a)}C${P(x, y + b, x, y + c, x + e, y + d)}`,
    `C${P(x + g, y + f, x + f, y + g, x + d, y + e)}C${P(x + c, y, x + b, y, x + a, y)}Z`,
  ].join('');
}

const gradient = (id, stops, attributes = 'x1="0" y1="0" x2="0" y2="1"') =>
  `<linearGradient id="${id}" ${attributes}>${stops
    .map(
      ([at, color, alpha = 1]) =>
        `<stop offset="${at}" stop-color="${color}" stop-opacity="${alpha}"/>`,
    )
    .join('')}</linearGradient>`;

const FULL = '<rect width="1024" height="1024" fill="url(#';

/** The large drawing: a device on a red body. */
const SLAB = rounded(262, 128, 500, 768, 112);
const PULL = 'M250 770C390 770 450 660 520 500C580 366 650 300 790 292';
const UNDER_PULL = `${PULL}L790 930L250 930Z`;

function large() {
  const defs =
    gradient('body', [
      [0, '#FF6A4D'],
      [0.55, RED],
      [1, '#A8160E'],
    ]) +
    gradient('sky', [
      [0, WHITE, 0.2],
      [0.55, WHITE, 0],
    ]) +
    gradient('light', [
      [0, WHITE, 1],
      [0.45, WHITE, 0.15],
      [1, WHITE, 0],
    ]) +
    gradient('slab', [
      [0, '#2A2C33'],
      [1, '#0B0C10'],
    ]) +
    gradient('fill', [
      [0, WHITE],
      [1, '#DDE7F3'],
    ]) +
    '<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>' +
    `<clipPath id="in"><path d="${SLAB}"/></clipPath>`;
  return (
    `<defs>${defs}</defs>${FULL}body)"/>${FULL}sky)"/>` +
    `<path d="${SLAB}" transform="translate(0 18)" fill="#000" opacity=".46" filter="url(#soft)"/>` +
    `<path d="${SLAB}" fill="url(#slab)"/>` +
    `<path d="${SLAB}" fill="none" stroke="url(#light)" stroke-width="8" clip-path="url(#in)" opacity=".28"/>` +
    `<path d="${UNDER_PULL}" fill="url(#fill)" clip-path="url(#in)"/>`
  );
}

/** The small drawing: the curve across the whole body, heavier as the pixels get fewer. */
const CUT = 'M-20 700C260 700 380 610 480 450C570 310 680 262 1044 256';
const RIBBON = { 64: 54, 32: 72, 16: 96 };

const small = (px) =>
  `<defs>${gradient('up', [
    [0, '#4A4C57'],
    [1, '#1E1F26'],
  ])}</defs>${FULL}up)"/>` +
  `<path d="${CUT}L1044 1044L-20 1044Z" fill="${RED}"/>` +
  `<path d="${CUT}" fill="none" stroke="${WHITE}" stroke-width="${RIBBON[px]}"/>`;

/** The body on a Mac's canvas, as this Mac's own icons have it: 824 at an inset of 100. */
const BODY = rounded(100, 100, 824, 824, 217);
const IN_BODY = 'translate(100 100) scale(.8046875)';

/** Drawn at exactly `px`, never scaled from a bigger picture. */
export function macIcon(px) {
  const large_ = px > 64;
  const shadow = large_
    ? `<path d="${BODY}" transform="translate(0 12)" fill="#000" opacity=".3" filter="url(#drop)"/>`
    : '';
  const rim = large_
    ? `<path d="${BODY}" fill="none" stroke="url(#rim)" stroke-width="6" clip-path="url(#mask)"/>`
    : '';
  return (
    `<svg ${SVG} width="${px}" height="${px}" viewBox="0 0 1024 1024"><defs>` +
    `<clipPath id="mask"><path d="${BODY}"/></clipPath>` +
    '<filter id="drop" x="-10%" y="-10%" width="120%" height="125%"><feGaussianBlur stdDeviation="16"/></filter>' +
    gradient('rim', [
      [0, WHITE, 0.55],
      [0.5, WHITE, 0.08],
      [1, WHITE, 0.2],
    ]) +
    `</defs>${shadow}<g clip-path="url(#mask)"><g transform="${IN_BODY}">` +
    `${large_ ? large() : small(px)}</g></g>${rim}</svg>`
  );
}

/** Full bleed: iOS masks it. */
export const iosIcon = (px) =>
  `<svg ${SVG} width="${px}" height="${px}" viewBox="0 0 1024 1024">${large()}</svg>`;

/** The curve as two closed parts with a gap, so a mark needs no mask and works in any colour. */
const upper = (r, gap) =>
  `M0 ${700 - gap}C260 ${700 - gap} 380 ${610 - gap} 480 ${450 - gap}C570 ${310 - gap} 680 ${262 - gap} 1024 ${256 - gap}` +
  `V${r}A${r} ${r} 0 0 0 ${1024 - r} 0H${r}A${r} ${r} 0 0 0 0 ${r}Z`;
const lower = (r, gap) =>
  `M0 ${700 + gap}C260 ${700 + gap} 380 ${610 + gap} 480 ${450 + gap}C570 ${310 + gap} 680 ${262 + gap} 1024 ${256 + gap}` +
  `V${1024 - r}A${r} ${r} 0 0 1 ${1024 - r} 1024H${r}A${r} ${r} 0 0 1 0 ${1024 - r}Z`;
const MARK_UPPER = upper(240, 66);
const MARK_LOWER = lower(240, 66);

const mark = (top, bottom, attributes = '') =>
  `<svg ${attributes}viewBox="0 0 1024 1024"><path d="${MARK_UPPER}" fill="${top}"/><path d="${MARK_LOWER}" fill="${bottom}"/></svg>`;

/** The menu bar's glyph: only its shape counts, as a template image. */
export const menuGlyph = (px) =>
  mark('#000', '#000', `${SVG} width="${px}" height="${px}" `).replace(
    'viewBox="0 0 1024 1024"',
    'viewBox="-48 -48 1120 1120"',
  );

/** Follows the page's ink, so it holds in light and in dark, and on paper. */
export const PAGE_MARK = mark('currentColor', RED, 'class="mark" aria-hidden="true" ');
/** Stands alone, so it brings its own colours. */
export const SERVER_ICON = mark(SLATE, RED, `${SVG} `);

/** Letters from a ring and a stem, so that a logo depends on no font. */
function wordmark(x, baseline, height, stroke) {
  const r = height / 2;
  const width = height * 0.2;
  const top = baseline - height;
  const middle = baseline - r;
  const reach = height * 0.62;
  const ring = (at) => `<circle cx="${n(at + r)}" cy="${n(middle)}" r="${n(r - width / 2)}"/>`;
  const line = (d) => `<path d="${d}"/>`;
  const letters = {
    a: (at) => ring(at) + line(`M${n(at + height - width / 2)} ${n(top + width / 2)}V${baseline}`),
    p: (at) =>
      ring(at) + line(`M${n(at + width / 2)} ${n(top + width / 2)}V${n(baseline + reach)}`),
    d: (at) => ring(at) + line(`M${n(at + height - width / 2)} ${n(top - reach)}V${baseline}`),
    y: (at) =>
      line(`M${n(at + width / 2)} ${n(top + width / 2)}L${n(at + r)} ${baseline}`) +
      line(
        `M${n(at + height - width / 2)} ${n(top + width / 2)}L${n(at + height * 0.25)} ${n(baseline + reach)}`,
      ),
    n: (at) =>
      line(
        `M${n(at + width / 2)} ${baseline}V${n(middle)}a${n(r - width / 2)} ${n(r - width / 2)} 0 0 1 ${n(height - width)} 0V${baseline}`,
      ),
    o: ring,
  };
  const advance = height + height * 0.28;
  const drawn = [...'appdyno'].map((letter, i) => letters[letter](x + i * advance)).join('');
  return {
    width: 7 * advance - height * 0.28,
    svg: `<g class="word" fill="none" stroke="${stroke}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round">${drawn}</g>`,
  };
}

/** For the README: a dark page gets light letters, and the mark holds on both. */
export function logo() {
  const word = wordmark(176, 134, 76, '#0B0B0B');
  const width = Math.ceil(176 + word.width + 8);
  return (
    `<svg ${SVG} width="${width}" height="192" viewBox="0 0 ${width} 192" role="img" aria-label="appdyno">` +
    '<style>@media (prefers-color-scheme:dark){.word{stroke:#F0EFEC}.up{fill:#5A5C67}}</style>' +
    `<g transform="translate(16 36) scale(.1171875)"><path class="up" d="${MARK_UPPER}" fill="${SLATE}"/><path d="${MARK_LOWER}" fill="${RED}"/></g>` +
    `${word.svg}</svg>\n`
  );
}

/** A repository's preview, 1280 by 640. */
export function social() {
  const word = wordmark(470, 318, 84, '#F0EFEC');
  return (
    `<svg ${SVG} width="1280" height="640" viewBox="0 0 1280 640"><rect width="1280" height="640" fill="#0D0D10"/>` +
    `<g transform="translate(70 140) scale(.3515625)">${macIcon(1024).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>` +
    `${word.svg}<text x="470" y="436" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="42" fill="#C3C2B7">Real numbers from a real device.</text></svg>\n`
  );
}

const layer = (body) =>
  `<svg ${SVG} width="1024" height="1024" viewBox="0 0 1024 1024">${body}</svg>\n`;

/** The fixture's launcher, in Android's vector form: no picture to go stale. */
const androidArt = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="1024"
    android:viewportHeight="1024">
    <path android:fillColor="${SLATE}" android:pathData="M0 0H1024V1024H0Z" />
    <path android:fillColor="${RED}" android:pathData="${CUT}L1044 1044L-20 1044Z" />
    <path android:strokeColor="${WHITE}" android:strokeWidth="${RIBBON[16]}" android:pathData="${CUT}" />
</vector>
`;

/** Every generated text in the repository, by path, so that a test can hold them to this file. */
export const GENERATED = {
  'docs/images/logo.svg': logo(),
  'app/appdyno.icon/Assets/slab.svg': layer(`<path d="${SLAB}" fill="${INK}"/>`),
  'app/appdyno.icon/Assets/curve.svg': layer(
    `<defs><clipPath id="in"><path d="${SLAB}"/></clipPath></defs><path d="${UNDER_PULL}" fill="${WHITE}" clip-path="url(#in)"/>`,
  ),
  'app/appdyno.icon/icon.json': `${JSON.stringify(
    {
      fill: {
        'linear-gradient': [
          'extended-srgb:1.00000,0.41600,0.30200,1.00000',
          'extended-srgb:0.65900,0.08600,0.05500,1.00000',
        ],
        orientation: { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: 1 } },
      },
      groups: [
        {
          layers: [{ 'image-name': 'curve.svg', name: 'curve', glass: true }],
          shadow: { kind: 'neutral', opacity: 0.4 },
          translucency: { enabled: true, value: 0.2 },
        },
        {
          layers: [{ 'image-name': 'slab.svg', name: 'slab', glass: true }],
          shadow: { kind: 'neutral', opacity: 0.5 },
          translucency: { enabled: false, value: 0.5 },
        },
      ],
      'supported-platforms': { squares: ['macOS'] },
    },
    null,
    2,
  )}\n`,
  'android/fixture/src/main/res/drawable/ic_launcher_art.xml': androidArt,
  'android/fixture/src/main/res/drawable/ic_launcher.xml': `<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android" android:drawable="@drawable/ic_launcher_art" />
`,
  'android/fixture/src/main/res/drawable-anydpi-v26/ic_launcher.xml': `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_art" />
    <foreground android:drawable="@android:color/transparent" />
</adaptive-icon>
`,
  'packages/core/src/mark.ts': `// Generated by scripts/build-icons.mjs from scripts/icon-art.mjs.

/** The mark every page shows: drawn inline, as a page loads nothing. */
export const PAGE_MARK =
  '${PAGE_MARK}';

/** The mark on its own, as a client shows it for the server. */
export const SERVER_ICON_SVG =
  '${SERVER_ICON}';
`,
};
