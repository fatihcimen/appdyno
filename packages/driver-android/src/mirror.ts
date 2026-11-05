import type {
  DeviceState,
  InputEvent,
  Mirror,
  MirrorCheck,
  MirrorOptions,
  MirrorSource,
  Need,
  RpcClient,
  ViewerOrder,
} from '@appdyno/core';
import { pause } from '@appdyno/core';
import { DeviceError, type Key, KEY_USAGES, keyOfUsage, KEYS } from '@appdyno/protocol';
import { overNetwork, type Adb } from './adb.js';
import type { AndroidAgentLauncher } from './agent.js';

/** Android 10: below it the agent has no mirror to make. */
const MIN_SDK = 29;

/** What adb's word for a device says stands in its way. */
export const needOfState = (state: string | undefined): Need | undefined =>
  state === 'unauthorized' ? 'not-trusted' : state === 'device' ? undefined : 'not-connected';
const INPUT_MS = 5_000;
const STATUS_MS = 5_000;
const ACTION_MS = 15_000;
const WATCH_MS = 1_000;
const PROOF_MS = 3_000;
const BEHIND =
  'This device cannot keep up. The picture stays at a size that can be read, and runs late.';
const ON_WIFI = 'On Wi-Fi: frames and touches take the longer way. A cable gives more.';

/** A failure that no wait will clear: another tool holds the device, or the agent is not built. */
const fatal = (e: unknown) => {
  if (e instanceof DeviceError && ['AGENT_CONFLICT', 'UNSUPPORTED'].includes(e.code))
    Object.assign(e, { fatal: true });
  return e;
};

/**
 * An Android phone's mirror. The viewer reads the stream from the agent itself, on a connection of its
 * own, so nothing here sees a frame: only what starts the stream and what a person does on the window.
 */
export class AndroidMirror implements Mirror {
  private rpc: RpcClient | undefined;
  private sdk: number | undefined;
  private lostTouch: unknown;
  private say: (text: string) => void = () => undefined;
  private toldBehind = false;

  constructor(
    private readonly adb: Adb,
    private readonly serial: string,
    private readonly launcher: AndroidAgentLauncher,
  ) {}

  /** This mirror's own connection: a person's input does not queue behind what a driver is doing. */
  private async agent(): Promise<RpcClient> {
    if (this.rpc && !this.rpc.closed) return this.rpc;
    try {
      const { rpc } = await this.launcher.connect();
      this.rpc = rpc;
      return rpc;
    } catch (e) {
      throw fatal(e);
    }
  }

  /** The screen as it is now, and what runs on it. */
  async status() {
    const { result } = await (
      await this.agent()
    ).call('stream.status', {}, { timeoutMs: STATUS_MS });
    return result;
  }

  async check(): Promise<MirrorCheck> {
    const device = (await this.adb.devices()).find((d) => d.serial === this.serial);
    const need = needOfState(device?.state);
    if (need) return { ok: false, need };
    this.sdk ??= Number(await this.adb.exec(this.serial, 'getprop ro.build.version.sdk'));
    if (this.sdk < MIN_SDK) return { ok: false, need: 'os-too-old', detail: `SDK ${this.sdk}` };
    return (await this.status()).on
      ? { ok: true, routes: ['agent', ...(overNetwork(this.serial) ? ['wifi'] : [])] }
      : { ok: false, need: 'asleep' };
  }

  async open(
    opts: MirrorOptions,
    _signal?: AbortSignal,
    tell: (message: ViewerOrder) => void = () => undefined,
  ): Promise<MirrorSource> {
    this.say = (text) => tell({ op: 'note', text });
    this.toldBehind = false;
    return this.sourceWith(opts, {});
  }

