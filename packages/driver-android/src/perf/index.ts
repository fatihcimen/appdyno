import { cannot, type MeasureSource } from '@appdyno/core';
import { type PerfDevice, pidOf } from './shared.js';
import { frameMarks } from './frame-marks.js';
import { frames, framesDuring, resetFrames, frameTimeline, frameTrace } from './frames.js';
import { memory, anonMemory, heapDump, heap, heapProfile } from './memory.js';
import { cpu, threads, cpuProfile } from './cpu.js';
import { baselineProfile } from './baseline.js';
import { launch } from './launch.js';
import { buildType, network, energy, exits, size, vitals } from './app.js';
import { battery } from './battery.js';
import { startInfo } from './start-info.js';
import { surfaceFrames } from './surface.js';

/**
 * The app's and the device's performance on Android, from the platform's own tools: frames (gfxinfo,
 * Perfetto's frame timeline), memory (meminfo), CPU (/proc), launch time (`am start -W`) and the
 * device's state while measuring (load, CPU pressure, memory, thermal status, battery temperature).
 * Commands run in the C locale (a localized device writes `0,0`).
 */
export class AndroidPerf implements MeasureSource {
  constructor(private readonly device: PerfDevice) {}

  private readonly on =
    <A extends unknown[], R>(measure: (d: PerfDevice, ...a: A) => R) =>
    (...a: A) =>
      measure(this.device, ...a);

  readonly slowReads = [];
  readonly framesByProbe = false;
  readonly symbolFiles = false;
  readonly logTellsStalls = true;
  readonly energyHolds = 'battery';
  attachProbe = cannot('through a frame probe', {
    reason: "the probe goes into an iOS simulator's app",
    hint: 'leave out probe: Android times each frame itself',
  });
  hangs = cannot('hangs', { reason: "they are read from an iPhone's Time Profiler trace" });
  xctMetrics = cannot("XCTest's metrics", { reason: 'XCTest runs on iOS' });

  pid = this.on(pidOf);
  frames = this.on(frames);
  framesDuring = this.on(framesDuring);
  resetFrames = this.on(resetFrames);
  frameTimeline = this.on(frameTimeline);
  frameTrace = this.on(frameTrace);
  frameMarks = this.on(frameMarks);
  surfaceFrames = this.on(surfaceFrames);
  memory = this.on(memory);
  anonMemory = this.on(anonMemory);
  heapDump = this.on(heapDump);
  heap = this.on(heap);
  heapProfile = this.on(heapProfile);
  cpu = this.on(cpu);
  threads = this.on(threads);
  cpuProfile = this.on(cpuProfile);
  launch = this.on(launch);
  baselineProfile = this.on(baselineProfile);
  buildType = this.on(buildType);
  network = this.on(network);
  energy = this.on(energy);
  battery = this.on(battery);
  exits = this.on(exits);
  startInfo = this.on(startInfo);
  size = this.on(size);
  vitals = this.on(vitals);
}
