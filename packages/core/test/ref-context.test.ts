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
});
