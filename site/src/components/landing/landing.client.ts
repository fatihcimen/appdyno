import { GAUGE, HOP } from '../mascot/signals.ts';
import { playerOf } from './player.ts';
import type { Step } from './scenarios.ts';

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

// the dragon hears a step that worked and a number sent to a dial of the bench, if it is on the page
const tell = (name: string, detail?: string) =>
  document.dispatchEvent(new CustomEvent(name, { detail }));
const { play, reset } = playerOf([phone], out, () => tell(HOP));

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
        for (const step of data.jobs[chip.dataset.run ?? ''] ?? []) {
          await play(step);
          if ('gauge' in step) tell(GAUGE, step.gauge[0]);
        }
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
