import { Worker } from 'node:worker_threads';
import type { InputEvent, LiveSample, MirrorQuality } from '@appdyno/core';
import type {
  PhoneStreamCheck,
  PhoneStreamEvent,
  PhoneStreamHandle,
  PhoneStreamModule,
} from '../phone-stream-port.js';
import { listDevices, sameUdid } from '../usbmux.js';
import { Audit, elementNamed, type AuditElement } from './audit.js';
import { ConditionInducer } from './conditions.js';
import { LiveReader, NO_HUB, unreadable } from './live.js';
import { readServices, takeScreenshot } from './services.js';
import { openTunnel, PhoneRefusal, readPairRecord } from './tunnel.js';
import type { ToWorker } from './stream-thread.js';
import { isPaired, openWifiTunnel, pairOnCable, portOnWifi, wifiCheck } from './wifi.js';

/** This folder's one way in. All it holds speaks a phone's private services; see `phone-stream-port.ts`. */

const STOP_MS = 12_000;

const onCable = async (udid: string) =>
  (await listDevices()).some((d) => d.connection === 'USB' && sameUdid(d.serial, udid));

const onWifi = async (udid: string, asked = false) =>
  asked || (isPaired(udid) && !(await onCable(udid)));

/** A cable where there is one; a phone paired for it is reached by the network where there is none. */
async function tunnelTo(udid: string) {
  return (await onWifi(udid)) ? openWifiTunnel(udid) : openTunnel(udid);
}

async function check(udid: string, options?: { wifi?: boolean }): Promise<PhoneStreamCheck> {
  if (options?.wifi) return wifiCheck(udid);
  if (!(await onCable(udid))) return { ok: false, need: 'not-connected' };
  try {
    await readPairRecord(udid);
    return { ok: true };
  } catch (e) {
    if (e instanceof PhoneRefusal) return { ok: false, need: e.need, detail: e.message };
    throw e;
  }
}

async function screenshot(udid: string, format: 'png' | 'jpeg'): Promise<Buffer> {
  const { stack, rsdPort } = await tunnelTo(udid);
  try {
    return await takeScreenshot(stack, await readServices(stack, rsdPort), format);
  } finally {
    stack.close();
  }
}

async function withAudit<T>(udid: string, use: (audit: Audit) => Promise<T>): Promise<T> {
  const { stack, rsdPort } = await tunnelTo(udid);
  try {
    const list = await readServices(stack, rsdPort);
    // seen once in a run of quick reads: a list without it, and the next one has it
    const audit = await Audit.open(stack, list).catch(async () =>
      Audit.open(stack, await readServices(stack, rsdPort)),
    );
    try {
      return await use(audit);
    } finally {
      await audit.close();
    }
  } finally {
    stack.close();
  }
}

const told = ({ caption, identifier }: AuditElement) => ({
  caption,
  ...(identifier && { identifier }),
});

const elements = (udid: string) =>
  withAudit(udid, async (audit) => (await audit.elements()).map(told));

const press = (udid: string, name: string) =>
  withAudit(udid, async (audit) => {
    // a token is good for its connection, and a screen is read before it is touched
    const element = elementNamed(await audit.elements(), name);
    await audit.press(element);
    return told(element);
  });

async function live(
  udid: string,
  app: string | undefined,
  onSample: (s: LiveSample) => void,
): Promise<() => void> {
  const { stack, rsdPort } = await tunnelTo(udid);
  const reader = await LiveReader.open(
    stack,
    await readServices(stack, rsdPort),
    app,
    onSample,
  ).catch((e: Error) => {
    onSample(unreadable(e.message, app));
  });
  if (reader === null) onSample(unreadable(NO_HUB, app));
  if (!reader) {
    stack.close();
    return () => undefined;
  }
  return () => {
    reader.stop();
    stack.close();
  };
}

function start(
  udid: string,
  options: { quality: MirrorQuality; wifi?: boolean },
  onEvent: (e: PhoneStreamEvent) => void,
): PhoneStreamHandle {
  const worker = new Worker(new URL('./worker.js', import.meta.url), {
    workerData: { udid, quality: options.quality, wifi: options.wifi === true },
    // the pipe's descriptor is the socket's to close: a thread that also closed it as it ended took the same number
    // from whatever had it by then, a new viewer's output as seen
    trackUnmanagedFds: false,
  });
  let onEnded: ((proved: boolean) => void) | undefined;
  let ended = false;
  const end = (proved: boolean) => {
    if (ended) return;
    ended = true;
    onEnded?.(proved);
    onEvent({ kind: 'ended', proved });
  };
  worker.on('message', (e: PhoneStreamEvent) => {
    if (e.kind === 'ended') end(e.proved);
    else onEvent(e);
  });
  worker.on('error', (e) => {
    onEvent({ kind: 'lost', why: `the stream's thread failed: ${e.message}` });
    end(false);
  });
  worker.on('exit', () => end(false));
  worker.unref();
  const send = (m: ToWorker) => worker.postMessage(m);
  return {
    attach: (file) => send({ op: 'attach', file }),
    input: (e: InputEvent) => send({ op: 'input', e }),
    keyframe: () => send({ op: 'keyframe' }),
    stop: () =>
      new Promise<boolean>((resolve) => {
        if (ended) {
          resolve(false);
          return;
        }
        const timer = setTimeout(() => {
          void worker.terminate();
          resolve(false);
        }, STOP_MS);
        onEnded = (proved) => {
          clearTimeout(timer);
          resolve(proved);
        };
        send({ op: 'stop' });
      }),
  };
}

/** The connection that holds a phone's condition, while this process lives: the phone may end one with it. */
const holding = new Map<string, { inducer: ConditionInducer; close(): void }>();

async function openInducer(udid: string) {
  const { stack, rsdPort } = await tunnelTo(udid);
  try {
    const inducer = await ConditionInducer.open(stack, await readServices(stack, rsdPort));
    return { inducer, close: () => (inducer.close(), stack.close()) };
  } catch (e) {
    stack.close();
    throw e;
  }
}

async function conditions(udid: string) {
  const held = holding.get(udid);
  if (held) return held.inducer.list();
  const opened = await openInducer(udid);
  try {
    return await opened.inducer.list();
  } finally {
    opened.close();
  }
}

async function induce(udid: string, condition?: { id: string; profile: string }) {
  const opened = holding.get(udid) ?? (await openInducer(udid));
  holding.delete(udid);
  try {
    if ((await opened.inducer.list()).some((c) => c.on)) await opened.inducer.disable();
    if (!condition) return;
    await opened.inducer.enable(condition.id, condition.profile);
    holding.set(udid, opened);
  } finally {
    if (!holding.has(udid)) opened.close();
  }
}

const secureFocused = (udid: string) => withAudit(udid, (audit) => audit.secureFocused());
const focusedField = (udid: string) => withAudit(udid, (audit) => audit.focusedField());

const phoneStream: PhoneStreamModule = {
  check,
  screenshot,
  elements,
  press,
  secureFocused,
  focusedField,
  live,
  conditions,
  induce,
  start,
  onWifi,
  portOnWifi,
  pair: pairOnCable,
};
export default phoneStream;
