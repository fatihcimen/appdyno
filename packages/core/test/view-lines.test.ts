import { describe, expect, it } from 'vitest';
import { viewLines, type NativeView } from '../src/index.js';

const view = (cls: string, parent?: number, more: Partial<NativeView> = {}): NativeView => ({
  class: cls,
  rect: { x: 0, y: 0, width: 390, height: 844 },
  ...(parent !== undefined && { parent }),
  ...more,
});
const plain = (s: string) => s;

describe('the native views as lines', () => {
  it('joins a run of wrappers with no words to the view they hold, and sets each child a space in', () => {
    const views = [
      view('UIWindow'),
      view('UITransitionView', 0),
      view('UIView', 1, { controller: 'HomeController' }),
      view('UILabel', 2, {
        id: 'title',
        text: 'Orders',
        rect: { x: 16, y: 100.4, width: 200, height: 21 },
      }),
      view('UIButton', 2, {
        label: 'Pay',
        text: 'Pay now',
        rect: { x: 16, y: 700, width: 358, height: 44 },
      }),
    ];
    expect(viewLines({ views, truncated: false }, plain)).toEqual([
      'UIWindow > UITransitionView > UIView (HomeController) 0,0 390x844',
      ' UILabel #title "Orders" 16,100 200x21',
      ' UIButton "Pay" text "Pay now" 16,700 358x44',
    ]);
  });

  it('leaves out what is not drawn, with all it holds, and says how clear a faint view is', () => {
    const views = [
      view('UIWindow', undefined, { label: 'root' }),
      view('UIView', 0, { hidden: true }),
      view('UILabel', 1, { text: 'under a hidden view' }),
      view('UIView', 0, { alpha: 0 }),
      view('UIView', 0, { rect: { x: 0, y: 0, width: 0, height: 10 } }),
      view('UILabel', 0, { text: 'faint', alpha: 0.4 }),
    ];
    expect(viewLines({ views, truncated: false }, plain)).toEqual([
      'UIWindow "root" 0,0 390x844',
      ' UILabel "faint" 0,0 390x844 alpha 0.40',
    ]);
  });

  it("names a controller only where it changes, and shortens a generic's arguments", () => {
    const hosting =
      'SwiftUI._UIHostingView<SwiftUI.ModifiedContent<SwiftUI.AnyView, SwiftUI.RootModifier>>';
    const views = [
      view('UIWindow', undefined, { id: 'w' }),
      view(hosting, 0, { controller: 'SwiftUI.UIHostingController<SwiftUI.AnyView>', id: 'h' }),
      view('UIView', 1, { controller: 'SwiftUI.UIHostingController<SwiftUI.AnyView>', id: 'x' }),
    ];
    expect(viewLines({ views, truncated: false }, plain)).toEqual([
      'UIWindow #w 0,0 390x844',
      ' SwiftUI._UIHostingView<…> (SwiftUI.UIHostingController<…>) #h 0,0 390x844',
      '  UIView #x 0,0 390x844',
    ]);
  });

  it('cleans the words first, then cuts what runs long', () => {
    const views = [view('UILabel', undefined, { text: `token=abc ${'a'.repeat(100)}` })];
    const [line] = viewLines({ views, truncated: false }, (s) => s.replace('abc', '***'));
    expect(line).toBe(`UILabel "token=*** ${'a'.repeat(69)}…" 0,0 390x844`);
  });

  it('counts the views past its lines, and says the device cut the tree short', () => {
    const views = [
      view('UIWindow', undefined, { id: 'w' }),
      ...Array.from({ length: 5 }, () => view('UILabel', 0, { text: 'row' })),
    ];
    expect(viewLines({ views, truncated: true }, plain, 3)).toEqual([
      'UIWindow #w 0,0 390x844',
      ' UILabel "row" 0,0 390x844',
      ' UILabel "row" 0,0 390x844',
      '… 3 more views past these 3 lines',
      'the device cut the tree short: views past its limit are not here',
    ]);
  });

  it("says an Android id by its name, as a screen's lines do, and the flags after the place", () => {
    const at = (x: number, y: number) => ({ x, y, width: 1016, height: 126 });
    const views = [
      view('android.widget.FrameLayout', undefined, { id: 'android:id/content' }),
      view('android.widget.Button', 0, {
        id: 'dev.app:id/submit',
        rect: at(32, 922),
        flags: ['clickable', 'focused'],
      }),
      view('android.widget.Button', 0, { rect: at(32, 1048), flags: ['clickable', 'disabled'] }),
    ];
    expect(viewLines({ views, truncated: false }, plain)).toEqual([
      'android.widget.FrameLayout #content 0,0 390x844',
      ' android.widget.Button #submit 32,922 1016x126 clickable focused',
      ' android.widget.Button 32,1048 1016x126 clickable disabled',
    ]);
  });
});
