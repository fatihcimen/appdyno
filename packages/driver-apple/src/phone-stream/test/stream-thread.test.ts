import { describe, expect, it, vi } from 'vitest';
import { must } from '@appdyno/core';
import type { PhoneStreamEvent } from '../../phone-stream-port.js';
import type { StreamSink } from '../stream.js';
import { runStream, type ThreadPort, type ToWorker } from '../stream-thread.js';
import { StreamRefusal } from '../stream-state.js';

/** A port to talk to, a phone whose connect ends when a test says, and what a stream was asked. */
function thread(proved = true) {
  const told: PhoneStreamEvent[] = [];
  let send: (m: ToWorker) => void = () => undefined;
  const port = {
    on: (_event, listener) => void (send = listener),
    postMessage: (e) => void told.push(e),
    close: vi.fn(),
  } satisfies ThreadPort;
  const stream = {
    input: vi.fn(() => Promise.resolve(undefined)),
    keyframe: vi.fn(),
    stop: vi.fn(() => Promise.resolve(proved)),
  };
  let connected: (() => void) | undefined;
  let refused: ((e: Error) => void) | undefined;
  let sink: StreamSink | undefined;
  const done = runStream(port, (s) => {
    sink = s;
    return new Promise((resolve, reject) => {
      connected = () => resolve(stream);
      refused = reject;
    });
  });
  return {
    told,
    port,
    stream,
    done,
    send: (m: ToWorker) => send(m),
    sink: () => must(sink, 'the sink'),
    connect: () => must(connected, 'the connect')(),
    refuse: (e: Error) => must(refused, 'the refusal')(e),
  };
}

const ended = (told: PhoneStreamEvent[]) => told.filter((e) => e.kind === 'ended');

describe("a stream's thread", () => {
  it('holds a stop that comes during the connect, and ends what the connect opened', async () => {
    const t = thread();
    t.send({ op: 'stop' });
    await Promise.resolve();
    expect(t.told).toEqual([]);
    expect(t.port.close).not.toHaveBeenCalled();
    t.connect();
    await t.done;
    await vi.waitFor(() => expect(t.port.close).toHaveBeenCalled());
    expect(t.stream.stop).toHaveBeenCalledTimes(1);
    expect(ended(t.told)).toEqual([{ kind: 'ended', proved: true }]);
  });

  it('says a stop was not proved when the phone did not say so', async () => {
    const t = thread(false);
    t.send({ op: 'stop' });
    t.connect();
    await t.done;
    await vi.waitFor(() => expect(ended(t.told)).toEqual([{ kind: 'ended', proved: false }]));
  });

  it('takes nothing to the phone of a stream it was told to stop', async () => {
    const t = thread();
    t.send({ op: 'input', e: { kind: 'button', name: 'home' } });
    t.send({ op: 'keyframe' });
    t.send({ op: 'stop' });
    t.connect();
    await t.done;
    expect(t.stream.input).not.toHaveBeenCalled();
    expect(t.stream.keyframe).not.toHaveBeenCalled();
  });

  it('passes on what waited for the connect, in order, when no stop came', async () => {
    const t = thread();
    const e = { kind: 'touch', p: 0, x: 0.5, y: 0.5 } as const;
    t.send({ op: 'input', e });
    t.send({ op: 'keyframe' });
    t.connect();
    await t.done;
    expect(t.stream.input).toHaveBeenCalledWith(e);
    expect(t.stream.keyframe).toHaveBeenCalledTimes(1);
    expect(t.port.close).not.toHaveBeenCalled();
    t.send({ op: 'stop' });
    await vi.waitFor(() => expect(ended(t.told)).toHaveLength(1));
  });

  it('says a failed connect with its need and no proof, a stop waiting or not', async () => {
    const t = thread();
    t.send({ op: 'stop' });
    t.refuse(new StreamRefusal('taken-over', 'another app has a stream'));
    await t.done;
    expect(t.told).toEqual([{ kind: 'lost', why: 'another app has a stream', need: 'taken-over' }]);
    expect(t.port.close).toHaveBeenCalled();
    expect(t.stream.stop).not.toHaveBeenCalled();
  });

  it('reads what a phone refused with in words, with no refusal to carry it', async () => {
    const t = thread();
    t.refuse(new Error('The device microphone or camera is in use'));
    await t.done;
    expect(t.told).toEqual([
      {
        kind: 'lost',
        why: 'The device microphone or camera is in use',
        need: 'camera-or-mic',
      },
    ]);
  });

  it('says a stream that dropped, and closes', async () => {
    const t = thread();
    t.connect();
    await t.done;
    t.sink().lost('the tunnel ended');
    expect(t.told).toEqual([{ kind: 'lost', why: 'the tunnel ended' }]);
    expect(t.port.close).toHaveBeenCalled();
  });
});
