import { type Socket } from 'node:net';
import { Duplex } from 'node:stream';
import type { TcpConnection } from './ipstack.js';

/** A connection in a tunnel, as a socket for what speaks to one: the stack already sends a touch's bytes at once. */
export function tunnelSocket(connection: TcpConnection) {
  const stream = new Duplex({
    read() {
      // the stack pushes what comes in
    },
    write(chunk: Buffer, _encoding, done) {
      connection.write(chunk);
      done();
    },
    destroy(error, done) {
      connection.close();
      done(error);
    },
  });
  connection.onData((d) => stream.push(d));
  connection.onClose(() => stream.destroy());
  return Object.assign(stream, { setNoDelay: () => stream }) as unknown as Socket;
}