  /** The agent's address, for the viewer, with what its `stream.start` asks for. */
  async sourceWith(
    opts: MirrorOptions,
    start: Record<string, unknown>,
  ): Promise<Extract<MirrorSource, { kind: 'adb' }>> {
    await this.agent();
    const address = await this.launcher.address();
    if (!address) throw new DeviceError('AGENT_UNAVAILABLE', 'the agent left no address');
    return {
      kind: 'adb',
      encoded: true,
      serial: this.serial,
      socket: address.socket,
      token: address.token,
      codec: opts.codec ?? 'h264',
      ...(this.adb.port !== 5037 && { adbPort: this.adb.port }),
      start: { quality: opts.quality, ...start },
      ...(overNetwork(this.serial) && { note: ON_WIFI }),
    };
  }

  async wake() {
    await this.adb.exec(this.serial, 'input keyevent KEYCODE_WAKEUP');
  }

  async keyframe() {
    await (await this.agent()).call('stream.sync', {}, { timeoutMs: STATUS_MS });
  }

  private async press(key: Key) {
    await (
      await this.agent()
    ).call('act', { action: { kind: 'key', key }, read: 'none' }, { timeoutMs: ACTION_MS });
  }

  /** Esc leaves a screen on a keyboard, which is Back here: the one key that is not what its usage names. */
  keyOf(usage: number) {
    return usage === KEY_USAGES.escape.usage ? 'back' : keyOfUsage(usage);
  }

  async input(e: InputEvent) {
    if (this.lostTouch) {
      const failure = this.lostTouch;
      this.lostTouch = undefined;
      throw failure;
    }
    const rpc = await this.agent();
    switch (e.kind) {
      case 'touch': {
        const { p, x, y, x2, y2 } = e;
        const sent = rpc.call(
          'touch',
          { p, x, y, ...(x2 !== undefined && { x2, y2 }) },
          { timeoutMs: INPUT_MS },
        );
        // a move waits, so that a slow device gets the newest and not the path; a finger down or up goes on
        // a round trip sooner, the socket keeping the order, and a failure is said by the next event
        if (p === 1) await sent;
        else
          sent.catch((failure: unknown) => {
            this.lostTouch = failure;
          });
        return;
      }
      case 'key': {
        const key = this.keyOf(e.usage);
        if (key && e.state === 1) await this.press(key);
        return;
      }
      case 'text':
        await rpc.call(
          'text.set',
          { text: e.s, replace: false, submit: false, focusTimeoutMs: 0, read: 'none' },
          { timeoutMs: ACTION_MS },
        );
        return;
      case 'button':
        if ((KEYS as readonly string[]).includes(e.name)) await this.press(e.name as Key);
    }
  }

  /** Waits to see the agent's streams gone, which proves the display and the codec are released. */
  async close() {
    const rpc = this.rpc;
    this.rpc = undefined;
    if (!rpc || rpc.closed) return;
    const end = Date.now() + PROOF_MS;
    try {
      while (Date.now() < end) {
        const { result } = await rpc.call('stream.status', {}, { timeoutMs: STATUS_MS });
        if (result.active === 0) break;
        await pause(50);
      }
    } catch {
      // the agent gone takes its streams with it
    } finally {
      rpc.close();
    }
  }

  watch(onChange: (s: DeviceState) => void) {
    let state: DeviceState = 'ok';
    const timer = setInterval(() => {
      if (!this.rpc || this.rpc.closed) return;
      void this.rpc
        .call('stream.status', {}, { timeoutMs: STATUS_MS })
        .then(({ result }) => {
          const now: DeviceState = result.on ? 'ok' : 'asleep';
          if (now !== state) onChange(now);
          state = now;
          // once a picture: a device near the line would otherwise say it at every scroll
          if (result.behind && !this.toldBehind) this.say(BEHIND);
          this.toldBehind ||= result.behind === true;
        })
        .catch(() => {
          // a cable that goes ends the socket; a network that goes ends nothing, and this is all that tells
          if (!overNetwork(this.serial) || state === 'not-connected') return;
          state = 'not-connected';
          onChange(state);
        });
    }, WATCH_MS);
    timer.unref();
    return () => clearInterval(timer);
  }
}
