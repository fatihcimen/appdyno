/** What `stop` needs: plain values, as the stop may be another process. */
export type RecordingHandle = Record<string, string | number>;

/** One file; several, in order, only when segments could not be joined. */
export type RecordingFiles = { files: string[]; note?: string };

/** Screen video. A recording outlives the process that started it. */
export interface ScreenRecorder {
  readonly extension: 'mp4' | 'mov';
  /**
   * Where the first frame of a video with no times of its own lies, as measured for this recorder: `ms` before `start`
   * answers, to within `withinMs`. None where it keeps its own, or where no one has measured it.
   */
  readonly lead?: { ms: number; withinMs: number };
  /** A second recording cannot begin before the first has ended, so a ring of them has a hole in it. */
  readonly oneAtATime?: boolean;
  /** `light`: what will run for hours, kept only in case: fewer bits, for what it costs the device and the disk. */
  start(file: string, opts: { maxSeconds: number; light?: boolean }): Promise<RecordingHandle>;
  stop(handle: RecordingHandle): Promise<RecordingFiles>;
}

/** One thing on a screen as the system's accessibility service tells it: its words and id, and no place. */
export type InspectedElement = { caption: string; identifier?: string };

/** A screen read and pressed with no agent on the device, by the system's own accessibility service. */
export interface ScreenInspector {
  elements(): Promise<InspectedElement[]>;
  /** Activates what has that id or those words on the screen as read now, and says which it was. */
  press(name: string): Promise<InspectedElement>;
}
