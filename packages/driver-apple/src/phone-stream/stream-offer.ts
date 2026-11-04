import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { writeBplist } from '../webinspector.js';

/** The offer a phone's display service wants: a binary plist holding a deflated protobuf of what this end takes. */

/** Plain screen sharing up to 6 Mbit/s in 4:2:0, or the remote desktop profile of 20 to 60 and 4:4:4. */
export type StreamMode = 5 | 7;
const AUDIO_MODE: Record<StreamMode, number> = { 5: 6, 7: 8 };

const H264_PAYLOAD = 123;
const HEVC_PAYLOAD = 100;
const PAYLOAD_DESCRIPTOR = 0xc3c3;
const FEATURES: Record<StreamMode, string> = {
  5: 'FLS;MS:-1;LF:-1;LTR;CABAC;POS:0;EOD:1;HTS:2;RR:3;AR:16/9,5/8;XR:16/9,5/8;',
  7: 'FLS;LF:-1;POS:5;EOD:1;HTS:2;RR:3;POSE:4;SW:0;AR:1800/1169,5/8;XR:1800/1169,5/8;',
};

export type Endpoint = { model: string; avc: string; build: string };

const AVC_VERSION_PLIST =
  '/System/Library/PrivateFrameworks/AVConference.framework/Versions/A/Resources/version.plist';

/** This Mac, as it is: what the offer says of the side asking. */
export function thisMac(run: typeof execFileSync = execFileSync): Endpoint {
  const read = (file: string, args: string[]) =>
    run(file, args, { encoding: 'utf8', timeout: 5_000 }).trim();
  return {
    model: read('/usr/sbin/sysctl', ['-n', 'hw.model']),
    avc: read('/usr/bin/plutil', ['-extract', 'CFBundleVersion', 'raw', AVC_VERSION_PLIST]),
    build: read('/usr/bin/sw_vers', ['-buildVersion']),
  };
}

function varint(value: number | bigint): Buffer {
  const out: number[] = [];
  let n = BigInt(value);
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}

type Field = [number, number | bigint | string | Buffer];

function protobuf(fields: Field[]): Buffer {
  return Buffer.concat(
    fields.map(([id, v]) => {
      if (typeof v === 'number' || typeof v === 'bigint') {
        return Buffer.concat([varint(id << 3), varint(v)]);
      }
      const b = Buffer.isBuffer(v) ? v : Buffer.from(v);
      return Buffer.concat([varint((id << 3) | 2), varint(b.length), b]);
    }),
  );
}

const parameter = (id: number, value: number, flags?: number): Field => [
  9,
  protobuf([[1, id], [2, value], ...(flags === undefined ? [] : ([[3, flags]] as Field[]))]),
];

/** A time as NTP has it: seconds since 1900 in the upper half. */
const ntpNow = (now: number) => BigInt(Math.floor(now / 1000) + 2_208_988_800) << 32n;

const common = (now: number): Field[] => [
  [6, 'Viceroy 1.7.0'],
  [8, 0],
  parameter(0, 20_000_000, 0x18000),
  parameter(4074, 0, 0x4000),
  parameter(0, 60_000_000, 0x40000),
  parameter(0, 40_000_000, 0x3000),
  parameter(16, 4100),
  parameter(0, 6_000_000, 0x20000),
  parameter(4, 6500),
  parameter(0, 100_000_000, 0x100000),
  parameter(1, 299),
  parameter(0, 75_000_000, 0x80000),
  [13, ntpNow(now)],
  [14, 2],
  [16, 0],
  [18, 1],
];

const descriptor = (variant: number): Field => [
  2,
  protobuf([
    [1, 1],
    [2, variant],
    [3, PAYLOAD_DESCRIPTOR],
    [4, 0],
  ]),
];

function videoBlob(mode: StreamMode, ssrc: number, now: number) {
  const h264 = protobuf([
    [1, H264_PAYLOAD],
    descriptor(1),
    descriptor(2),
    descriptor(1),
    descriptor(2),
    [3, 'FLS;SW:1;'],
    [4, 1],
  ]);
  const hevc = protobuf([
    [1, HEVC_PAYLOAD],
    descriptor(1),
    descriptor(2),
    [3, FEATURES[mode]],
    [4, 14],
  ]);
  return protobuf([
    [1, 1],
    [2, 1],
    [
      5,
      protobuf([
        [1, ssrc],
        [2, 0],
        [3, h264],
        [3, hevc],
        [7, 1],
        [8, 63],
        [12, 1],
      ]),
    ],
    ...common(now),
  ]);
}

function audioBlob(ssrc: number, now: number) {
  return protobuf([
    [1, 1],
    [2, 1],
    [
      3,
      protobuf([
        [1, ssrc],
        [2, 0],
        [3, 0],
        [4, 24191],
        [5, 0],
        [6, 0],
      ]),
    ],
    ...common(now),
  ]);
}

function offer(blob: Buffer, mode: number, endpoint: Endpoint) {
  return writeBplist({
    avcMediaStreamOptionCallID: randomUUID().toUpperCase(),
    avcMediaStreamNegotiatorMediaBlob: deflateSync(blob),
    avcMediaStreamNegotiatorMode: mode,
    avcMediaStreamOptionRemoteEndpointInfo: protobuf([
      [1, 0],
      [2, 1],
      [3, endpoint.model],
      [4, endpoint.avc],
      [5, endpoint.build],
    ]),
  });
}

export const videoOffer = (mode: StreamMode, ssrc: number, endpoint: Endpoint, now = Date.now()) =>
  offer(videoBlob(mode, ssrc, now), mode, endpoint);

export const audioOffer = (mode: StreamMode, ssrc: number, endpoint: Endpoint, now = Date.now()) =>
  offer(audioBlob(ssrc, now), AUDIO_MODE[mode], endpoint);
