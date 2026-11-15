import type { Parts } from './stage.ts';

/** Where a visitor's "rest" is kept, so the dragon stays at rest on the next visit. */
const KEY = 'appdyno:mascot';

const find = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const parts = {
  bench: find<HTMLElement>('.bench'),
  stage: find<HTMLElement>('.bench .stage'),
  layer: find<HTMLElement>('.mascot-layer'),
  view: find<HTMLCanvasElement>('.mascot-view'),
  body: find<HTMLButtonElement>('.mascot-body'),
  dyno: find<HTMLElement>('.stage img.dyno'),
  rig: find<HTMLElement>('.stage img.rig'),
};
/** The buttons that send it to rest: one on the bench, one at the page's foot, for when it is far from the bench. */
const rests = [...document.querySelectorAll<HTMLButtonElement>('.mascot-rest')];

const still = matchMedia('(prefers-reduced-motion: reduce)');
/** A visitor who asked for no motion or for less data gets the pictures, and nothing is fetched. */
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
  const { bench, stage, layer, view, body, dyno, rig } = parts;
  if (scene || !bench || !stage || !layer || !view || !body || !dyno || !rig) return;
  const all: Parts = { bench, stage, layer, view, body, posters: { dyno, bench: rig } };
  scene = import('./stage.ts')
    .then(({ open }) => open(all))
    // no WebGL, or a model that did not come: the pictures stay, and there is nothing to send to rest
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
