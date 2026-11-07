import { connect, type Socket } from 'node:net';
import { DeviceError } from '@appdyno/protocol';
import { xmlText } from '@appdyno/core';
import { readBplist } from './webinspector.js';

/**
 * The USB multiplexer of the Mac (`/var/run/usbmuxd`): lists the connected phones and opens a raw
 * stream to a TCP port on one. Messages: a 16-byte little-endian header (length with header, version
 * 1, type 8 = plist, tag) and an XML property list.
 */
export const USBMUXD = '/var/run/usbmuxd';

type Plist = string | number | boolean | Plist[] | { [k: string]: Plist };

export function plistXml(v: Plist): string {
  const enc = (x: Plist): string => {
    if (typeof x === 'string') return `<string>${xmlText(x)}</string>`;
    if (typeof x === 'number')
      return Number.isInteger(x) ? `<integer>${x}</integer>` : `<real>${x}</real>`;
    if (typeof x === 'boolean') return x ? '<true/>' : '<false/>';
    if (Array.isArray(x)) return `<array>${x.map(enc).join('')}</array>`;
    return `<dict>${Object.entries(x)
      .map(([k, val]) => `<key>${xmlText(k)}</key>${enc(val)}`)
      .join('')}</dict>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${enc(v)}</plist>\n`;
}

/** A small XML property list reader: dict, array, string, integer, real, true/false, data (as base64). */
export function parsePlist(xml: string): Plist {
  const tokens =
    xml.replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>|<\/?plist[^>]*>/g, '').match(/<[^>]+>|[^<]+/g) ??
    [];
  let i = 0;
  const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const text = (close: string) => {
    let s = '';
    while (i < tokens.length && tokens[i] !== close) s += tokens[i++];
    i++; // close tag
    return unesc(s);
  };
  // whitespace between elements is layout; inside a string it is kept
  const skip = () => {
    while (i < tokens.length && !tokens[i]!.startsWith('<') && tokens[i]!.trim() === '') i++;
  };
  const peek = () => (skip(), tokens[i]!.trim());
  const value = (): Plist => {
    skip();
    const t = tokens[i++]!.trim();
    if (t === '<dict>') {
      const d: Record<string, Plist> = {};
      while (peek() !== '</dict>') {
        if (tokens[i]!.trim() !== '<key>') throw new Error(`plist: key expected, got ${tokens[i]}`);
        i++;
        const k = text('</key>');
        d[k] = value();
      }
      i++;
      return d;
    }
    if (t === '<dict/>') return {};
    if (t === '<array>') {
      const a: Plist[] = [];
      while (peek() !== '</array>') a.push(value());
      i++;
      return a;
    }
    if (t === '<array/>') return [];
    if (t === '<true/>') return true;
    if (t === '<false/>') return false;
    if (t === '<string/>') return '';
    if (t === '<string>') return text('</string>');
    if (t === '<integer>') return Number(text('</integer>'));
    if (t === '<real>') return Number(text('</real>'));
    if (t === '<data>') return text('</data>').replace(/\s+/g, '');
    if (t === '<date>') return text('</date>');
    throw new Error(`plist: unexpected ${t}`);
  };
  return value();
}

/** A property list as a phone sends it: of either kind, with nothing to say which but its first bytes. */
export const readPlist = (bytes: Buffer) =>
  bytes.toString('latin1', 0, 6) === 'bplist' ? readBplist(bytes) : parsePlist(bytes.toString());

/** Lockdown's framing, which a service reached over a tunnel keeps: 32 bits of length, then a property list. */
export function lockdownFrame(message: Plist): Buffer {
  const body = Buffer.from(plistXml(message));
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  return Buffer.concat([head, body]);
}

/** The first whole message at the head of what has arrived, and what follows it. */
export function nextLockdownMessage(held: Buffer) {
  if (held.length < 4 || held.length < 4 + held.readUInt32BE(0)) return undefined;
  const end = 4 + held.readUInt32BE(0);
  return { message: readPlist(held.subarray(4, end)), rest: held.subarray(end) };
}

