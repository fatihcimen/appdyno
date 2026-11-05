import { createServer as createTls } from 'node:tls';
import { createServer as createNet, Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FramedLine, pairingFrame, XpcLine } from '../pairing-line.js';
import { PairingChannel, type Identity } from '../pairing.js';
import { N, opack, readTlv, srpClient, TAG, tlv } from '../pairing-wire.js';
import type { RemoteXpc } from '../remotexpc.js';
import { PhoneRefusal } from '../tunnel.js';
import { networkAddress, phonesIn, pskTls } from '../wifi.js';
import { XpcInt64 } from '../xpc-codec.js';
import { FakePhone } from './fake-phone.js';

const phones: FakePhone[] = [];
const channels: PairingChannel[] = [];

afterEach(() => {
  for (const c of channels.splice(0)) c.close();
  for (const p of phones.splice(0)) p.close();
});

const aPhone = async () => {
  const phone = await new FakePhone().start();
  phones.push(phone);
  return phone;
};

const open = async (phone: FakePhone) => {
  const socket = new Socket();
  await new Promise<void>((r) => socket.connect(phone.port, '127.0.0.1', r));
  const channel = new PairingChannel(new FramedLine(socket));
  channels.push(channel);
  return channel;
};

const paired = async (phone: FakePhone) => {
  const channel = await open(phone);
  await channel.handshake();
  await channel.verify();
  const identity = await channel.pair(() => undefined);
  channel.close();
  return identity;
};

