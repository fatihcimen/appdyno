import { lockdownFrame, nextLockdownMessage } from '../usbmux.js';
import type { IpStack, TcpConnection } from './ipstack.js';
import type { ServiceList } from './services.js';

/** Lockdown's services as the tunnel has them, where no cable carries lockdown: its framing on a tunnel's connection. */

const SPRINGBOARD = 'com.apple.springboardservices.shim.remote';

type Answer = Record<string, unknown>;

/** The next `count` answers, and what came after them. */
function answers(connection: TcpConnection, count: number) {
  let held: Buffer = Buffer.alloc(0);
  const out: Answer[] = [];
  return new Promise<{ out: Answer[]; rest: Buffer }>((resolve) => {
    connection.onData((d) => {
      held = Buffer.concat([held, d]);
      for (let next; out.length < count && (next = nextLockdownMessage(held)); held = next.rest) {
        out.push(next.message as Answer);
      }
      if (out.length >= count) resolve({ out, rest: held });
    });
  });
}

/** A service reached over the tunnel is told who calls, and answers twice; what follows is its own protocol. */
export async function checkIn(connection: TcpConnection) {
  const twice = answers(connection, 2);
  connection.write(
    lockdownFrame({ Label: 'appdyno', ProtocolVersion: '2', Request: 'RSDCheckin' }),
  );
  return (await twice).rest;
}

/** One question of a plain service, and its answer. */
export async function askShim(connection: TcpConnection, message: Record<string, string>) {
  const answer = answers(connection, 1);
  connection.write(lockdownFrame({ Label: 'appdyno', ...message }));
  return (await answer).out[0]!;
}

/** Opens SpringBoard's service by the tunnel. */
export async function springboardOver(stack: IpStack, services: ServiceList) {
  const port = services.ports[SPRINGBOARD];
  if (!port) throw new Error('the phone lists no SpringBoard service');
  const connection = await stack.connect(port);
  await checkIn(connection);
  return connection;
}
