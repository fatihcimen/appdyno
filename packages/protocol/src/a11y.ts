import { z } from 'zod';

/** Android `a11y.read`: a text node's characters and how many of them are not shown (cut or ellipsized). */
export const TextClip = z.object({
  n: z.number().int(),
  chars: z.number().int(),
  hidden: z.number().int(),
});
export type TextClip = z.infer<typeof TextClip>;
/** Android `a11y.read`: a node's traversal hints as node indices (a screen reader reads `n` before `before`, after `after`). */
export const Traversal = z.object({
  n: z.number().int(),
  before: z.number().int().optional(),
  after: z.number().int().optional(),
});
export type Traversal = z.infer<typeof Traversal>;
