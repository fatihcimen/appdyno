import { playerOf } from './player.ts';
import type { Step } from './scenarios.ts';

/** What `Story.astro` leaves in the page for this script: each scene's steps. */
export type StoryData = Record<string, Step[]>;

// with nothing to tell where the page is scrolled, it stays as it came: every section and step plain
if ('IntersectionObserver' in window) {
  // a section rises as it comes into view, from dimmed and never from nothing
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.add('rises');
    const seen = new IntersectionObserver(
      (hits) => {
        for (const hit of hits.filter((hit) => hit.isIntersecting)) {
          hit.target.classList.add('in');
          seen.unobserve(hit.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    for (const section of document.querySelectorAll('.reveal')) seen.observe(section);
  }

  // the story: a scene plays on the phones as its step reaches the middle of the window
  const story = document.getElementById('story');
  const log = document.getElementById('story-log');
  const data = document.getElementById('story-data')?.textContent;
  if (story && log && data) {
    const scenes = JSON.parse(data) as StoryData;
    const steps = [...story.querySelectorAll<HTMLElement>('[data-scene]')];
    const { play, reset } = playerOf([...story.querySelectorAll<HTMLElement>('.phone')], log);
    let turn = 0;
    let playing = '';
    const enter = async (scene: string) => {
      const mine = ++turn;
      playing = scene;
      for (const step of steps) step.classList.toggle('on', step.dataset.scene === scene);
      reset();
      for (const step of scenes[scene] ?? []) {
        // a newer scene has the phones now
        if (mine !== turn) return;
        await play(step);
      }
    };
    story.classList.add('playing');
    const middle = new IntersectionObserver(
      (hits) => {
        for (const hit of hits) {
          const scene = (hit.target as HTMLElement).dataset.scene;
          if (hit.isIntersecting && scene && scene !== playing) void enter(scene);
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    for (const step of steps) middle.observe(step);
  }
}
