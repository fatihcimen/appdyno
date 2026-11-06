import type { InputEvent } from '@appdyno/core';
import type { PhoneStreamEvent } from '../phone-stream-port.js';
import { FrameWriter } from './frame-writer.js';
import type { PhoneStream, StreamSink } from './stream.js';
import { needOf, StreamRefusal } from './stream-state.js';

/**
 * A thread of its own for a stream's TLS, packets and pictures: whatever else the process's main thread does, its garbage
 * and its work stay out of them. Pictures go straight to the viewer's pipe, and nothing of them comes back here.
 */
export type ToWorker =
  | { op: 'attach'; file: string }
  | { op: 'input'; e: InputEvent }
  | { op: 'keyframe' }
  | { op: 'stop' };

/** What the thread has of the process that started it. */
export interface ThreadPort {
  on(event: 'message', listener: (m: ToWorker) => void): void;
  postMessage(e: PhoneStreamEvent): void;
  close(): void;
}

/** One stream, from its open to the word that it ended, whatever order a stop and the phone's answers come in. */
export async function runStream(
  port: ThreadPort,
  open: (sink: StreamSink) => Promise<Pick<PhoneStream, 'input' | 'keyframe' | 'stop'>>,
) {
  const tell = (e: PhoneStreamEvent) => port.postMessage(e);
  let stream: Awaited<ReturnType<typeof open>> | undefined;
  let stopping = false;
  let held: ToWorker[] = [];

  const writer = new FrameWriter(
    () => stream?.keyframe(),
    // a viewer that never opened its end: the session sees no first picture and starts another
    () => undefined,
  );

  const finish = (proved: boolean) => {
    writer.close();
    tell({ kind: 'ended', proved });
    // the port is what holds this thread up
    port.close();
  };

  function handle(m: ToWorker) {
    if (m.op === 'attach') writer.attach(m.file);
    if (!stream) {
      // a stream still opening is ended once it is open: until then the phone has no stop to hear, and a closed port
      // does not end a thread whose timers keep the phone's stream alive
      if (m.op === 'stop') stopping = true;
      else if (m.op !== 'attach') held.push(m);
      return;
    }
    if (m.op === 'input') void stream.input(m.e).catch(() => undefined);
    if (m.op === 'keyframe') stream.keyframe();
    if (m.op === 'stop') void stream.stop().then(finish);
  }

  port.on('message', handle);

  try {
    stream = await open({
      live: ({ w, h, mode, crop }) => {
        writer.setInfo({ w, h, codec: 'hevc', mode, crop });
        tell({ kind: 'live', w, h, mode });
      },
      picture: (p) => writer.picture(p.annexB),
      state: (state) => tell({ kind: 'state', state }),
      counters: (c) => writer.setCounters(c),
      turns: (turns) => writer.setTurns(turns),
      lost: (why, need) => {
        writer.close();
        tell({ kind: 'lost', why, ...(need && { need }) });
        port.close();
      },
    });
    if (stopping) handle({ op: 'stop' });
    else for (const m of held) handle(m);
    held = [];
  } catch (e) {
    const why = (e as Error).message;
    const need = e instanceof StreamRefusal ? e.need : needOf(why);
    tell({ kind: 'lost', why, ...(need && { need }) });
    writer.close();
    port.close();
  }
}
