import { MODEL_VIEWER } from '../../site.ts';
import { turn } from './dials.ts';
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

const still = matchMedia('(prefers-reduced-motion: reduce)');
const wait = (ms: number) => new Promise((done) => setTimeout(done, still.matches ? 0 : ms));

const data = JSON.parse(el('console-data').textContent ?? '') as ConsoleData;
const out = el('out');
const phone = el('phone');
const chips = [...document.querySelectorAll<HTMLButtonElement>('[data-run]')];

const say = (html: string) => {
  out.innerHTML += `${html}\n`;
};

const tapOn = (target: Element) => {
  const p = phone.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  const dot = document.createElement('span');
  dot.className = 'tapdot';
  dot.style.left = `${r.left - p.left + r.width / 2}px`;
  dot.style.top = `${r.top - p.top + r.height / 2}px`;
  phone.appendChild(dot);
  setTimeout(() => dot.remove(), 600);
};

const hop = () => {
  const dino = document.getElementById('dino');
  dino?.classList.add('hop');
  setTimeout(() => dino?.classList.remove('hop'), 350);
};

const play = async (step: Step) => {
  if ('say' in step) say(step.say);
  else if ('call' in step) {
    say(
      `<span class="k">→ ${step.call}</span>${step.args ? ` ${step.args}` : ''}  <span class="t">${step.took}</span>`,
    );
    await wait(500);
  } else if ('tap' in step) {
    const target = phone.querySelector(`[data-ref="${step.tap}"]`);
    if (target) tapOn(target.querySelector('.add') ?? target);
    await wait(350);
  } else if ('text' in step) el(step.text[0]).textContent = step.text[1];
  else if ('show' in step) el(step.show).classList.add('show');
  else if ('hide' in step) el(step.hide).classList.remove('show');
  else if ('reading' in step) phone.classList.toggle('reading', step.reading);
  else if ('gauge' in step) {
    const [id, label, share] = step.gauge;
    el(`n-${id}`).style.transform = turn(share);
    el(`v-${id}`).textContent = label;
  } else if ('wait' in step) await wait(step.wait);
  else hop();
};

/** The phone as the page first showed it. */
const reset = () => {
  for (const kept of document.querySelectorAll<HTMLElement>('[data-rest]'))
    kept.textContent = kept.dataset.rest ?? '';
  for (const shown of phone.querySelectorAll('.show')) shown.classList.remove('show');
  phone.classList.remove('reading');
  out.innerHTML = '';
};

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
