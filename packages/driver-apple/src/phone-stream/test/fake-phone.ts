import { diffieHellman, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { createServer, type Server, Socket } from 'node:net';
import { afterEach } from 'vitest';
import { FramedLine, pairingFrame } from '../pairing-line.js';
import { ED25519_SPKI, lastBytes, PairingChannel, rawKey, X25519_SPKI } from '../pairing.js';
import {
  big,
  countNonce,
  derive,
  N as SRP_N,
  power,
  readTlv,
  seal,
  sha512,
  stepNonce,
  TAG,
  tlv,
  unseal,
  wide,
} from '../pairing-wire.js';

/** A phone's end of a network pairing, on a loopback port: what a test needs a phone to say and to check. */

/** Fake phones, and pairing channels to them or to any port, all closed after each test. */
export function fakePhones() {
  const phones: FakePhone[] = [];
  const channels: PairingChannel[] = [];
  afterEach(() => {
    for (const c of channels.splice(0)) c.close();
    for (const p of phones.splice(0)) p.close();
  });
  const channelTo = async (port: number) => {
    const socket = new Socket();
    await new Promise<void>((r) => socket.connect(port, '127.0.0.1', r));
    const channel = new PairingChannel(new FramedLine(socket));
    channels.push(channel);
    return channel;
  };
  return {
    aPhone: async () => {
      const phone = await new FakePhone().start();
      phones.push(phone);
      return phone;
    },
    open: (phone: FakePhone) => channelTo(phone.port),
    channelTo,
  };
}

type Body = {
  message: {
    plain?: { _0: Record<string, unknown> };
    streamEncrypted?: { _0: string };
  };
};

export class FakePhone {
  private server: Server | undefined;
  private readonly ed = generateKeyPairSync('ed25519');
  private readonly who = Buffer.from('PHONE-IDENTIFIER');
  /** The hosts it keeps, by their identifier. */
  readonly known = new Map<string, Buffer>();
  /** How a person answers its question; undefined waits for `answer`. */
  consent: boolean | undefined = true;
  /** Set to answer with another key than the one that paired. */
  impostor = false;
  /** Set to refuse a verify at its first step, before proving anything, in these words. */
  refusesWith: string | undefined;
  readonly failedVerifies: number[] = [];
  listenerPort = 4242;
  port = 0;
  private person: ((yes: boolean) => void) | undefined;
  udid: string | undefined = 'THE-UDID';

  async start() {
    this.server = createServer((s) => this.serve(s));
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as { port: number }).port;
    return this;
  }

  close() {
    this.server?.close();
  }

  answer(yes: boolean) {
    if (this.person) this.person(yes);
    else this.consent = yes;
  }

  private serve(socket: Socket) {
    let held = Buffer.alloc(0);
    let sequence = 0;
    const send = (message: unknown) =>
      socket.write(pairingFrame({ message, originatedBy: 'device', sequenceNumber: sequence++ }));
    const plain = (body: unknown) => send({ plain: { _0: body } });
    const pairing = (data: Buffer) =>
      plain({ event: { _0: { pairingData: { _0: { data: data.toString('base64') } } } } });
    const session: {
      verifyKey?: Buffer;
      shared?: Buffer;
      theirs?: Buffer;
      ours?: Buffer;
      srp?: { salt: Buffer; b: bigint; B: bigint; v: bigint };
      key?: Buffer;
    } = {};

    const onSetup = async (data: Map<number, Buffer>) => {
      const state = data.get(TAG.state)![0];
      if (state === 1) {
        plain({ event: { _0: { awaitingUserConsent: {} } } });
        const yes =
          this.consent ??
          (await new Promise<boolean>((resolve) => {
            this.person = resolve;
          }));
        if (!yes) {
          plain({
            event: {
              _0: {
                pairingRejectedWithError: {
                  wrappedError: { userInfo: { NSLocalizedDescription: 'the person said no' } },
                },
              },
            },
          });
          return;
        }
        const salt = randomBytes(16);
        const x = big(sha512(salt, sha512(Buffer.from('Pair-Setup:000000'))));
        const v = power(5n, x);
        const b = big(randomBytes(32));
        const k = big(sha512(wide(SRP_N), wide(5n)));
        const B = (((k * v) % SRP_N) + power(5n, b)) % SRP_N;
        session.srp = { salt, b, B, v };
        pairing(
          tlv([
            [TAG.state, Buffer.from([2])],
            [TAG.salt, salt],
            [TAG.publicKey, wide(B)],
          ]),
        );
      } else if (state === 3) {
        const { b, B, v, salt } = session.srp!;
        const A = big(data.get(TAG.publicKey)!);
        const u = big(sha512(wide(A), wide(B)));
        const S = power((A * power(v, u)) % SRP_N, b);
        const key = sha512(wide(S));
        session.key = key;
        const group = Buffer.from(sha512(wide(SRP_N)));
        const g = sha512(Buffer.from([5]));
        group.forEach((value, i) => (group[i] = value ^ g[i]!));
        const expected = sha512(
          group,
          sha512(Buffer.from('Pair-Setup')),
          salt,
          wide(A),
          wide(B),
          key,
        );
        const proof = data.get(TAG.proof)!;
        if (!proof.equals(expected)) {
          pairing(
            tlv([
              [TAG.state, Buffer.from([4])],
              [TAG.error, Buffer.from([2])],
            ]),
          );
          return;
        }
        pairing(
          tlv([
            [TAG.state, Buffer.from([4])],
            [TAG.proof, sha512(wide(A), proof, key)],
          ]),
        );
      } else if (state === 5) {
        const key = session.key!;
        const box = derive(key, 'Pair-Setup-Encrypt-Salt', 'Pair-Setup-Encrypt-Info');
        const inner = readTlv(unseal(box, stepNonce('PS-Msg05'), data.get(TAG.encrypted)!));
        const host = inner.get(TAG.identifier)!;
        const hostKey = inner.get(TAG.publicKey)!;
        const signing = derive(
          key,
          'Pair-Setup-Controller-Sign-Salt',
          'Pair-Setup-Controller-Sign-Info',
        );
        if (
          !verify(
            null,
            Buffer.concat([signing, host, hostKey]),
            rawKey(ED25519_SPKI, hostKey),
            inner.get(TAG.signature)!,
          )
        ) {
          throw new Error('the host did not sign');
        }
        this.known.set(host.toString(), hostKey);
        const mine = lastBytes(this.ed.publicKey);
        const accessory = derive(
          key,
          'Pair-Setup-Accessory-Sign-Salt',
          'Pair-Setup-Accessory-Sign-Info',
        );
        const reply = tlv([
          [TAG.identifier, this.who],
          [TAG.publicKey, mine],
          [
            TAG.signature,
            sign(null, Buffer.concat([accessory, this.who, mine]), this.ed.privateKey),
          ],
        ]);
        pairing(
          tlv([
            [TAG.state, Buffer.from([6])],
            [TAG.encrypted, seal(box, stepNonce('PS-Msg06'), reply)],
          ]),
        );
        socket.end();
      }
    };

    const onVerify = (data: Map<number, Buffer>) => {
      const state = data.get(TAG.state)![0];
      if (state === 1 && this.refusesWith) {
        plain({
          event: {
            _0: {
              pairingRejectedWithError: {
                wrappedError: { userInfo: { NSLocalizedDescription: this.refusesWith } },
              },
            },
          },
        });
        return;
      }
      if (state === 1) {
        const theirs = data.get(TAG.publicKey)!;
        const { publicKey, privateKey } = generateKeyPairSync('x25519');
        const ours = lastBytes(publicKey);
        const shared = diffieHellman({ privateKey, publicKey: rawKey(X25519_SPKI, theirs) });
        Object.assign(session, { theirs, ours, shared });
        session.verifyKey = derive(shared, 'Pair-Verify-Encrypt-Salt', 'Pair-Verify-Encrypt-Info');
        const signer = this.impostor
          ? generateKeyPairSync('ed25519').privateKey
          : this.ed.privateKey;
        const inner = tlv([
          [TAG.identifier, this.who],
          [TAG.signature, sign(null, Buffer.concat([ours, this.who, theirs]), signer)],
        ]);
        pairing(
          tlv([
            [TAG.state, Buffer.from([2])],
            [TAG.publicKey, ours],
            [TAG.encrypted, seal(session.verifyKey, stepNonce('PV-Msg02'), inner)],
          ]),
        );
        return;
      }
      const inner = readTlv(
        unseal(session.verifyKey!, stepNonce('PV-Msg03'), data.get(TAG.encrypted)!),
      );
      const host = inner.get(TAG.identifier)!;
      const key = this.known.get(host.toString());
      const signed = Buffer.concat([session.theirs!, host, session.ours!]);
      const good =
        key !== undefined &&
        verify(null, signed, rawKey(ED25519_SPKI, key), inner.get(TAG.signature)!);
      pairing(
        good
          ? tlv([[TAG.state, Buffer.from([4])]])
          : tlv([
              [TAG.state, Buffer.from([4])],
              [TAG.error, Buffer.from([2])],
            ]),
      );
    };

    const onEncrypted = (sealed: string) => {
      const shared = session.shared!;
      const request = JSON.parse(
        unseal(
          derive(shared, '', 'ClientEncrypt-main'),
          countNonce(0),
          Buffer.from(sealed, 'base64'),
        ).toString(),
      ) as { request: { _0: { createListener?: { key: string } } } };
      const asked = request.request._0.createListener;
      const body =
        asked?.key === shared.toString('base64')
          ? { response: { _1: { createListener: { port: this.listenerPort } } } }
          : { response: { _1: { errorExtended: { reason: 'no such key' } } } };
      send({
        streamEncrypted: {
          _0: seal(
            derive(shared, '', 'ServerEncrypt-main'),
            countNonce(0),
            Buffer.from(JSON.stringify(body)),
          ).toString('base64'),
        },
      });
    };

    const onMessage = async ({ message }: Body) => {
      if (message.streamEncrypted) {
        onEncrypted(message.streamEncrypted._0);
        return;
      }
      const body = message.plain!._0 as {
        request?: unknown;
        event?: {
          _0: { pairVerifyFailed?: unknown; pairingData?: { _0: Record<string, unknown> } };
        };
      };
      if (body.request) {
        plain({
          response: {
            _1: {
              handshake: {
                _0: {
                  peerDeviceInfo: {
                    identifier: this.who.toString(),
                    ...(this.udid && { udid: this.udid }),
                  },
                },
              },
            },
          },
        });
        return;
      }
      const event = body.event!._0;
      if ('pairVerifyFailed' in event) {
        this.failedVerifies.push(1);
        return;
      }
      const { kind, data } = event.pairingData!._0 as { kind: string; data: string };
      const fields = readTlv(Buffer.from(data, 'base64'));
      if (kind === 'verifyManualPairing') onVerify(fields);
      else await onSetup(fields);
    };

    let turn = Promise.resolve();
    socket.on('data', (d: Buffer) => {
      held = Buffer.concat([held, d]);
      while (held.length >= 11) {
        const end = 11 + held.readUInt16BE(9);
        if (held.length < end) break;
        const body = JSON.parse(held.toString('utf8', 11, end)) as Body;
        held = held.subarray(end);
        turn = turn.then(() => onMessage(body));
      }
    });
    socket.on('error', () => undefined);
  }
}
