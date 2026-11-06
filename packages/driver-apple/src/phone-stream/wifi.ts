import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { dirname } from 'node:path';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import type { PhoneStreamCheck } from '../phone-stream-port.js';
import { identityFile } from '../wifi-paired.js';
import { FramedLine, XpcLine } from './pairing-line.js';
import { PairingChannel, type Identity } from './pairing.js';
import { RemoteXpc } from './remotexpc.js';
import { readServices } from './services.js';
import { openTunnel, PhoneRefusal, tunnelOver, type Tunnel } from './tunnel.js';

/**
 * An iPhone by the network, at a person's word: found by what it advertises, reached on the port it names, and proved
 * by an identity of this process's own, kept apart from the pair record and made on the cable. The tunnels it uses are
 * tunnels of ours, so nothing here comes near the discovery port of Apple's own.
 */

const SERVICE = '_remotepairing._tcp';
const LOOK_MS = 3_000;
const CONNECT_MS = 4_000;

export type FoundPhone = { phone: string; host: string; port: number };

/** What `dns-sd` prints until `enough` has what is wanted or the time is up: it never ends by itself. */
function browse(args: string[], enough: (lines: string[]) => boolean): Promise<string[]> {
  return new Promise((resolve) => {
    const tool = spawn('/usr/bin/dns-sd', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const lines: string[] = [];
    const end = () => {
      clearTimeout(timer);
      tool.kill();
      resolve(lines);
    };
    const timer = setTimeout(end, LOOK_MS);
    tool.stdout.on('data', (d: Buffer) => {
      lines.push(...String(d).split('\n'));
      if (enough(lines)) end();
    });
    tool.once('error', end);
  });
}

/** The phones in `dns-sd -Z`'s records: one with an address and a port once both have been seen. */
export function phonesIn(lines: string[]): FoundPhone[] {
  const hosts = new Map<string, { host: string; port: number }>();
  const names = new Map<string, string>();
  for (const line of lines) {
    const srv = /^(\S+)\._remotepairing\._tcp\s+SRV\s+\d+\s+\d+\s+(\d+)\s+(\S+)/.exec(line);
    if (srv) hosts.set(srv[1]!, { port: Number(srv[2]), host: srv[3]! });
    const txt = /^(\S+)\._remotepairing\._tcp\s+TXT\s.*"identifier=([^"]+)"/.exec(line);
    if (txt) names.set(txt[1]!, txt[2]!);
  }
  return [...hosts].flatMap(([instance, at]) => {
    const phone = names.get(instance);
    return phone ? [{ phone, ...at }] : [];
  });
}

export const findPhones = async () => phonesIn(await browse(['-Z', SERVICE, 'local.'], enough));

const enough = (lines: string[]) => phonesIn(lines).length > 0;

/**
 * The phone's address on a network, from `dns-sd -G`. A phone on a cable also answers by link-local addresses of that
 * cable, and going by those would be no Wi-Fi at all, whatever the window said.
 */
export function networkAddress(lines: string[]): string | undefined {
  const all = lines.flatMap((l) => /\bAdd\s+\S+\s+\d+\s+\S+\s+(\S+)/.exec(l)?.[1] ?? []);
  const usable = all
    .map((a) => a.replace(/%.*$/, ''))
    .filter((a) => a !== '0.0.0.0' && !/^169\.254\./.test(a) && !/^fe[89ab]/i.test(a));
  return usable.find((a) => a.includes('.')) ?? usable[0];
}

const addressOf = async (host: string) =>
  networkAddress(await browse(['-G', 'v4v6', host], (l) => networkAddress(l) !== undefined));

async function reach(found: FoundPhone) {
  const address = await addressOf(found.host);
  if (!address) throw new PhoneRefusal('not-connected', 'the phone has no address on this network');
  return { address, socket: await connected(address, found.port) };
}

function connected(address: string, port: number) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = new Socket();
    const refused = (why: string) => {
      socket.destroy();
      reject(new PhoneRefusal('not-connected', why));
    };
    const timer = setTimeout(() => refused('the phone did not answer on the network'), CONNECT_MS);
    socket.once('error', (e) => {
      clearTimeout(timer);
      refused(`the phone could not be reached: ${e.message}`);
    });
    socket.connect(port, address, () => {
      clearTimeout(timer);
      socket.removeAllListeners('error');
      // a touch must not wait to fill a packet
      socket.setNoDelay(true);
      resolve(socket);
    });
  });
}

