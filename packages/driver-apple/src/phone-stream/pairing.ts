import {
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
  type JsonWebKey,
} from 'node:crypto';
import { hostname } from 'node:os';
import {
  countNonce,
  derive,
  opack,
  readTlv,
  seal,
  srpClient,
  stepNonce,
  TAG,
  tlv,
  unseal,
} from './pairing-wire.js';
import type { Message, PairingLine } from './pairing-line.js';
import { PhoneRefusal } from './tunnel.js';
import { XpcInt64 } from './xpc-codec.js';

/**
 * This process's own pairing with a phone, which the phone keeps apart from the pair record: an identity of its own,
 * made once on the cable with a person accepting on the phone, proved on the network at each start, and giving a key
 * for one tunnel.
 */

const WIRE_VERSION = 19;
/** The phone asks a person: a code is what the method is built on, and the person's word is what stands behind it. */
const CONSENT_CODE = '000000';
const ANSWER_MS = 8_000;
/** How long a person has to read the phone's question and answer it. */
const CONSENT_MS = 120_000;
export const X25519_SPKI = Buffer.from('302a300506032b656e032100', 'hex');
export const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const RAW_KEY = 32;

export type Identity = {
  /** How this Mac is known to the phone. */
  host: string;
  /** The key the phone keeps the public half of. */
  key: JsonWebKey;
  /** How the phone calls itself on the network. */
  phone: string;
  /** What the phone proves itself with, base64: anything else on the network that answers as it is turned away. */
  phoneKey: string;
};

export const lastBytes = (key: { export(o: { format: 'der'; type: 'spki' }): Buffer }) =>
  key.export({ format: 'der', type: 'spki' }).subarray(-RAW_KEY);

export const rawKey = (prefix: Buffer, raw: Buffer) =>
  createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' });

/** The signature of a phone that holds `key` under `signed`. */
const signedBy = (key: Buffer, signed: Buffer, signature: Buffer | undefined) =>
  signature !== undefined && verify(null, signed, rawKey(ED25519_SPKI, key), signature);

const b64 = (b: Buffer) => b.toString('base64');

/** What answered did not prove itself the phone paired, so nothing it said is the phone's word. */
export class NotProved extends Error {}
const bytes = (v: unknown) =>
  Buffer.isBuffer(v) ? v : Buffer.from(typeof v === 'string' ? v : '', 'base64');

/** What a phone's control connection speaks: one framed message at a time, plain until a pairing is proved. */
export class PairingChannel {
  private sequence = 0;
  private sealed = 0;
  private shared: Buffer | undefined;

  constructor(private readonly line: PairingLine) {}

  private next(ms = ANSWER_MS): Promise<Message> {
    return this.line.next(ms);
  }

  private send(message: Message) {
    this.line.send({ message, originatedBy: 'host', sequenceNumber: BigInt(this.sequence++) });
  }

  private sendPlain(body: Message) {
    this.send({ plain: { _0: body } });
  }

  private async plainAnswer(ms?: number) {
    const { message } = (await this.next(ms)) as { message?: { plain?: { _0?: Message } } };
    const body = message?.plain?._0;
    if (!body) throw new Error('the phone answered out of step');
    return body;
  }

  /** The phone's words on itself, with a pairing's first step left open. */
  async handshake() {
    this.sendPlain({
      request: {
        _0: {
          handshake: {
            _0: {
              hostOptions: { attemptPairVerify: true },
              wireProtocolVersion: new XpcInt64(WIRE_VERSION),
            },
          },
        },
      },
    });
    const answer = (await this.plainAnswer()) as {
      response?: { _1?: { handshake?: { _0?: { peerDeviceInfo?: Message } } } };
    };
    const shook = answer.response?._1?.handshake?._0;
    if (!shook) throw new Error('the phone did not take the handshake');
    // only inside a cable's tunnel: on the network it does not say who it is
    return shook.peerDeviceInfo ?? {};
  }

  private sendPairing(kind: string, data: Buffer, first: boolean, extra: Message = {}) {
    this.sendPlain({
      event: {
        _0: {
          pairingData: { _0: { data, kind, startNewSession: first, ...extra } },
        },
      },
    });
  }

