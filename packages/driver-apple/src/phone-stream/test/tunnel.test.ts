import { EventEmitter } from 'node:events';
import { createServer, Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { closingOnFailure, Lockdown, tunnelAnswer, tunnelOver } from '../tunnel.js';

const answer = (more = '') => {
  const body = Buffer.from(
    JSON.stringify({
      clientParameters: { address: 'fd00::2', mtu: 16_000 },
      serverAddress: 'fd00::1',
      serverRSDPort: 49_571,
    }),
  );
  const h = Buffer.alloc(10);
  h.write('CDTunnel', 'latin1');
  h.writeUInt16BE(body.length, 8);
  return Buffer.concat([h, body, Buffer.from(more)]);
};

const listeners = (s: PassThrough) =>
  s.listenerCount('data') + s.listenerCount('close') + s.listenerCount('error');

describe('lockdown', () => {
  it('fails the question on an answer it cannot read, and does not throw on the socket', async () => {
    const socket = Object.assign(new EventEmitter(), { write: vi.fn(), resume: vi.fn() });
    const lockdown = new Lockdown(socket as unknown as Socket);
    const asked = lockdown.ask({ Request: 'QueryType' });
    const body = Buffer.from('bplist00 and then nothing that is one');
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    expect(() => socket.emit('data', Buffer.concat([head, body]))).not.toThrow();
    await expect(asked).rejects.toThrow();
  });
});

describe('a handshake on a tunnel', () => {
  it('gives up on a phone that never answers, and leaves nothing on the stream', async () => {
    const stream = new PassThrough();
    const before = listeners(stream);
    await expect(tunnelAnswer(stream, 5)).rejects.toThrow('the tunnel did not answer');
    expect(listeners(stream)).toBe(before);
  });

  it('says a stream that closed at its start, and leaves nothing on it', async () => {
    const stream = new PassThrough();
    const before = listeners(stream);
    const asked = tunnelAnswer(stream, 60_000);
    stream.destroy();
    await expect(asked).rejects.toThrow('the tunnel closed at its start');
    expect(listeners(stream)).toBe(before);
  });

  it('refuses what is no tunnel, and leaves nothing on the stream', async () => {
    const stream = new PassThrough();
    const before = listeners(stream);
    const asked = tunnelAnswer(stream, 60_000);
    stream.write(Buffer.alloc(20));
    await expect(asked).rejects.toThrow('no tunnel');
    expect(listeners(stream)).toBe(before);
  });

  it('says a connection reset before its answer, takes the socket down, and does not throw', async () => {
    const server = createServer((s) => s.once('data', () => s.resetAndDestroy()));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const socket = new Socket();
    await new Promise<void>((r) =>
      socket.connect((server.address() as { port: number }).port, '127.0.0.1', r),
    );
    await expect(tunnelOver(socket)).rejects.toThrow('ECONNRESET');
    expect(socket.destroyed).toBe(true);
    server.close();
  });

  it('hands on what came after its answer, and the stream to what reads it next', async () => {
    const stream = new PassThrough();
    const before = listeners(stream);
    const asked = tunnelAnswer(stream, 60_000);
    stream.write(answer('packets'));
    const { info, rest } = await asked;
    expect(info.rsdPort).toBe(49_571);
    expect(rest.toString()).toBe('packets');
    expect(listeners(stream)).toBe(before);
  });
});

describe('what is done on a new connection', () => {
  it('takes the connection with it when it fails, as an open socket holds a process', async () => {
    const socket = { destroy: vi.fn() };
    await expect(
      closingOnFailure(socket, () => {
        return Promise.reject(new Error('no answer'));
      }),
    ).rejects.toThrow('no answer');
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it('leaves it open when it goes well', async () => {
    const socket = { destroy: vi.fn() };
    await expect(closingOnFailure(socket, () => Promise.resolve(7))).resolves.toBe(7);
    expect(socket.destroy).not.toHaveBeenCalled();
  });
});
