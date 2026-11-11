import { z } from 'zod';
import { Traversal } from './a11y.js';
import { Tree, WireNode } from './tree.js';

/**
 * The kinds of accessibility issue `audit` reports: the iOS platform audit's types; Android's checks use
 * the same names where they check the same thing, plus `imageContrast` and `duplicateLabel`.
 */
export const AUDIT_TYPES = [
  'contrast',
  'elementDetection',
  'hitRegion',
  'sufficientElementDescription',
  'dynamicType',
  'textClipped',
  'trait',
  'imageContrast',
  'duplicateLabel',
] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export const AuditIssue = z.object({
  type: z.enum(AUDIT_TYPES),
  /** The engine's own rule: `XCUIAccessibilityAuditType.contrast` (iOS), `android.textContrast`. */
  rule: z.string(),
  message: z.string(),
  /** The element's [left, top, right, bottom] in tap units; absent when the element is gone. */
  b: WireNode.shape.b.optional(),
  /** The element as a tree node names it: class or type, id, description (label), text. */
  element: z
    .object({
      c: z.string(),
      id: z.string().optional(),
      d: z.string().optional(),
      t: z.string().optional(),
    })
    .optional(),
});
export type AuditIssue = z.infer<typeof AuditIssue>;

export const AuditResult = z.object({
  /** `platform`: the iOS platform audit; `rules`: the host's checks of the tree and a screenshot. */
  engine: z.enum(['platform', 'rules']),
  issues: z.array(AuditIssue),
  /** More issues than `maxIssues`, or the time ran out. */
  truncated: z.boolean(),
  elapsedMs: z.number(),
  /** Android: the read the checks ran on, with the screen reader's traversal hints (its reading order). */
  read: z.object({ tree: Tree, traversal: z.array(Traversal) }).optional(),
});
export type AuditResult = z.infer<typeof AuditResult>;
