import { constants, openSync, unlinkSync } from 'node:fs';
import { Socket } from 'node:net';
import {
  encodeJson,
  FRAME_VIDEO,
  frameHeader,
  VIDEO_HEADER_BYTES,
  type StreamInfo,
} from '@appdyno/protocol';

/**
 * Frames to the viewer, on a pipe it holds, in the framing of an agent's stream. Three pictures at most wait: past them
 * a picture is dropped, which needs a key picture to go on from, so a slow viewer costs frames and never memory.
 */
const MAX_WAITING = 3;
const OPEN_EVERY_MS = 20;
const OPEN_FOR_MS = 15_000;

export class FrameWriter {
  private socket: Socket | undefined;
  private waiting = 0;
  private info: Record<string, unknown> | undefined;
  private turns: Record<string, unknown> | undefined;
  private opening: NodeJS.Timeout | undefined;
  dropped = 0;

  constructor(
    /** A picture was dropped, or a new viewer has none to start from. */
    private readonly needKey: () => void,
    private readonly onError: (why: string) => void,
  ) {}

  /** The viewer opens its end when it is told of the file; ours can open only after. */
  attach(file: string) {
    this.detach();
    const end = Date.now() + OPEN_FOR_MS;
    const tryOpen = () => {
      this.opening = undefined;
      try {
        this.onOpen(openSync(file, constants.O_WRONLY | constants.O_NONBLOCK));
        // both ends hold it now: nothing on disk is left for anyone else to open
        unlinkSync(file);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENXIO' && Date.now() < end) {
          this.opening = setTimeout(tryOpen, OPEN_EVERY_MS);
        } else this.onError(`no viewer took the picture: ${code ?? String(e)}`);
      }
    };
    tryOpen();
  }

  private onOpen(fd: number) {
    const socket = new Socket({ fd, readable: false, writable: true });
    socket.on('error', () => this.detach(socket));
    socket.on('close', () => this.detach(socket));
    this.socket = socket;
    this.waiting = 0;
    if (this.info) this.writeJson(this.info);
    if (this.turns) this.writeJson(this.turns);
    this.needKey();
  }

  private detach(which?: Socket) {
    clearTimeout(this.opening);
    this.opening = undefined;
    const s = this.socket;
    if (!s || (which && which !== s)) return;
    this.socket = undefined;
    s.destroy();
  }

  private writeJson(message: Record<string, unknown>) {
    this.socket?.write(encodeJson(message));
  }

  /** What a viewer is told of the picture, now and on each new attach. */
  setInfo(params: StreamInfo) {
    this.info = { method: 'stream.info', params };
    this.writeJson(this.info);
  }

  /** How to stand the picture up, now and for a new viewer. */
  setTurns(turns: number) {
    this.turns = { method: 'stream.turns', params: { turns } };
    this.writeJson(this.turns);
  }

  /** Since the stream began, for the viewer's stats. */
  setCounters(counters: Record<string, number>) {
    this.writeJson({
      method: 'stream.counters',
      params: { ...counters, droppedPictures: this.dropped },
    });
  }

  picture(annexB: Buffer) {
    const s = this.socket;
    if (!s) return;
    if (this.waiting >= MAX_WAITING) {
      this.dropped++;
      this.needKey();
      return;
    }
    this.waiting++;
    // an all-zero header: this clock is not the viewer's, and it says so by never pinging
    s.cork();
    s.write(frameHeader(VIDEO_HEADER_BYTES + annexB.length, FRAME_VIDEO));
    s.write(Buffer.alloc(VIDEO_HEADER_BYTES));
    s.write(annexB, () => {
      this.waiting--;
    });
    s.uncork();
  }

  close() {
    this.detach();
  }
}
