import { GAUGE } from '../mascot/signals.ts';
import { turn } from './dials.ts';
import { lineOf, type Step } from './scenarios.ts';

const still = matchMedia('(prefers-reduced-motion: reduce)');
const wait = (ms: number) => new Promise((done) => setTimeout(done, still.matches ? 0 : ms));

/**
 * Plays steps on the phones of one stage and writes their lines to its log. The steps go to the
 * first phone until one asks for the next, and `hop` is what the stage does at a step that worked.
 */
export const playerOf = (phones: HTMLElement[], out: HTMLElement, hop = () => {}) => {
  let phone = phones[0];
  const part = (name: string) => phone?.querySelector(`[data-part="${name}"]`);

  // the mark is the tapped element's own child, so it is in place at any size the phone is drawn
  const tapOn = (ref: string) => {
    const target = phone?.querySelector(`[data-ref="${ref}"]`);
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
    else if ('reading' in step) phone?.classList.toggle('reading', step.reading);
    else if ('gauge' in step) {
      const [id, label, share] = step.gauge;
      document.getElementById(`n-${id}`)?.style.setProperty('transform', turn(share));
      document.getElementById(`v-${id}`)?.replaceChildren(label);
      // the dragon runs to a gauge a number is sent to, if it is on the page
      document.dispatchEvent(new CustomEvent(GAUGE, { detail: id }));
    } else if ('wait' in step) await wait(step.wait);
    else if ('next' in step) {
      phone = phones[1];
      phone?.classList.remove('idle');
    } else if ('hop' in step) hop();
  };

  /** The phones as the page first showed them, the ones after the first waiting, and an empty log. */
  const reset = () => {
    phone = phones[0];
    for (const [i, one] of phones.entries()) {
      for (const kept of one.querySelectorAll<HTMLElement>('[data-rest]'))
        kept.textContent = kept.dataset.rest ?? '';
      for (const shown of one.querySelectorAll('.show')) shown.classList.remove('show');
      one.classList.remove('reading');
      one.classList.toggle('idle', i > 0);
    }
    out.innerHTML = '';
  };

  return { play, reset };
};
