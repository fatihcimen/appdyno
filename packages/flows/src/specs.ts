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
  /** `probe`: with the view probe in the app, as `launch_app` puts it in. */
  launch: { words: ['app?'], text: ['language'], list: ['arg', 'env'], bool: ['probe'] },
  /** `background`: ended as the system ends an app in the background, its saved state kept. */
  stop: { words: ['app?'], bool: ['background'] },
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
  /** A picture of the screen, kept as `name`.png where the run keeps what it saves. */
  screenshot: { words: ['name'] },
  /** The screen against the baseline of that name, in the `baselines` folder beside the flow's file. */
  visual: { words: ['name'], number: ['tolerance'], list: ['mask'] },
  /** A device setting, as `device_setting` takes it; `setting restore` puts back what was changed. */
  setting: { words: ['name', 'value?'], text: ['app', 'title'] },
  /**
   * A rule for the app's requests, as `network` `mock` takes one: `host/path` with `*`, then what it does. With no
   * request, `from` makes rules of a HAR file's answers and `unmatched=fail` fails what no rule takes. All of it holds
   * until the file ends.
   */
  mock: {
    words: ['request?'],
    text: ['method', 'query', 'regex', 'type', 'body', 'fail', 'to', 'from', 'unmatched'],
    number: ['status', 'delayMs', 'times'],
    list: ['header', 'has', 'when'],
    bool: ['off'],
  },
  /**
   * `network strict`: from here a step fails when a request of the app's got a 5xx or failed on its way, and no rule
   * made it; `network strict off` ends that. It holds until the file ends.
   */
  network: { words: ['name', 'value?'] },
  /**
   * The app made a request, as `network` `check` waits for one: by a part of its address, its method, its status and
   * what its body holds. It looks only at requests since the run began.
   */
  request: { words: ['part?'], text: ['method', 'status', 'has'], number: ['timeoutMs'] },
  /** An action the format has no step for: replay stops here rather than go on without it. */
  unrecorded: { words: ['what'] },
  /** Another flow's steps go here: `composeFlow` replaces it before anything runs. */
  run: { words: ['file'] },
} as const satisfies Record<string, Spec>;
