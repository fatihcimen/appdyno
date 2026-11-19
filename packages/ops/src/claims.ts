import { claim as take } from '@appdyno/core';
import { refused } from './tool.js';

export {
  calledOn,
  heldText,
  holder,
  PUT_BACK_TOOL,
  release,
  SHARE_BY_LIBRARY,
} from '@appdyno/core';

/** A device taken for this process, as core takes it: who holds it is said as a tool's refusal. */
export const claim = (...given: Parameters<typeof take>) => take(...given).catch(refused);
