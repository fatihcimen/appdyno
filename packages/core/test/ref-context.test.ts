import { describe, expect, it } from 'vitest';
import { screenElements, withStableRefs, type UiElement } from '../src/screen/index.js';
import { plainScreen } from './plain-screen.js';

const android = { port: plainScreen };
const node = (
  ref: string,
  parent: number | undefined,
  [x, y, width, height]: [number, number, number, number],
  more: Partial<UiElement> = {},
): UiElement => ({
  type: 'android.widget.FrameLayout',
  ref,
  ...(parent !== undefined && { parent }),
  rect: { x, y, width, height },
  ...more,
});

describe('what tells like elements apart', () => {
  it('is never the words of an element hidden, or of no size, beside them', () => {
    // a gallery's grid and its fast scroller, whose thumb is 0x0 and hidden until the grid scrolls
    const cells = [0, 1, 2].map((i) =>
      node(`n${3 + i}`, 2, [i * 360, 300, 360, 360], {
        identifier: 'dev.app:id/media_item_holder',
        clickable: true,
      }),
    );
    const els = [
      node('n0', undefined, [0, 0, 1080, 2400]),
      node('n1', 0, [0, 300, 1080, 2100]),
      node('n2', 1, [0, 300, 1080, 2100], { type: 'androidx.recyclerview.widget.RecyclerView' }),
      ...cells,
      node('n6', 1, [1046, 353, 0, 0], { type: 'android.widget.ImageView', label: 'handleImage' }),
      node('n7', 1, [0, 700, 1080, 50], {
        type: 'android.widget.TextView',
        text: 'Scrolling',
        visible: false,
      }),
    ];
    const listed = screenElements(withStableRefs(els, android), android).filter(
      (e) => e.id === 'media_item_holder',
    );
    expect(listed.map((e) => e.refContext)).toEqual([undefined, undefined, undefined]);
  });

  it('is the name of their own row, which the row says twice: as itself and in a button inside', () => {
    // a settings page of toggles: each row a switch of its name, holding a button of that name and a switch "0"
    const rows = ['Bold Text', 'Show Borders', 'More Contrast'].flatMap((name, k) => {
      const y = 100 + k * 60;
      const at = 3 + k * 3;
      return [
        node(`n${at}`, 2, [36, y, 330, 28], { type: 'Switch', label: name, clickable: true }),
        node(`n${at + 1}`, at, [36, y + 4, 100, 20], { type: 'Button', label: name }),
        node(`n${at + 2}`, at, [305, y, 63, 28], { type: 'Switch', label: '0', clickable: true }),
      ];
    });
    const els = [
      node('n0', undefined, [0, 0, 402, 874]),
      node('n1', 0, [0, 0, 402, 874]),
      node('n2', 1, [0, 60, 402, 800], { type: 'Table' }),
      ...rows,
      node('n12', 2, [36, 300, 86, 20], { type: 'StaticText', label: 'Larger Text' }),
    ];
    const knobs = screenElements(withStableRefs(els, android), android).filter(
      (e) => e.label === '0',
    );
    expect(knobs.map((e) => e.refContext)).toEqual(['Bold Text', 'Show Borders', 'More Contrast']);
    // each its own ref, with no place in a row of likes that a change of one would move
    expect(knobs.every((e) => /^@\w+$/.test(e.ref))).toBe(true);
    expect(new Set(knobs.map((e) => e.ref)).size).toBe(3);
  });
});
