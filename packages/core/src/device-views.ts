import type { FrameworkLabel } from './framework-label.js';
import type { Rect } from './screen/elements.js';

/** One view of the app's own tree, as its toolkit holds it: the classes and places an accessibility tree leaves out. */
export type NativeView = {
  /** As the toolkit names it: `UILabel`, `android.widget.TextView`, a Swift class demangled where it can be. */
  class: string;
  /** On the screen, in tap units. */
  rect: Rect;
  /** iOS's accessibility identifier; Android's resource id, `pkg:id/name`. */
  id?: string;
  label?: string;
  /** What it shows as text: a label's, a field's, a button's title; never a secure field's. */
  text?: string;
  hidden?: boolean;
  /** 0 to 1, given where it is less than 1. */
  alpha?: number;
  /** The view controller or activity whose view it is: given at least where it differs from its parent's. */
  controller?: string;
  /** Index of its parent in `views`; none for a window's root. */
  parent?: number;
};

/** The app's views on the screen now, each with its parent's index. */
export type ViewTree = {
  views: NativeView[];
  /** What draws most of the content, where the device knows it by more than these views. */
  framework?: FrameworkLabel;
  /** A limit cut the walk short: views past it are not here. */
  truncated: boolean;
};
