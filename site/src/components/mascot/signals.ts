/**
 * What the console tells the dragon, as events on the document: the two scripts know these names
 * and nothing else of each other, so the console runs the same with no dragon on the page.
 */

/** A number is on its way to a gauge. The event's detail is the gauge's id. */
export const GAUGE = 'appdyno:gauge';
/** A step of a job went well. */
export const HOP = 'appdyno:hop';
