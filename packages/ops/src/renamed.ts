/**
 * The names tools had before 1.3.0, each with what takes its place. Nothing runs under one of them: a call by an old
 * name is refused, and its hint says the name to call. A model that learned the old names elsewhere reads it once.
 */
const RENAMED: Record<string, string> = {
  device_info: 'list_devices with selected: true',
  set_orientation: 'set_device with name orientation',
  set_location: 'set_device with name location',
  clipboard: 'set_device with name clipboard',
  device_setting: 'set_device; photos into the gallery: transfer_files with action media',
  simulator: 'manage_simulator',
  screen: 'read_screen',
  find: 'read_screen with selector',
  wait_for: 'check_element with timeoutMs',
  assert: 'check_element',
  screenshot: 'take_screenshot',
  audit: 'check_screen with check accessibility',
  visual: 'check_screen with check visual or visual_baseline',
  tap: 'tap_screen',
  double_tap: 'tap_screen with count: 2',
  long_press: 'tap_screen with holdMs',
  gesture: 'tap_screen (count: 2, holdMs) or swipe_screen (to, scale, pointers)',
  swipe: 'swipe_screen',
  scroll_to: 'swipe_screen with until',
  drag: 'swipe_screen with to',
  keyboard: 'press_key with key hide_keyboard or enter',
  steps: 'run_steps, each step by tool',
  alert: 'answer_alert',
  terminate_app: 'manage_app with action stop',
  app: "manage_app; an app's data: transfer_files",
  push: 'send_push',
  logs: 'read_logs',
  crashes: 'read_logs with source crashes',
  record: 'record_session with kind video',
  report: 'record_session with kind report, timeline or flight',
  mirror: 'show_mirror',
  inspector: 'inspect_app with action ax_list or ax_press',
  hand_off: 'ask_person',
  network: 'capture_network',
  webview: 'inspect_app with action web_pages, web_elements, web_click or web_eval',
  react_native: 'inspect_app with action rn_targets, rn_logs or rn_reload',
  perf_snapshot: 'measure_performance with metric snapshot',
  perf_launch: 'measure_performance with metric launch',
  perf_scroll: 'measure_performance with metric scroll',
  perf_trace: 'measure_performance with metric frames',
  perf_profile: 'measure_performance with metric cpu',
  perf_heap: 'measure_performance with metric heap',
  perf_compare: 'compare_performance',
  perf_query: 'compare_performance with action query',
  flow: 'run_flow, whose start is record',
};

/** The names that were tools: what a surface holds a refusal for, and lists nowhere. */
export const RENAMED_NAMES = Object.keys(RENAMED);

/** What to call in place of a name tools had before 1.3.0; undefined for a name that never was one. */
export const renamedHint = (name: string) =>
  Object.hasOwn(RENAMED, name) ? `${name} is now ${String(RENAMED[name])}` : undefined;
