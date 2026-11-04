import { randomBytes, randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { DeviceState, InputEvent, MirrorQuality, Need } from '@appdyno/core';
import type { IpStack, UdpSocket } from './ipstack.js';
import { PhoneHid } from './phone-hid.js';
import { RemoteXpc } from './remotexpc.js';
import { RtcpWriter, RtpReceiver, type Picture } from './rtp-hevc.js';
import {
  DISPLAY,
  HID_INDIGO,
  HID_UNIVERSAL,
  invoke,
  readServices,
  takeScreenshot,
  type ServiceList,
} from './services.js';
import { imageSize } from '../mirror-phone.js';
import { turnsOf } from '../mirror-sim.js';
import { audioOffer, thisMac, videoOffer, type StreamMode } from './stream-offer.js';
import {
  compact,
  DarkWatch,
  dict,
  needOf,
  number,
  ownSessions,
  rememberOwn,
  sessionsOf,
  StreamRefusal,
} from './stream-state.js';
import { openTunnel, orientationReader, PhoneRefusal } from './tunnel.js';
import { XpcInt64, XpcUuid } from './xpc-codec.js';

const FEATURE = 'com.apple.coredevice.feature.';
const STOP_ACTION = 'com.apple.coredevice.action.mediastreamstop';
/**
 * How long a phone keeps a stream with no report from us. Ours come each second, so this is how long a stream outlives a
 * process that died: the phone's own default of an hour would keep its indicator on, and the next start out.
 */
const STREAM_TIMEOUT_S = 30n;
const SUPPORTED_FEATURES = 140n;
const RATE_CONTROL_MS = 50;
const LAG_RESOLUTION_MS = 5;
const TURNS_CHECK_MS = 250;
const ALIVE_MS = 1_000;
const WATCH_MS = 2_000;

export interface StreamSink {
  live(info: { w: number; h: number; mode: string; crop: boolean }): void;
  picture(p: Picture): void;
  state(s: DeviceState): void;
  counters(c: Record<string, number>): void;
  turns(turns: number): void;
  lost(why: string, need?: Need): void;
}

/** One stream's whole life on a phone: tunnel, offer, RTP, RTCP, input, and the proof it has ended. */
export class PhoneStream {
  private timers: NodeJS.Timeout[] = [];
  private video: UdpSocket | undefined;
  private audio: UdpSocket | undefined;
  private display: RemoteXpc | undefined;
  private services: ServiceList | undefined;
  private indigo: RemoteXpc | undefined;
  private universal: RemoteXpc | undefined;
  private hid: PhoneHid | undefined;
  private inputs: Promise<void> = Promise.resolve();
  private stack: IpStack | undefined;
  private stopped = false;
  private readonly dark = new DarkWatch();
  private turns = 0;
  private closeOrientation: (() => void) | undefined;
  private videoPort = 0;
  private audioPort = 0;
  private receiver: RtpReceiver | undefined;
  private rtcp: RtcpWriter | undefined;

  private constructor(
    private readonly udid: string,
    private readonly sink: StreamSink,
  ) {}

  static async open(udid: string, quality: MirrorQuality, sink: StreamSink): Promise<PhoneStream> {
    const stream = new PhoneStream(udid, sink);
    try {
      await stream.start(quality);
      return stream;
    } catch (e) {
      // what it closes on its way out is no news: the failure is the reason
      stream.stopped = true;
      stream.release();
      if (e instanceof PhoneRefusal) throw new StreamRefusal(e.need, e.message);
      throw e;
    }
  }

  private async start(quality: MirrorQuality) {
    const { stack, rsdPort } = await openTunnel(this.udid);
    this.stack = stack;
    stack.onEnded((why) => this.onLost(why));
    this.services = await readServices(stack, rsdPort);
    const port = this.services.ports[DISPLAY];
    if (!port) {
      throw new StreamRefusal('disk-image-missing', 'the phone lists no display service');
    }
    const display = RemoteXpc.start(await stack.connect(port));
    this.display = display;
    await invoke(display, `${FEATURE}getmediasupportinfo`, {});
    const before = sessionsOf(await invoke(display, `${FEATURE}getmediastreamserverstatus`, {}));
    const mine = ownSessions(this.udid).map(compact);
    if (before.some((id) => !mine.includes(compact(id)))) {
      throw new StreamRefusal('taken-over', 'another app has a stream from this phone');
    }
    // only ours are there, as `stopAll` is all there is: what a process that died left behind
    if (before.length)
      await invoke(display, `${FEATURE}stopmediastream`, { stopAll: true }, STOP_ACTION);
    rememberOwn(this.udid, []);
    const ladder: StreamMode[] = quality === 'standard' ? [5] : [7, 5];
    let lastError: unknown;
    for (const mode of ladder) {
      try {
        await this.startStreams(stack, display, mode);
        return;
      } catch (e) {
        lastError = e;
        const words = (e as Error).message;
        const need = needOf(words);
        if (need) throw new StreamRefusal(need, words);
      }
    }
    throw lastError;
  }

  private async startStreams(stack: IpStack, display: RemoteXpc, mode: StreamMode) {
    const remote = stack.remoteAddress;
    const local = stack.localAddress;
    const endpoint = thisMac();
    const session = randomUUID();
    rememberOwn(this.udid, [session]);
    const ssrc = randomBytes(4).readUInt32BE();
    this.audio = stack.createUdp();
    this.video = stack.createUdp();
    const rtcp = new RtcpWriter(ssrc);
    this.rtcp = rtcp;
    const params = (type: string, udp: UdpSocket, offer: Buffer, video: boolean) => ({
      receiverIP: local,
      receiverPort: BigInt(udp.localPort),
      senderIP: remote,
      senderPort: BigInt(udp.localPort + 1),
      timeout: STREAM_TIMEOUT_S,
      type,
      direction: 'output',
      negotiatorOffer: offer,
      clientSupportedFeatures: SUPPORTED_FEATURES,
      options: {
        AVCMediaStreamNegotiatorTransportProtocolType: { int: new XpcInt64(2) },
        AVCMediaStreamNegotiatorAccessNetworkType: { int: new XpcInt64(1) },
        avcMediaStreamOptionClientSessionID: { uuid: new XpcUuid(session) },
        ...(video && {
          CoreDeviceVideoDisplayMode: { string: 'DisplayByID' },
          VideoStreamForDisplayID: { int: new XpcInt64(1) },
        }),
      },
    });
    const start = (input: ReturnType<typeof params>) =>
      invoke(display, `${FEATURE}startmediastream`, input);
    const audioAnswer = await start(
      params('audio', this.audio, audioOffer(mode, randomBytes(4).readUInt32BE(), endpoint), false),
    );
    this.audioPort = number(dict(dict(audioAnswer.connection).sender).port);
    const receiver = new RtpReceiver(
      (p) => this.onPicture(p),
      () => this.toPhone(rtcp.askForKey(receiver.sender)),
    );
    this.receiver = receiver;
    this.video.message = (m, from) => {
      this.videoPort = from;
      receiver.push(m);
    };
    this.audio.message = (_m, from) => {
      this.audioPort = from;
    };
    const answer = await start(params('video', this.video, videoOffer(mode, ssrc, endpoint), true));
    const connection = dict(answer.connection);
    const config = dict(connection.streamConfig);
    this.videoPort ||= number(dict(connection.sender).port);
    // the lower mode codes a larger picture, with the screen at its top left
    const screen = mode === 5 ? await this.screenSize().catch(() => undefined) : undefined;
    this.sink.live({
      w: screen?.w ?? number(config.CustomWidth),
      h: screen?.h ?? number(config.CustomHeight),
      mode: `mode ${mode}`,
      crop: screen !== undefined,
    });
    this.runTimers(rtcp, receiver);
  }

  private async screenSize() {
    const size = imageSize(await takeScreenshot(this.stack!, this.services!, 'png'));
    if (!size) throw new Error('a screenshot with no size');
    return size;
  }

  private toPhone(packet: Buffer) {
    if (this.videoPort) this.video?.send(packet, this.videoPort);
  }

  private runTimers(rtcp: RtcpWriter, receiver: RtpReceiver) {
    const lag = monitorEventLoopDelay({ resolution: LAG_RESOLUTION_MS });
    lag.enable();
    const every = (ms: number, run: () => void) => this.timers.push(setInterval(run, ms));
    every(RATE_CONTROL_MS, () =>
      this.toPhone(rtcp.rateControl(receiver.stats.pictures, performance.now(), receiver.received)),
    );
    every(ALIVE_MS, () => {
      const alive = rtcp.alive(receiver.sender, receiver.highestSeq);
      this.toPhone(alive);
      if (this.audioPort) this.audio?.send(alive, this.audioPort);
      const s = receiver.stats;
      this.sink.counters({
        packets: s.packets,
        lostPackets: s.lost,
        latePackets: s.late,
        heldPictures: s.held,
        freezes: s.freezes,
        longestFreezeMs: Math.round(s.longestFreezeMs),
        frozenMs: Math.round(s.frozenMs),
        // the longest this thread was away from its reads this second
        loopLagMs: Math.round(lag.max / 1e6),
      });
      lag.reset();
      const changed = this.dark.tick(receiver.stats.pictures);
      if (changed) this.sink.state(changed);
      if (changed === 'ok') this.dropInput();
    });
    every(WATCH_MS, () => void this.watchServer());
    void this.watchTurns();
    this.toPhone(rtcp.alive(receiver.sender, receiver.highestSeq));
  }

  /** A turned phone sends the same shape, with the app on its side: nothing in the stream says so. */
  private async watchTurns() {
    const reader = await orientationReader(this.udid).catch(() => undefined);
    if (!reader || this.stopped) {
      reader?.close();
      return;
    }
    this.closeOrientation = reader.close;
    let reading = false;
    this.timers.push(
      setInterval(() => {
        if (reading) return;
        reading = true;
        reader
          .read()
          .then((orientation) => {
            const turns = turnsOf(orientation);
            if (turns === undefined || turns === this.turns) return;
            this.turns = turns;
            if (this.hid) this.hid.turns = turns;
            this.sink.turns(turns);
          })
          // an upright window, and a touch that may miss, is all that is lost
          .catch(() => undefined)
          .finally(() => (reading = false));
      }, TURNS_CHECK_MS),
    );
  }

  /** The phone can end a stream by itself, for a call or the camera: a new start then says why. */
  private async watchServer() {
    if (!this.display || this.stopped) return;
    try {
      const status = await invoke(
        this.display,
        `${FEATURE}getmediastreamserverstatus`,
        {},
        undefined,
        WATCH_MS * 4,
      );
      if (status.running === false && !this.stopped) this.onLost('the phone ended the stream');
    } catch {
      // the tunnel's end says this too, and a slow answer is no end
    }
  }

  private onPicture(p: Picture) {
    this.toPhone(this.rtcp!.ack(p.rtpTime));
    this.sink.picture(p);
  }

  private onLost(why: string) {
    if (this.stopped) return;
    this.stopped = true;
    this.release();
    this.sink.lost(why);
  }

  keyframe() {
    this.receiver?.needKey();
  }

  /** A finger sent on a connection from before a dark screen goes nowhere, with no word: the next input opens anew. */
  private dropInput() {
    this.inputs = this.inputs
      .catch(() => undefined)
      .then(() => {
        this.indigo?.close();
        this.universal?.close();
        this.hid = undefined;
      });
  }

  /** The services for input are opened on the first input: a window only watched needs none. */
  private async inputService() {
    if (this.hid) return this.hid;
    const ports = this.services?.ports ?? {};
    const stack = this.stack;
    const indigo = ports[HID_INDIGO];
    const universal = ports[HID_UNIVERSAL];
    if (!stack || !indigo || !universal) throw new Error('the phone lists no input service');
    this.indigo = RemoteXpc.start(await stack.connect(indigo));
    this.universal = RemoteXpc.start(await stack.connect(universal));
    this.hid = new PhoneHid(this.indigo, this.universal);
    this.hid.turns = this.turns;
    return this.hid;
  }

  input(e: InputEvent): Promise<void> {
    this.inputs = this.inputs
      .catch(() => undefined)
      .then(async () => (await this.inputService()).send(e));
    return this.inputs;
  }

  /** Ends it, and whether the phone says so; what it did not answer is a false, and its timeout will end it. */
  async stop(): Promise<boolean> {
    if (this.stopped) return true;
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    let proved = false;
    try {
      const display = this.display!;
      await invoke(display, `${FEATURE}stopmediastream`, { stopAll: true }, STOP_ACTION);
      const after = await invoke(display, `${FEATURE}getmediastreamserverstatus`, {});
      proved = after.running === false || sessionsOf(after).length === 0;
      if (proved) rememberOwn(this.udid, []);
    } catch {
      // not proved: the phone's own timeout ends it, since no report reaches it any more
    }
    this.release();
    return proved;
  }

  private release() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.closeOrientation?.();
    this.indigo?.close();
    this.universal?.close();
    this.display?.close();
    this.services?.close();
    this.video?.close();
    this.audio?.close();
    this.stack?.close();
  }
}