  /** An answer to a pairing's step, read; what the phone refused with stops here, in its words. */
  private async pairingAnswer(ms?: number) {
    type Event = {
      event?: {
        _0?: {
          pairingData?: { _0?: { data?: unknown } };
          awaitingUserConsent?: unknown;
          pairingRejectedWithError?: {
            wrappedError?: { userInfo?: { NSLocalizedDescription?: string } };
          };
        };
      };
    };
    for (;;) {
      const event = ((await this.plainAnswer(ms)) as Event).event?._0;
      const refused = event?.pairingRejectedWithError;
      if (refused) {
        throw new PhoneRefusal(
          'not-trusted',
          refused.wrappedError?.userInfo?.NSLocalizedDescription ?? 'the phone refused to pair',
        );
      }
      const data = event?.pairingData?._0?.data;
      if (data !== undefined) return readTlv(bytes(data));
      if (!event || !('awaitingUserConsent' in event)) {
        throw new Error('the phone answered a pairing out of step');
      }
    }
  }

  /**
   * Proves `identity` to the phone. False when it does not know it, or with none, which is how a new pairing starts;
   * the key for a tunnel is held when it does. What has not proved itself the phone is a `NotProved`: anyone on a network
   * can answer as one, and its words are not shown as the phone's, nor are those that come in the clear after the proof.
   */
  async verify(identity?: Identity): Promise<boolean> {
    const { publicKey, privateKey } = generateKeyPairSync('x25519');
    const ours = lastBytes(publicKey);
    const kind = 'verifyManualPairing';
    this.sendPairing(
      kind,
      tlv([
        [TAG.state, Buffer.from([1])],
        [TAG.publicKey, ours],
      ]),
      true,
    );
    const first = await this.pairingAnswer().catch((e: unknown) => {
      if (identity && e instanceof PhoneRefusal)
        throw new NotProved('it refused before it proved itself');
      throw e;
    });
    const theirs = first.get(TAG.publicKey);
    if (!identity) return this.notKnown();
    if (!theirs) throw this.notProved('it gave no key');
    const shared = diffieHellman({ privateKey, publicKey: rawKey(X25519_SPKI, theirs) });
    const host = Buffer.from(identity.host);
    const key = derive(shared, 'Pair-Verify-Encrypt-Salt', 'Pair-Verify-Encrypt-Info');
    const said = readTlv(
      unseal(key, stepNonce('PV-Msg02'), first.get(TAG.encrypted) ?? Buffer.alloc(0)),
    );
    const who = said.get(TAG.identifier) ?? Buffer.alloc(0);
    if (
      !signedBy(
        bytes(identity.phoneKey),
        Buffer.concat([theirs, who, ours]),
        said.get(TAG.signature),
      )
    ) {
      throw this.notProved('it answered as the phone and did not prove it');
    }
    const proof = sign(
      null,
      Buffer.concat([ours, host, theirs]),
      createPrivateKey({ key: identity.key, format: 'jwk' }),
    );
    const inner = tlv([
      [TAG.identifier, host],
      [TAG.signature, proof],
    ]);
    this.sendPairing(
      kind,
      tlv([
        [TAG.state, Buffer.from([3])],
        [TAG.encrypted, seal(key, stepNonce('PV-Msg03'), inner)],
      ]),
      false,
    );
    const second = await this.pairingAnswer().catch((e: unknown) => {
      if (e instanceof PhoneRefusal) return undefined;
      throw e;
    });
    if (!second || second.has(TAG.error)) return this.notKnown();
    this.shared = shared;
    return true;
  }

  private notKnown() {
    this.sendPlain({ event: { _0: { pairVerifyFailed: {} } } });
    return false;
  }

  /** The verify is left as one that failed, so that on a cable a new pairing can follow on the same connection. */
  private notProved(why: string) {
    this.notKnown();
    return new NotProved(why);
  }

