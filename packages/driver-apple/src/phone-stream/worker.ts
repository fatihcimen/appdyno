import { parentPort, workerData } from 'node:worker_threads';
import type { MirrorQuality } from '@appdyno/core';
import { PhoneStream } from './stream.js';
import { runStream } from './stream-thread.js';

const { udid, quality, wifi } = workerData as {
  udid: string;
  quality: MirrorQuality;
  wifi: boolean;
};

await runStream(parentPort!, (sink) => PhoneStream.open(udid, { quality, wifi }, sink));
