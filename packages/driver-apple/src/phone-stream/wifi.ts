import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { writeWhole, must } from '@appdyno/core';
import type { PhoneStreamCheck } from '../phone-stream-port.js';
import { identityFile } from '../wifi-paired.js';
import { PortRefused } from './ipstack.js';
import { FramedLine, XpcLine } from './pairing-line.js';
import { NotProved, PairingChannel, type Identity } from './pairing.js';
import { RemoteXpc } from './remotexpc.js';
import { readServices } from './services.js';
import { tunnelSocket } from './tunnel-socket.js';
import { openTunnel, PhoneRefusal, tunnelOver, type Tunnel } from './tunnel.js';

/**
 * An iPhone by the network, at a person's word: found by what it advertises, reached on the port it names, and proved
 * by an identity of this process's own, kept apart from the pair record and made on the cable. The tunnels it uses are
 * tunnels of ours, so nothing here comes near the discovery port of Apple's own.
 */

const SERVICE = '_remotepairing._tcp';
const LOOK_MS = 3_000;
const CONNECT_MS = 4_000;
/** Once a phone is seen, how long another has to show: what a phone advertises changes, so only its key tells them apart. */
const OTHERS_MS = 300;

export type FoundPhone = { phone: string; host: string; port: number };

/** What `dns-sd` prints until `enough` has what is wanted or the time is up: it never ends by itself. */
function browse(
  args: string[],
  enough: (lines: string[]) => boolean,
  othersMs = 0,
): Promise<string[]> {
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
      if (enough(lines)) setTimeout(end, othersMs);
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
    if (srv)
      hosts.set(must(srv[1], 'a name'), { port: Number(srv[2]), host: must(srv[3], 'a host') });
    const txt = /^(\S+)\._remotepairing\._tcp\s+TXT\s.*"identifier=([^"]+)"/.exec(line);
    if (txt) names.set(must(txt[1], 'a name'), must(txt[2], 'a value'));
  }
  return [...hosts].flatMap(([instance, at]) => {
    const phone = names.get(instance);
    return phone ? [{ phone, ...at }] : [];
  });
}

/** What is advertised: a quick look ends soon after the first phone, and a whole one takes its time. */
const findPhones = async (whole = false) =>
  phonesIn(
    await browse(['-Z', SERVICE, 'local.'], (l) => !whole && phonesIn(l).length > 0, OTHERS_MS),
  );

/**
 * The phone by its name first, then all else that is there: an iPhone 13 Pro Max advertised another name than it paired
 * by, and a new one by morning, so what decides is the key a phone proves it holds, and a name taken by another goes
 * first and no further.
 */
export function phonesToTry(found: FoundPhone[], name: string) {
  return [...found.filter((p) => p.phone === name), ...found.filter((p) => p.phone !== name)];
}

/**
 * The first that proves itself, of a quick look and then of a whole one: anything on the network may answer as the phone
 * and refuse, or be quicker to be seen, and neither ends the search. Only a phone that proved itself is heard saying it
 * no longer knows this Mac.
 */
export async function firstProved<T>(
  looks: (() => Promise<FoundPhone[]>)[],
  name: string,
  prove: (phone: FoundPhone) => Promise<T>,
): Promise<T> {
  const tried = new Set<string>();
  for (const look of looks) {
    for (const phone of phonesToTry(await look(), name)) {
      const at = `${phone.host}:${phone.port}`;
      if (tried.has(at)) continue;
      tried.add(at);
      try {
        return await prove(phone);
      } catch (e) {
        if (e instanceof PhoneRefusal && e.need === 'not-paired') throw e;
      }
    }
  }
  throw new PhoneRefusal(
    'not-connected',
    tried.size
      ? 'nothing on this network proved itself the phone paired'
      : 'the phone is not on this network',
  );
}

/**
 * The phone's address on a network, from `dns-sd -G`. A phone on a cable also answers by link-local addresses of that
 * cable, and going by those would be no Wi-Fi at all, whatever the window said.
 */
