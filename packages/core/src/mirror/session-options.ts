import type { Mirror, MirrorOptions } from './port.js';
import type { MirrorClock, MirrorStatus } from './state.js';
import type { ViewerMessage, ViewerStart } from './viewer.js';

export type MirrorSessionOptions = {
  mirror: Mirror;
  viewer: ViewerStart;
  options: MirrorOptions;
  title: string;
  /** The person's input is not passed on, and the viewer sends none. */
  noInput?: boolean;
  /** The keyboard, at the first attach and no other: a reconnect or a new viewer never takes it. */
  focus?: boolean;
  /** What a person does goes nowhere until they click it: a window an agent opened. */
  inputOnClick?: boolean;
  clock?: MirrorClock;
  onChange?: (s: MirrorStatus) => void;
  /** A person answered a banner. */
  onDone?: (id: string) => void;
  /** How the window draws this device; a viewer that has none draws its own plain frame. */
  look?: Record<string, unknown>;
  /** A press of what is more than one key to the device; `false` leaves it to the device. */
  press?: (name: string) => boolean;
  /** A control of the window that is no input: a capture, the Apps pane. */
  onWindow?: (m: ViewerMessage) => void;
};
