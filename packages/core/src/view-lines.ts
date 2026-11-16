import type { NativeView, ViewTree } from './device-views.js';
import { must } from './must.js';
import { asName, onLine, quoted } from './screen/diff.js';
import { cutAt, idOf } from './screen/model.js';

/** At most this many lines of views in an answer: the rest is counted. */
export const MAX_VIEW_LINES = 300;
const MAX_WORDS = 80;

/** A class as a line shows it: a generic's arguments, which run to hundreds of characters in SwiftUI's, left out. */
const shortClass = (cls: string) => {
  const at = cls.indexOf('<');
  return onLine(at > 0 ? `${cls.slice(0, at)}<…>` : cls);
};

const drawn = (v: NativeView) =>
  !v.hidden && (v.alpha ?? 1) > 0 && v.rect.width > 0 && v.rect.height > 0;
const wordless = (v: NativeView) => !v.id && !v.label && !v.text;

/**
 * What a line says of the last view of its run: its id (an Android one by its name, as a screen's lines say it), its
 * words (the label, else the text, and a text that differs from the label after it), its place in tap units, how clear
 * it is and its flags.
 */
function described(v: NativeView, clean: (s: string) => string) {
  const label = v.label && cutAt(clean(v.label), MAX_WORDS);
  const text = v.text && cutAt(clean(v.text), MAX_WORDS);
  const words = label || text;
  const id = idOf(v.id);
  const { x, y, width, height } = v.rect;
  return [
    ...(id ? [`#${asName(clean(id))}`] : []),
    ...(words ? [quoted(words)] : []),
    ...(label && text && text !== label ? [`text ${quoted(text)}`] : []),
    `${Math.round(x)},${Math.round(y)} ${Math.round(width)}x${Math.round(height)}`,
    ...(v.alpha !== undefined && v.alpha < 1 ? [`alpha ${v.alpha.toFixed(2)}`] : []),
    ...(v.flags ?? []),
  ].join(' ');
}

/**
 * The views as lines, each a space further in than its parent's. A view with one child and no words of its own is joined
 * to it by `>`, a controller named where it changes; what is not drawn is left out with what it holds. `clean` takes a
 * view's id and words as an answer does, before they are cut.
 */
export function viewLines(tree: ViewTree, clean: (s: string) => string, max = MAX_VIEW_LINES) {
  const at = (i: number) => must(tree.views[i], 'a view of the tree');
  const kids = new Map<number, number[]>();
  tree.views.forEach((v, i) => {
    if (v.parent !== undefined) kids.set(v.parent, [...(kids.get(v.parent) ?? []), i]);
  });
  const shown = (i: number) => (kids.get(i) ?? []).filter((k) => drawn(at(k)));
  const lines: string[] = [];
  let placed = 0;
  let drawnAll = 0;
  const walk = (start: number, depth: number, owner: string | undefined) => {
    const run = [start];
    let last = start;
    for (let next = shown(last); next.length === 1 && wordless(at(last)); next = shown(last)) {
      last = must(next[0], 'the one child');
      run.push(last);
    }
    drawnAll += run.length;
    let held = owner;
    const names = run.map((i) => {
      const { class: cls, controller } = at(i);
      const changed = controller !== undefined && controller !== held;
      held = controller ?? held;
      return changed ? `${shortClass(cls)} (${shortClass(controller)})` : shortClass(cls);
    });
    if (lines.length < max) {
      lines.push(`${' '.repeat(depth)}${names.join(' > ')} ${described(at(last), clean)}`);
      placed += run.length;
    }
    for (const k of shown(last)) walk(k, depth + 1, held);
  };
  tree.views.forEach((v, i) => {
    if (v.parent === undefined && drawn(v)) walk(i, 0, undefined);
  });
  if (drawnAll > placed) lines.push(`… ${drawnAll - placed} more views past these ${max} lines`);
  if (tree.truncated)
    lines.push('the device cut the tree short: views past its limit are not here');
  return lines;
}
