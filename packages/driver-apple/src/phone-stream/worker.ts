import { parentPort, workerData } from 'node:worker_threads';
import type { InputEvent, MirrorQuality } from '@appdyno/core';
import type { PhoneStreamEvent } from '../phone-stream-port.js';
import { FrameWriter } from './frame-writer.js';
import { PhoneStream } from './stream.js';
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

const { udid, quality } = workerData as { udid: string; quality: MirrorQuality };
const port = parentPort!;
const tell = (e: PhoneStreamEvent) => port.postMessage(e);

let stream: PhoneStream | undefined;
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
    if (m.op === 'stop') finish(true);
    else if (m.op !== 'attach') held.push(m);
    return;
  }
  if (m.op === 'input') void stream.input(m.e).catch(() => undefined);
  if (m.op === 'keyframe') stream.keyframe();
  if (m.op === 'stop') void stream.stop().then(finish);
}

port.on('message', handle);

try {
  stream = await PhoneStream.open(udid, quality, {
    live: ({ w, h, mode }) => {
      writer.setInfo({ w, h, codec: 'hevc', mode });
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
  for (const m of held) handle(m);
  held = [];
} catch (e) {
  const why = (e as Error).message;
  const need = e instanceof StreamRefusal ? e.need : needOf(why);
  tell({ kind: 'lost', why, ...(need && { need }) });
  writer.close();
  port.close();
}
