import { MODEL_VIEWER } from '../../site.ts';
import { playerOf } from './player.ts';
import type { Step } from './scenarios.ts';

// the 3D viewer comes once the page has loaded: until then each model shows its poster
addEventListener('load', () => {
  const viewer = document.createElement('script');
  viewer.type = 'module';
  viewer.src = MODEL_VIEWER.src;
  viewer.integrity = MODEL_VIEWER.integrity;
  viewer.crossOrigin = 'anonymous';
  setTimeout(() => document.head.append(viewer), 0);
});

/** What `Console.astro` leaves in the page for this script: each job's steps and the clock's words. */
export type ConsoleData = { jobs: Record<string, Step[]>; running: string; done: string };

const el = (id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the page has no #${id}`);
  return found;
};

const data = JSON.parse(el('console-data').textContent ?? '') as ConsoleData;
const out = el('out');
const phone = el('phone');
const chips = [...document.querySelectorAll<HTMLButtonElement>('[data-run]')];

const hop = () => {
  const dino = document.getElementById('dino');
  dino?.classList.add('hop');
  setTimeout(() => dino?.classList.remove('hop'), 350);
};

const { play, reset } = playerOf([phone], out, hop);

for (const chip of chips)
  chip.addEventListener('click', () => {
    void (async () => {
      for (const c of chips) {
        c.disabled = true;
        c.setAttribute('aria-pressed', String(c === chip));
      }
      reset();
      el('clock').textContent = data.running;
      try {
        for (const step of data.jobs[chip.dataset.run ?? ''] ?? []) await play(step);
      } finally {
        for (const c of chips) c.disabled = false;
        el('clock').textContent = data.done;
      }
    })();
  });

const copy = document.querySelector<HTMLButtonElement>('[data-copy]');
const words = copy?.textContent ?? '';
copy?.addEventListener('click', () => {
  const copied = () => {
    copy.textContent = copy.dataset.copied ?? words;
    setTimeout(() => (copy.textContent = words), 1400);
  };
  // with no clipboard to write to, the command is selected for the person to copy
  const select = () => {
    const range = document.createRange();
    if (copy.previousElementSibling) range.selectNodeContents(copy.previousElementSibling);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  };
  if (navigator.clipboard)
    navigator.clipboard.writeText(copy.dataset.copy ?? '').then(copied, select);
  else select();
});