export function networkAddress(lines: string[]): string | undefined {
  const all = lines.flatMap((l) => /\bAdd\s+\S+\s+\d+\s+\S+\s+(\S+)/.exec(l)?.[1] ?? []);
  const usable = all
    .map((a) => a.replace(/%.*$/, ''))
    .filter((a) => a !== '0.0.0.0' && !a.startsWith('169.254.') && !/^fe[89ab]/i.test(a));
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

/** The key is what the phone trusts: read and written by this user alone, and whole or not at all. */
const keep = (udid: string, identity: Identity) =>
  writeWhole(identityFile(udid), JSON.stringify(identity));

export const isPaired = (udid: string) => existsSync(identityFile(udid));

/** What this Mac keeps of its pairing with the phone; none, or one that cannot be read, is undefined. */
function identityIn(udid: string): Identity | undefined {
  try {
    return JSON.parse(readFileSync(identityFile(udid), 'utf8')) as Identity;
  } catch {
    return undefined;
  }
}

const identityOf = (udid: string) => {
  if (!isPaired(udid)) {
    throw new PhoneRefusal('not-paired', 'this Mac has no pairing of its own with the phone');
  }
  const identity = identityIn(udid);
  if (!identity)
    throw new PhoneRefusal('not-paired', "this Mac's pairing with the phone cannot be read");
  return identity;
};

async function phonesFor(identity: Identity) {
  const phones = phonesToTry(await findPhones(), identity.phone);
  if (!phones.length) throw new PhoneRefusal('not-connected', 'the phone is not on this network');
  return phones;
}

/** Can a stream start: whether the phone is paired, there, and takes a connection. Asks it nothing. */
export async function wifiCheck(udid: string): Promise<PhoneStreamCheck> {
  try {
    (await reach(must((await phonesFor(identityOf(udid)))[0], 'a phone'))).socket.destroy();
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
      // the phone's suites are old ones, and one that encrypts nothing is not taken
      ciphers: 'PSK:!eNULL:@SECLEVEL=0',
      maxVersion: 'TLSv1.2',
      pskCallback: () => ({ psk: key, identity: '' }),
      checkServerIdentity: () => undefined,
    });
    t.once('secureConnect', () => {
      t.off('error', reject);
      resolve(t);
    });
    t.once('error', reject);
  });

/** A connection on which the phone has taken this Mac for who it says it is. */
async function provedBy(phone: FoundPhone, identity: Identity) {
  const { address, socket } = await reach(phone);
  const channel = new PairingChannel(new FramedLine(socket));
  try {
    await channel.handshake();
    if (!(await channel.verify(identity))) {
      throw new PhoneRefusal('not-paired', 'the phone no longer knows this Mac');
    }
    return { address, channel };
  } catch (e) {
    channel.close();
    // what did not prove itself says nothing as the phone, so it is only another that was not the one
    throw e instanceof PhoneRefusal && e.need === 'not-paired' ? e : new NotProved(String(e));
  }
}

const provenChannel = (identity: Identity) =>
  firstProved([findPhones, () => findPhones(true)], identity.phone, (phone) =>
    provedBy(phone, identity),
  );

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

/** Each phone's tunnel for what is reached by a port, kept: a start asks for a port many times over. */
const portTunnels = new Map<string, Promise<Tunnel>>();

/** A connection to a port on the phone, inside a tunnel by the network, as a socket for what speaks to one. */
export async function portOnWifi(udid: string, port: number, open = openWifiTunnel) {
  const opening =
    portTunnels.get(udid) ??
    open(udid).then((tunnel) => {
      tunnel.stack.onEnded(() => portTunnels.delete(udid));
      return tunnel;
    });
  portTunnels.set(udid, opening);
  const { stack } = await opening.catch((e: unknown) => {
    portTunnels.delete(udid);
    throw e;
  });
  try {
    return { socket: tunnelSocket(await stack.connect(port)) };
  } catch (e) {
    // a runner still starting refuses each look, and silence may be a network that went, which leaves no end to read
    if (!(e instanceof PortRefused)) stack.close();
    throw e;
  }
}

/** Where a phone makes a new pairing: inside a cable's tunnel, as on the network it allows none. */
const PAIRING_SERVICE = 'com.apple.internal.dt.coredevice.untrusted.tunnelservice';

/**
 * On a channel to a phone's pairing service: what is `known` proved, and nothing asked of anyone, or else a new identity,
 * which the phone asks a person for. A phone that forgot this Mac, or another key, or none kept, is paired anew.
 */
export async function pairAnew(
  channel: PairingChannel,
  known: Identity | undefined,
  asked: () => void,
) {
  await channel.handshake();
  const proved = await channel.verify(known).catch((e: unknown) => {
    if (e instanceof NotProved) return false;
    throw e;
  });
  return proved ? undefined : channel.pair(asked);
}

/**
 * Makes this Mac's identity with a phone on a cable, which it then uses on the network: the phone asks a person, and
 * `say` tells them to look. All of it goes by the cable, so a phone that forgot this Mac, or is not on this network, is
 * paired again the same way; one that proves it still knows this Mac is left as it is.
 */
export async function pairOnCable(udid: string, say: (words: string) => void): Promise<void> {
  const { stack, rsdPort } = await openTunnel(udid);
  try {
    const port = (await readServices(stack, rsdPort)).ports[PAIRING_SERVICE];
    if (!port) throw new PhoneRefusal('not-connected', 'the phone offers no pairing on its cable');
    const channel = new PairingChannel(new XpcLine(RemoteXpc.start(await stack.connect(port))));
    try {
      const made = await pairAnew(channel, identityIn(udid), () => say('Tap Trust on the phone.'));
      if (!made) {
        say('This Mac is already paired with the phone.');
        return;
      }
      keep(udid, made);
    } finally {
      channel.close();
    }
  } finally {
    stack.close();
  }
  say('Paired. The phone can now be mirrored with --wifi, on the same network as this Mac.');
}
