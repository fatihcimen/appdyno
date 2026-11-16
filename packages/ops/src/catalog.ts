import { actOps } from './act.js';
import type { Answers } from './answers.js';
import { appOps } from './apps.js';
import type { ServerContext } from './context.js';
import { controlOps } from './control.js';
import { deviceOps } from './device.js';
import { diagnoseOps } from './diagnose.js';
import { flowOps } from './flow/ops.js';
import type { FlowRunner } from './flow/runner.js';
import { inspectorOps } from './inspector.js';
import { inspectApp, manageApp, transferFiles } from './merged/apps.js';
import { listDevices, setDevice } from './merged/devices.js';
import { checkScreen, readLogs, recordSession } from './merged/evidence.js';
import { checkElement, readScreen } from './merged/screen.js';
import { handoffOps } from './mirror/handoff.js';
import { mirrorOps } from './mirror/op.js';
import { networkOps } from './network.js';
import { perfOps } from './perf/index.js';
import { pushOps } from './push.js';
import { reactNativeOps } from './reactnative.js';
import { readOps } from './read.js';
import { recordOps } from './record.js';
import type { reportFor } from './report.js';
import { settingOps } from './settings.js';
import type { Steps } from './steps.js';
import type { Op } from './tool.js';
import { visualOps } from './visual.js';
import { webOps } from './web.js';

const byName = <T extends { name: string }>(all: readonly T[]) =>
  Object.fromEntries(all.map((x) => [x.name, x])) as { [X in T as X['name']]: X };

/** What the tools are made of, each by its name: a tool by itself, or a part of one. */
export const piecesOf = (
  ctx: ServerContext,
  answers: Answers,
  steps: Steps,
  report: ReturnType<typeof reportFor>,
  runner: FlowRunner,
  tools: () => Record<string, Op>,
) =>
  byName([
    ...deviceOps(ctx, answers),
    ...readOps(ctx, answers, steps),
    ...actOps(ctx, answers, steps, tools),
    ...appOps(ctx, answers, steps),
    ...controlOps(ctx, answers),
    ...settingOps(ctx, answers),
    ...pushOps(ctx, answers),
    ...diagnoseOps(ctx, answers),
    ...recordOps(ctx),
    ...mirrorOps(ctx),
    ...inspectorOps(ctx),
    ...handoffOps(ctx),
    ...report.ops(),
    ...networkOps(ctx),
    ...webOps(ctx),
    ...reactNativeOps(ctx),
    ...visualOps(ctx),
    ...perfOps(ctx, runner),
    ...flowOps(ctx, runner),
  ]);

export type Pieces = ReturnType<typeof piecesOf>;

/** Every tool, in the order a client's catalog lists them. */
export const catalogOf = (p: Pieces) => [
  listDevices(p),
  p.use_device,
  p.manage_simulator,
  setDevice(p),
  readScreen(p),
  p.take_screenshot,
  checkElement(p),
  checkScreen(p),
  p.tap_screen,
  p.swipe_screen,
  p.type_text,
  p.press_key,
  p.run_steps,
  p.answer_alert,
  p.ask_person,
  p.show_mirror,
  p.launch_app,
  manageApp(p),
  transferFiles(p),
  p.open_link,
  p.send_push,
  readLogs(p),
  p.capture_network,
  inspectApp(p),
  recordSession(p),
  p.perf_snapshot,
  p.perf_launch,
  p.perf_scroll,
  p.perf_trace,
  p.perf_profile,
  p.perf_heap,
  p.perf_compare,
  p.perf_query,
  p.run_flow,
];