export function frame(message: Record<string, Plist>, tag: number): Buffer {
  const body = Buffer.from(plistXml(message), 'utf8');
  const head = Buffer.alloc(16);
  head.writeUInt32LE(16 + body.length, 0);
  head.writeUInt32LE(1, 4); // version: plist
  head.writeUInt32LE(8, 8); // type: plist message
  head.writeUInt32LE(tag, 12);
  return Buffer.concat([head, body]);
}

export type MuxDevice = { deviceId: number; serial: string; connection: string };

/** One request on a fresh multiplexer connection; resolves with the reply and the socket (left open). */
export async function muxRequest(
  message: Record<string, Plist>,
  path = USBMUXD,
  timeoutMs = 5_000,
) {
  return new Promise<{ reply: Record<string, Plist>; socket: Socket; rest: Buffer }>(
    (resolve, reject) => {
      const socket = connect(path);
      let buf = Buffer.alloc(0);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new DeviceError('TIMEOUT', 'the USB multiplexer did not answer'));
      }, timeoutMs);
      socket.on('error', (e) => {
        clearTimeout(timer);
        reject(
          new DeviceError('DEVICE_GONE', `the USB multiplexer is not reachable: ${e.message}`),
        );
      });
      socket.on('connect', () =>
        socket.write(frame({ ClientVersionString: 'appdyno', ProgName: 'appdyno', ...message }, 1)),
      );
      const onData = (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length < 16) return;
        const len = buf.readUInt32LE(0);
        if (buf.length < len) return;
        socket.off('data', onData);
        socket.pause();
        clearTimeout(timer);
        try {
          resolve({
            reply: parsePlist(buf.subarray(16, len).toString('utf8')) as Record<string, Plist>,
            socket,
            rest: buf.subarray(len),
          });
        } catch (e) {
          socket.destroy();
          reject(e);
        }
      };
      socket.on('data', onData);
    },
  );
}

export async function listDevices(path = USBMUXD): Promise<MuxDevice[]> {
  const { reply, socket } = await muxRequest({ MessageType: 'ListDevices' }, path);
  socket.destroy();
  const list = (reply.DeviceList as Record<string, Plist>[] | undefined) ?? [];
  return list.map((d) => {
    const p = d.Properties as Record<string, Plist>;
    return {
      deviceId: Number(d.DeviceID),
      serial: String(p.SerialNumber ?? ''),
      connection: String(p.ConnectionType ?? ''),
    };
  });
}

export const sameUdid = (a: string, b: string) =>
  a.replace(/-/g, '').toUpperCase() === b.replace(/-/g, '').toUpperCase();

/** A raw stream to `port` on the phone with this UDID, over USB (never the network). */
export async function connectPort(
  udid: string,
  port: number,
  path = USBMUXD,
): Promise<{ socket: Socket; rest: Buffer }> {
  const d = (await listDevices(path)).find(
    (x) => sameUdid(x.serial, udid) && x.connection === 'USB',
  );
  if (!d) throw new DeviceError('DEVICE_GONE', `iPhone ${udid} is not connected by USB`);
  // the port goes in network byte order
  const { reply, socket, rest } = await muxRequest(
    {
      MessageType: 'Connect',
      DeviceID: d.deviceId,
      PortNumber: ((port & 0xff) << 8) | (port >> 8),
    },
    path,
  );
  if (Number(reply.Number) !== 0) {
    socket.destroy();
    throw new DeviceError(
      'AGENT_UNAVAILABLE',
      `nothing listens on port ${port} of the iPhone (usbmux ${String(reply.Number)})`,
    );
  }
  socket.setNoDelay(true);
  return { socket, rest };
}

/** A phone on a cable: its UDID as the device tools write it, and the multiplexer's number for this plug-in. */
export type UsbAttach = { udid: string; deviceId: number };

/** The iPhones connected by USB. */
export async function listPhones(path = USBMUXD): Promise<UsbAttach[]> {
  return (await listDevices(path))
    .filter((d) => d.connection === 'USB')
    .map((d) => ({
      udid: /^[0-9A-F]{24}$/i.test(d.serial)
        ? `${d.serial.slice(0, 8)}-${d.serial.slice(8)}`
        : d.serial,
      deviceId: d.deviceId,
    }));
}
