import { shareOf } from './dials.ts';
import { lineOf, type Step } from './scenarios.ts';

const still = matchMedia('(prefers-reduced-motion: reduce)');
const wait = (ms: number) => new Promise((done) => setTimeout(done, still.matches ? 0 : ms));

/**
 * Plays steps on the demo's phone and writes their lines to its log. `hop` is what the page does
 * at a step that worked.
 */
export const playerOf = (phone: HTMLElement, out: HTMLElement, hop = () => {}) => {
  const part = (name: string) => phone.querySelector(`[data-part="${name}"]`);

  // the mark is the tapped element's own child, so it is in place at any size the phone is drawn
  const tapOn = (ref: string) => {
    const target = phone.querySelector(`[data-ref="${ref}"]`);
    const dot = document.createElement('span');
    dot.className = 'tapdot';
    (target?.querySelector('.add') ?? target)?.append(dot);
    setTimeout(() => dot.remove(), 600);
  };

  const play = async (step: Step) => {
    const line = lineOf(step);
    if (line !== undefined) out.innerHTML += `${line}\n`;
    if ('call' in step) await wait(500);
    else if ('tap' in step) {
      tapOn(step.tap);
      await wait(350);
    } else if ('text' in step) part(step.text[0])?.replaceChildren(step.text[1]);
    else if ('show' in step) part(step.show)?.classList.add('show');
    else if ('hide' in step) part(step.hide)?.classList.remove('show');
    else if ('reading' in step) phone.classList.toggle('reading', step.reading);
    else if ('gauge' in step) {
      const [id, value] = step.gauge;
      document.getElementById(`n-${id}`)?.style.setProperty('--share', String(shareOf(id, value)));
      document.getElementById(`v-${id}`)?.replaceChildren(String(value));
    } else if ('wait' in step) await wait(step.wait);
    else if ('hop' in step) hop();
  };

  /** The phone as the page first showed it, and an empty log. */
  const reset = () => {
    for (const kept of phone.querySelectorAll<HTMLElement>('[data-rest]'))
      kept.textContent = kept.dataset.rest ?? '';
    for (const shown of phone.querySelectorAll('.show')) shown.classList.remove('show');
    phone.classList.remove('reading');
    out.innerHTML = '';
  };

  return { play, reset };
};