  /**
   * Makes an identity with the phone, which asks a person: `asked` is called when it does. The phone closes the
   * connection after, and a new one proves what was made.
   */
  async pair(asked: () => void): Promise<Identity> {
    const kind = 'setupManualPairing';
    const name = hostname();
    const extra = { sendingHost: name };
    this.sendPairing(
      kind,
      tlv([
        [TAG.method, Buffer.from([0])],
        [TAG.state, Buffer.from([1])],
      ]),
      true,
      extra,
    );
    asked();
    const offer = await this.pairingAnswer(CONSENT_MS);
    const salt = offer.get(TAG.salt);
    const offered = offer.get(TAG.publicKey);
    if (!salt || !offered) throw new PhoneRefusal('not-trusted', 'the phone did not agree');
    const srp = srpClient(salt, offered, CONSENT_CODE);
    this.sendPairing(
      kind,
      tlv([
        [TAG.state, Buffer.from([3])],
        [TAG.publicKey, srp.publicKey],
        [TAG.proof, srp.proof],
      ]),
      false,
      extra,
    );
    const proved = await this.pairingAnswer();
    if (!proved.get(TAG.proof)?.equals(srp.phoneProof)) {
      throw new PhoneRefusal('not-trusted', 'the phone did not prove the pairing');
    }
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const host = randomUUID().toUpperCase();
    const ours = lastBytes(publicKey);
    const signing = derive(
      srp.key,
      'Pair-Setup-Controller-Sign-Salt',
      'Pair-Setup-Controller-Sign-Info',
    );
    const inner = tlv([
      [TAG.identifier, Buffer.from(host)],
      [TAG.publicKey, ours],
      [TAG.signature, sign(null, Buffer.concat([signing, Buffer.from(host), ours]), privateKey)],
      [
        TAG.info,
        opack({
          altIRK: randomBytes(16),
          btAddr: '02:00:00:00:00:00',
          mac: Buffer.from('020000000000', 'hex'),
          remotepairing_serial_number: host.slice(0, 12),
          accountID: host,
          model: 'appdyno',
          name: `appdyno on ${name}`,
        }),
      ],
    ]);
    const setupKey = derive(srp.key, 'Pair-Setup-Encrypt-Salt', 'Pair-Setup-Encrypt-Info');
    this.sendPairing(
      kind,
      tlv([
        [TAG.state, Buffer.from([5])],
        [TAG.encrypted, seal(setupKey, stepNonce('PS-Msg05'), inner)],
      ]),
      false,
      extra,
    );
    const done = await this.pairingAnswer();
    const sealed = done.get(TAG.encrypted);
    if (!sealed) throw new PhoneRefusal('not-trusted', 'the phone did not keep the pairing');
    const kept = readTlv(unseal(setupKey, stepNonce('PS-Msg06'), sealed));
    const phoneKey = kept.get(TAG.publicKey);
    const signed = derive(
      srp.key,
      'Pair-Setup-Accessory-Sign-Salt',
      'Pair-Setup-Accessory-Sign-Info',
    );
    const who = kept.get(TAG.identifier) ?? Buffer.alloc(0);
    if (
      !phoneKey ||
      !signedBy(phoneKey, Buffer.concat([signed, who, phoneKey]), kept.get(TAG.signature))
    ) {
      throw new PhoneRefusal('not-trusted', 'the phone did not prove the pairing');
    }
    return {
      host,
      key: privateKey.export({ format: 'jwk' }),
      phone: who.toString(),
      phoneKey: b64(phoneKey),
    };
  }

  /** Asks for a listener for one tunnel: its port, and the key its TLS is made with. */
  async listener(): Promise<{ port: number; key: Buffer }> {
    const shared = this.shared;
    if (!shared) throw new Error('no pairing proved on this connection');
    const out = derive(shared, '', 'ClientEncrypt-main');
    const back = derive(shared, '', 'ServerEncrypt-main');
    const count = this.sealed++;
    const request = {
      request: {
        _0: {
          createListener: {
            key: b64(shared),
            peerConnectionsInfo: [{ owningPID: process.pid, owningProcessName: 'appdyno' }],
            transportProtocolType: 'tcp',
          },
        },
      },
    };
    this.send({
      streamEncrypted: {
        _0: seal(out, countNonce(count), Buffer.from(JSON.stringify(request))),
      },
    });
    const { message } = (await this.next()) as { message?: { streamEncrypted?: { _0?: string } } };
    const body = unseal(back, countNonce(count), bytes(message?.streamEncrypted?._0));
    const answer = JSON.parse(body.toString()) as {
      response?: { _1?: { createListener?: { port?: number }; errorExtended?: unknown } };
    };
    const port = answer.response?._1?.createListener?.port;
    if (!port) {
      throw new Error(
        `the phone opened no tunnel: ${JSON.stringify(answer.response?._1?.errorExtended ?? {})}`,
      );
    }
    return { port, key: shared };
  }

  close() {
    this.line.close();
  }
}