/** The key is what the phone trusts: read and written by this user alone. */
function keep(udid: string, identity: Identity) {
  const file = identityFile(udid);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(identity), { mode: 0o600 });
}

export const isPaired = (udid: string) => existsSync(identityFile(udid));

const identityOf = (udid: string) => {
  if (!isPaired(udid)) {
    throw new PhoneRefusal('not-paired', 'this Mac has no pairing of its own with the phone');
  }
  return JSON.parse(readFileSync(identityFile(udid), 'utf8')) as Identity;
};

async function phoneOf(identity: Identity) {
  const found = (await findPhones()).find((p) => p.phone === identity.phone);
  if (!found) throw new PhoneRefusal('not-connected', 'the phone is not on this network');
  return found;
}

/** Can a stream start: whether the phone is paired, there, and takes a connection. Asks it nothing. */
export async function wifiCheck(udid: string): Promise<PhoneStreamCheck> {
  try {
    (await reach(await phoneOf(identityOf(udid)))).socket.destroy();
    return { ok: true };
  } catch (e) {
    if (e instanceof PhoneRefusal) return { ok: false, need: e.need, detail: e.message };
    throw e;
  }
}

export const pskTls = (socket: Socket, key: Buffer) =>
  new Promise<TLSSocket>((resolve, reject) => {
    const t = tlsConnect({
      socket,
      ciphers: 'PSK:@SECLEVEL=0',
      maxVersion: 'TLSv1.2',
      pskCallback: () => ({ psk: key, identity: 'appdyno' }),
      checkServerIdentity: () => undefined,
    });
    t.once('secureConnect', () => {
      t.off('error', reject);
      resolve(t);
    });
    t.once('error', reject);
  });

/** A connection on which the phone has taken this Mac for who it says it is. */
async function provenChannel(identity: Identity) {
  const { address, socket } = await reach(await phoneOf(identity));
  const channel = new PairingChannel(new FramedLine(socket));
  try {
    await channel.handshake();
    if (!(await channel.verify(identity))) {
      throw new PhoneRefusal('not-paired', 'the phone no longer knows this Mac');
    }
    return { address, channel };
  } catch (e) {
    channel.close();
    throw e;
  }
}

/** The same tunnel as by cable, with its packets over TCP and TLS on the network. */
export async function openWifiTunnel(udid: string): Promise<Tunnel> {
  const { address, channel } = await provenChannel(identityOf(udid));
  try {
    const { port, key } = await channel.listener();
    const tunnel = await tunnelOver(await pskTls(await connected(address, port), key));
    // the phone's listener lasts as long as this connection
    tunnel.stack.onEnded(() => channel.close());
    return tunnel;
  } catch (e) {
    channel.close();
    throw e;
  }
}

/** Where a phone makes a new pairing: inside a cable's tunnel, as on the network it allows none. */
const PAIRING_SERVICE = 'com.apple.internal.dt.coredevice.untrusted.tunnelservice';

/**
 * Makes this Mac's identity with a phone on a cable, which it then uses on the network: the phone asks a person, and
 * `say` tells them to look. A phone that already knows this Mac is left as it is.
 */
export async function pairOnCable(udid: string, say: (words: string) => void): Promise<void> {
  if (isPaired(udid)) {
    (await provenChannel(identityOf(udid))).channel.close();
    say('This Mac is already paired with the phone.');
    return;
  }
  const { stack, rsdPort } = await openTunnel(udid);
  try {
    const port = (await readServices(stack, rsdPort)).ports[PAIRING_SERVICE];
    if (!port) throw new PhoneRefusal('not-connected', 'the phone offers no pairing on its cable');
    const channel = new PairingChannel(new XpcLine(RemoteXpc.start(await stack.connect(port))));
    try {
      await channel.handshake();
      await channel.verify();
      keep(udid, await channel.pair(() => say('Tap Trust on the phone.')));
    } finally {
      channel.close();
    }
  } finally {
    stack.close();
  }
  say('Paired. The phone can now be mirrored with --wifi, on the same network as this Mac.');
}
