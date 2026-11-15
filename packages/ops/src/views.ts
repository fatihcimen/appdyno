import { frameworkOfViews, NoViewProbe, viewLines, type FrameworkLabel } from '@appdyno/core';
import type { Session } from './session.js';
import { reply, ToolError } from './tool.js';

/** A framework as an answer names it: `UIKit inside SwiftUI`. */
export const frameworkSaid = (l: FrameworkLabel) =>
  l.inside ? `${l.name} inside ${l.inside}` : l.name;

/**
 * `screen views`: the app's native views, folded into lines under the framework that draws most of them, and what the
 * device says of how to read them after; `raw` gives each view as data too, its id and words cleaned as the lines' are.
 */
export async function readViews(s: Session, clean: (t: string) => string, raw: boolean) {
  if (!s.device.views)
    throw new ToolError(
      'this device gives no native view hierarchy',
      'UNSUPPORTED',
      'screen without views reads its accessibility tree',
    );
  const tree = await s.device.views().catch((e: unknown) => {
    if (e instanceof NoViewProbe)
      throw new ToolError(e.message, e.code, 'launch_app restart:true probe:true puts it in');
    throw e;
  });
  const framework = frameworkOfViews(tree, s.device.platform);
  const said = framework && frameworkSaid(framework);
  const lines = viewLines(tree, clean);
  const notes = (tree.notes ?? []).map(clean);
  return reply([said ? `framework: ${said}` : 'no view is drawn', ...lines, ...notes].join('\n'), {
    elements: tree.views.length,
    warnings: notes,
    ...(said && { framework: said }),
    ...(raw && {
      views: tree.views.map(({ label, text, id, ...v }) => ({
        ...v,
        ...(id !== undefined && { id: clean(id) }),
        ...(label !== undefined && { label: clean(label) }),
        ...(text !== undefined && { text: clean(text) }),
      })),
    }),
  });
}