/** A connection to something that sends these bytes as soon as it is asked anything. */
const answeredWith = async (bytes: Buffer) => {
  const server = createNet((s) => {
    s.once('data', () => s.write(bytes));
    s.on('error', () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const socket = new Socket();
  const { port } = server.address() as { port: number };
  await new Promise<void>((r) => socket.connect(port, '127.0.0.1', r));
  const channel = new PairingChannel(new FramedLine(socket));
  channels.push(channel);
  return { channel, server };
};

describe('what comes from the network', () => {
  it('bad words end the connection and nothing else', async () => {
    const junk = await answeredWith(Buffer.from('not what a phone says at all'));
    await expect(junk.channel.handshake()).rejects.toThrow('something else');
    junk.server.close();

    const framed = Buffer.from('RPPairing\0\x05{{{{{', 'latin1');
    const broken = await answeredWith(framed);
    await expect(broken.channel.handshake()).rejects.toThrow(/JSON/);
    broken.server.close();
  });

  it('a whole answer is read though the next has only begun', async () => {
    const whole = pairingFrame({
      message: {
        plain: {
          _0: { response: { _1: { handshake: { _0: { peerDeviceInfo: { name: 'a phone' } } } } } },
        },
      },
    });
    const { channel, server } = await answeredWith(Buffer.concat([whole, whole.subarray(0, 12)]));
    await expect(channel.handshake()).resolves.toEqual({ name: 'a phone' });
    server.close();
  });
});

describe('what carries a pairing', () => {
  it('on the network bytes go as base64 and numbers as numbers, as JSON has them', () => {
    const frame = pairingFrame({ data: Buffer.from('hi'), wire: new XpcInt64(19), step: 3n });
    expect(JSON.parse(frame.toString('utf8', 11))).toEqual({ data: 'aGk=', wire: 19, step: 3 });
  });

  it('by the cable messages go in an envelope, and what is not one is passed over', async () => {
    const xpc = {
      send: vi.fn(),
      next: vi
        .fn()
        .mockResolvedValueOnce({ ServiceVersion: 1 })
        .mockResolvedValueOnce({ value: { message: 'theirs' } }),
      close: vi.fn(),
    };
    const line = new XpcLine(xpc as unknown as RemoteXpc);
    line.send({ message: 'ours' });
    expect(xpc.send).toHaveBeenCalledWith(
      {
        mangledTypeName: 'RemotePairing.ControlChannelMessageEnvelope',
        value: { message: 'ours' },
      },
      true,
    );
    await expect(line.next(10)).resolves.toEqual({ message: 'theirs' });
  });

  it('on the network a phone need not say who it is', async () => {
    const answer = pairingFrame({
      message: {
        plain: { _0: { response: { _1: { handshake: { _0: { deviceOptions: {} } } } } } },
      },
    });
    const { channel, server } = await answeredWith(answer);
    await expect(channel.handshake()).resolves.toEqual({});
    server.close();
  });
});

describe('a pairing over the network', () => {
  it('makes an identity once a person accepts, and proves it on a new connection', async () => {
    const phone = await aPhone();
    const channel = await open(phone);
    expect(await channel.handshake()).toMatchObject({ udid: 'THE-UDID' });
    expect(await channel.verify()).toBe(false);
    const asked = vi.fn();
    const identity = await channel.pair(asked);
    expect(asked).toHaveBeenCalledOnce();
    expect(identity.phone).toBe('PHONE-IDENTIFIER');
    expect(phone.known.has(identity.host)).toBe(true);
    expect(phone.failedVerifies).toHaveLength(1);

    const again = await open(phone);
    await again.handshake();
    expect(await again.verify(identity)).toBe(true);
    await expect(again.listener()).resolves.toMatchObject({ port: phone.listenerPort });
  });

  it("waits for the person's word as long as they take", async () => {
    const phone = await aPhone();
    phone.consent = undefined;
    const channel = await open(phone);
    await channel.handshake();
    await channel.verify();
    const making = channel.pair(() => phone.answer(true));
    await expect(making).resolves.toMatchObject({ phone: 'PHONE-IDENTIFIER' });
  });

  it("a person's no is a refusal in the phone's words, and nothing is kept", async () => {
    const phone = await aPhone();
    phone.consent = false;
    const channel = await open(phone);
    await channel.handshake();
    await channel.verify();
    const failure = await channel.pair(() => undefined).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PhoneRefusal);
    expect(failure).toMatchObject({ need: 'not-trusted', message: 'the person said no' });
    expect(phone.known.size).toBe(0);
  });

  it('an identity the phone no longer keeps is a false, and no tunnel comes of it', async () => {
    const phone = await aPhone();
    const identity = await paired(phone);
    phone.known.clear();
    const channel = await open(phone);
    await channel.handshake();
    expect(await channel.verify(identity)).toBe(false);
    await expect(channel.listener()).rejects.toThrow('no pairing proved');
  });

  it('something that answers as the phone and cannot prove it is turned away', async () => {
    const phone = await aPhone();
    const identity = await paired(phone);
    phone.impostor = true;
    const channel = await open(phone);
    await channel.handshake();
    await expect(channel.verify(identity)).rejects.toMatchObject({ need: 'not-paired' });
  });

  it('a key that is not its own is refused by a real signature check', async () => {
    const phone = await aPhone();
    const identity = await paired(phone);
    const other = await aPhone();
    const forged: Identity = { ...(await paired(other)), host: identity.host };
    const channel = await open(phone);
    await channel.handshake();
    await expect(channel.verify(forged)).rejects.toBeInstanceOf(PhoneRefusal);
  });
});

describe('what a pairing is written in', () => {
  it('a long value goes in pieces under one tag, and comes back whole', () => {
    const value = Buffer.alloc(600, 7);
    const data = tlv([
      [TAG.publicKey, value],
      [TAG.state, Buffer.from([1])],
    ]);
    expect(data.length).toBe(600 + 3 * 2 + 3);
    const read = readTlv(data);
    expect(read.get(TAG.publicKey)).toEqual(value);
    expect(read.get(TAG.state)).toEqual(Buffer.from([1]));
    expect(tlv([[TAG.method, Buffer.alloc(0)]])).toEqual(Buffer.from([0, 0]));
  });

  it('an answer cut short says so', () => {
    expect(() => readTlv(Buffer.from([3, 10, 1]))).toThrow('cut short');
    expect(() => readTlv(Buffer.from([3]))).toThrow('cut short');
  });

  it('words about this Mac, in the form the phone keeps them', () => {
    expect(opack({ a: 'bc', d: Buffer.from([1, 2]) })).toEqual(
      Buffer.from([0xe2, 0x41, 0x61, 0x42, 0x62, 0x63, 0x41, 0x64, 0x72, 1, 2]),
    );
    expect(opack({ a: 'x'.repeat(0x21) }).subarray(3, 5)).toEqual(Buffer.from([0x61, 0x21]));
  });

  it('the group is the 3072-bit one a pairing is defined on', () => {
    expect(N.toString(2)).toHaveLength(3072);
    expect(N.toString(16).slice(0, 16)).toBe('ffffffffffffffff');
    expect(N.toString(16).slice(-24)).toBe('4b82d120a93ad2caffffffffffffffff'.slice(-24));
  });

  it('a key of nothing from the phone stops the sum', () => {
    expect(() => srpClient(Buffer.alloc(16), Buffer.alloc(384), '000000')).toThrow('no usable key');
  });
});

describe('finding a phone', () => {
  const browsed = [
    'Browsing for _remotepairing._tcp.local.',
    '_remotepairing._tcp                             PTR     5E1F._remotepairing._tcp',
    '5E1F._remotepairing._tcp SRV     0 0 49152 Test-iPhone.local. ; Replace with unicast FQDN of target host',
    '5E1F._remotepairing._tcp TXT     "identifier=5E1F0A2B" "authTag=Ab12Cd34" "ver=26" "minVer=8" "flags=0"',
  ];

  it('reads its name, host and port from what is advertised', () => {
    expect(phonesIn(browsed)).toEqual([
      { phone: '5E1F0A2B', host: 'Test-iPhone.local.', port: 49152 },
    ]);
    expect(phonesIn(browsed.slice(0, 3))).toEqual([]);
  });

  it('goes by its address on the network, never by the cable it may also be on', () => {
    const line = (at: string) =>
      ` 5:40:19.739  Add  40000003      19  Test-iPhone.local.   ${at}   120`;
    const cable = [
      line('FE80:0000:0000:0000:1C1F:95FA:B71A:DB13%en10'),
      line('169.254.245.184'),
      line('0.0.0.0'),
    ];
    expect(networkAddress(cable)).toBeUndefined();
    expect(networkAddress([...cable, line('FDA6:6F3A:5358:48DD:0877:5CCD:C78A:828C%<0>')])).toBe(
      'FDA6:6F3A:5358:48DD:0877:5CCD:C78A:828C',
    );
    expect(
      networkAddress([
        ...cable,
        line('FDA6:6F3A:5358:48DD:0877:5CCD:C78A:828C%<0>'),
        line('192.168.1.61'),
      ]),
    ).toBe('192.168.1.61');
  });
});

describe('the tunnel by the network', () => {
  it('its TLS is made with the key a proved pairing gives, and none other', async () => {
    const key = Buffer.alloc(32, 9);
    const server = createTls(
      { ciphers: 'PSK:@SECLEVEL=0', pskCallback: () => key },
      (s) => void s.end('in'),
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    const socketTo = async () => {
      const socket = new Socket();
      await new Promise<void>((r) => socket.connect(port, '127.0.0.1', r));
      return socket;
    };
    const tls = await pskTls(await socketTo(), key);
    const said = await new Promise<string>((r) => tls.once('data', (d: Buffer) => r(String(d))));
    expect(said).toBe('in');
    await expect(pskTls(await socketTo(), Buffer.alloc(32, 1))).rejects.toThrow();
    server.close();
  });
});
