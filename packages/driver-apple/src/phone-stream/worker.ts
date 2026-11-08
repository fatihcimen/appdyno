import { parentPort, workerData } from 'node:worker_threads';
import type { MirrorQuality } from '@appdyno/core';
import { PhoneStream } from './stream.js';
import { runStream } from './stream-thread.js';

const { udid, quality, wifi } = workerData as {
  udid: string;
  quality: MirrorQuality;
  wifi: boolean;
};

if (!parentPort) throw new Error('the stream runs in a worker');
await runStream(parentPort, (sink) => PhoneStream.open(udid, { quality, wifi }, sink));
