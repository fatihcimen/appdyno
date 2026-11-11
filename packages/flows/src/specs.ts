/** What a step's line may hold beside its action. */
export type Spec = {
  /** Words in order; `?` at the end of a name: may be left out. */
  words?: string[];
  /** Selectors, and x, y where `point` too: a target. `needed`: a step that has no meaning without one. */
  target?: 'optional' | 'needed' | 'point' | 'point-needed';
  text?: string[];
  number?: string[];
  bool?: string[];
  /** Keys that may repeat, each a string, kept in order. */
  list?: string[];
};

/** Each step of a flow's file, and the words and arguments its line takes. */
export const SPECS = {
  launch: { words: ['app?'], text: ['language'], list: ['arg', 'env'] },
  stop: { words: ['app?'] },
  tap: { target: 'point-needed' },
  long_press: { target: 'point-needed', number: ['durationMs'] },
  double_tap: { target: 'point-needed' },
  type: {
    words: ['text'],
    target: 'point',
    bool: ['replace', 'submit'],
  },
  press_key: { words: ['key'], number: ['count'] },
  swipe: {
    words: ['direction'],
    target: 'point',
    number: ['distance', 'durationMs'],
    bool: ['exact'],
  },
  scroll_to: { target: 'needed', text: ['direction'], number: ['maxSwipes'] },
  wait_for: { target: 'needed', bool: ['gone'], number: ['timeoutMs'] },
  assert: {
    target: 'needed',
    text: ['check', 'equals'],
    bool: ['expect'],
    number: ['timeoutMs'],
  },
  open_link: { words: ['url?'], text: ['settings'] },
  set_location: { words: ['lat', 'lon'] },
  alert: { words: ['answer'] },
  hide_keyboard: {},
  /** An action the format has no step for: replay stops here rather than go on without it. */
  unrecorded: { words: ['what'] },
  /** Another flow's steps go here: `composeFlow` replaces it before anything runs. */
  run: { words: ['file'] },
} as const satisfies Record<string, Spec>;
