import type { Parts } from './stage.ts';

/** Where a visitor's "rest" is kept, so the dragon stays at rest on the next visit. */
const KEY = 'appdyno:mascot';

const find = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const parts = {
  layer: find<HTMLElement>('.mascot-layer'),
  view: find<HTMLCanvasElement>('.mascot-view'),
  body: find<HTMLButtonElement>('.mascot-body'),
  still: find<HTMLElement>('.mascot-still'),
};
/** The buttons that send it to rest: one in a corner of the window, one at the page's foot. */
const rests = [...document.querySelectorAll<HTMLButtonElement>('.mascot-rest')];

const still = matchMedia('(prefers-reduced-motion: reduce)');
/** A visitor who asked for no motion or for less data gets the picture, and nothing is fetched. */
const mayMove = () =>
  !still.matches && !(navigator as { connection?: { saveData?: boolean } }).connection?.saveData;

// a browser may refuse the storage, as in a private window: the dragon then forgets, and still obeys
const resting = () => {
  try {
    return localStorage.getItem(KEY) === 'off';
  } catch {
    return false;
  }
};
const remember = (off: boolean) => {
  try {
    if (off) localStorage.setItem(KEY, 'off');
    else localStorage.removeItem(KEY);
  } catch {
    // nothing to keep it in
  }
};

/** Shows the buttons, or not, and what a press of one would do. */
const show = (shown: boolean, off = resting()) => {
  for (const rest of rests) {
    rest.hidden = !shown;
    rest.setAttribute('aria-pressed', String(off));
    rest.textContent = (off ? rest.dataset['wake'] : rest.dataset['rest']) ?? '';
  }
};

let scene: Promise<{ close: () => void } | undefined> | undefined;

/** Brings the scene, the one large script of the page: after the page has loaded, and only where it may move. */
const wake = () => {
  const { layer, view, body, still } = parts;
  if (scene || !layer || !view || !body || !still) return;
  const all: Parts = { layer, view, body, still };
  scene = import('./stage.ts')
    .then(({ open }) => open(all))
    // no WebGL, or a model that did not come: the picture stays, and there is nothing to send to rest
    .catch(() => {
      show(false);
      return undefined;
    });
};

const sleep = () => {
  void scene?.then((open) => open?.close());
  scene = undefined;
};

for (const rest of rests)
  rest.addEventListener('click', () => {
    const off = rest.getAttribute('aria-pressed') !== 'true';
    remember(off);
    show(true, off);
    if (off) sleep();
    else wake();
  });
still.addEventListener('change', () => {
  show(mayMove());
  if (!mayMove()) sleep();
  else if (!resting()) wake();
});

if (mayMove()) {
  show(true);
  const start = () => {
    if (resting() || !mayMove()) return;
    if ('requestIdleCallback' in window) requestIdleCallback(wake, { timeout: 2000 });
    else setTimeout(wake, 200);
  };
  if (document.readyState === 'complete') start();
  else addEventListener('load', start, { once: true });
}
