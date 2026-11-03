import type { Tree, ActParams } from '@appdyno/protocol';
import { type HelperProcess, startSimAx, startSimHid, type HelperAnswer } from './simhelper.js';
import { type DirectRead, type Refusal, toTree, type RawAx, sameTree } from './simtree.js';
import { HID_KEYS, touchEvents } from './simtouch.js';

export type DirectStatus = { input: string; read: string };

type Starters = {
  ax: (udid: string) => Promise<HelperProcess>;
  hid: (udid: string) => Promise<HelperProcess>;
};

/**
 * One simulator's helpers, used where they prove themselves: their reads are compared with the runner's
 * before the first is believed, and a touch that the app did not report is given to the runner, which
 * then keeps every later one (a Device Hub in Resize Mode swallows touches and reports success).
 * APPDYNO_SIM_DIRECT: `off`, `read` (no direct input), else both.
 */
export class DirectSim {
  private ax: Promise<HelperProcess> | undefined;
  private hid: Promise<HelperProcess> | undefined;
  private readChecked = false;
  private readOff: string | undefined;
  private inputOff: string | undefined;
  private screen: { w: number; h: number } | undefined;
  private rotated = false;
  private axDeaths = 0;
  private misreads = 0;
  /** How many touches the app in front has reported finished, as of the last answer. */
  touchesEnded: number | undefined;

  constructor(
    private readonly udid: string,
    private readonly start: Starters = { ax: startSimAx, hid: startSimHid },
    mode = process.env.APPDYNO_SIM_DIRECT,
  ) {
    if (mode === 'off') this.readOff = this.inputOff = 'APPDYNO_SIM_DIRECT=off';
    if (mode === 'read') this.inputOff = 'APPDYNO_SIM_DIRECT=read';
  }

  status(): DirectStatus {
    return {
      input: this.inputOff ? `runner: ${this.inputOff}` : this.hid ? 'direct' : 'not used yet',
      read: this.readOff ? `runner: ${this.readOff}` : this.readChecked ? 'direct' : 'not used yet',
    };
  }

  /** Portrait only is verified for both helpers. */
  setRotation(rotation: number) {
    this.rotated = rotation !== 0;
  }

  private async helperAx() {
    this.ax ??= this.start.ax(this.udid).catch((e: Error) => {
      this.turnReadOff(`the read helper did not start: ${e.message.slice(0, 120)}`);
      throw e;
    });
    const h = await this.ax;
    // a helper that keeps dying is not asked again
    if (h.closed) {
      this.ax = undefined;
      if (++this.axDeaths >= 3) this.turnReadOff('the read helper keeps ending');
    }
    return h;
  }

  private note(a: HelperAnswer) {
    if (typeof a.touchesEnded === 'number') this.touchesEnded = a.touchesEnded;
    return a;
  }

  /** A read of `bundle` in front, in the runner's shape; a refusal when the runner must answer this one. */
  async read(bundle: string | undefined): Promise<DirectRead | Refusal> {
    if (this.readOff || this.rotated || !bundle) return { refused: this.readOff ?? 'no-target' };
    const a = this.note(await (await this.helperAx()).call({ op: 'read', bundle }, 10_000));
    if (!a.ok) return { refused: a.refused ?? 'refused' };
    const size = a.screen as [number, number];
    this.screen = { w: size[0], h: size[1] };
    if (size[0] > size[1]) return { refused: 'landscape' };
    return toTree(a.tree as RawAx, bundle, this.screen, a.ms ?? 0);
  }

  /** Does its read say what the runner's says? Three times no before a first yes: not for this session. */
  checkRead(direct: Tree, runner: Tree): boolean {
    if (sameTree(direct, runner)) return (this.readChecked = true);
    if (!this.readChecked && ++this.misreads >= 3)
      this.turnReadOff('its read differed from the runner');
    return false;
  }

  turnReadOff(why: string) {
    this.readOff = why;
    this.inputOff ??= 'the direct read is off';
  }

  get readProven() {
    return this.readChecked;
  }

  /** The app in front, without a snapshot. */
  async front(): Promise<string | undefined> {
    if (this.readOff || this.rotated) return undefined;
    const a = this.note(await (await this.helperAx()).call({ op: 'front' }, 5_000));
    return a.ok && typeof a.bundle === 'string' ? a.bundle : undefined;
  }

  /**
   * Asks the app in front to report: its touches finishing are the proof that one got there. Whether that
   * proof can come; a helper that cannot observe at all leaves the input to the runner, unproven touches
   * being what must not happen.
   */
  async arm(): Promise<boolean> {
    if (this.readOff) return false;
    const a = this.note(await (await this.helperAx()).call({ op: 'arm' }, 3_000));
    if (!a.ok && a.refused !== 'no-report' && a.refused !== 'helper-gone')
      this.inputOff = `the app's reports cannot be observed: ${a.refused}`;
    return a.ok;
  }

  /** Sends the action straight to the simulator; false when the runner must do it. */
  async send(action: ActParams): Promise<boolean> {
    if (this.inputOff || this.rotated || !this.screen) return false;
    this.hid ??= this.start.hid(this.udid);
    const hid = await this.hid.catch((e: Error) => {
      this.inputOff = `the input helper did not start: ${e.message.slice(0, 120)}`;
      return undefined;
    });
    if (!hid) return false;
    const key = action.kind === 'key' ? HID_KEYS[action.key] : undefined;
    const events = touchEvents(action, this.screen);
    if (!key && !events) return false;
    if (hid.closed) {
      this.inputOff = 'the input helper ended';
      return false;
    }
    const last = events?.[events.length - 1]?.at ?? 0;
    const a = await hid.call(key ? { op: 'key', ...key } : { op: 'touch', events }, last + 5_000);
    if (!a.ok) this.inputOff = a.error ?? a.refused ?? 'the input helper failed';
    return a.ok;
  }

  /** A touch the app never reported: the runner takes over the input from now on. */
  touchLost() {
    this.inputOff = 'a touch sent directly did not reach the app';
  }

  /** Are both helpers there, and does a read answer? For the doctor. */
  async probe(): Promise<{ input: string; read: string }> {
    const hid = await this.start.hid(this.udid);
    const h = await hid.call({ op: 'ping' }, 8_000);
    hid.close();
    const ax = await this.start.ax(this.udid);
    const a = await ax.call({ op: 'read' }, 10_000);
    ax.close();
    return {
      input: h.ok ? 'ok' : (h.error ?? h.refused ?? 'no answer'),
      read: a.ok ? 'ok' : (a.refused ?? 'no answer'),
    };
  }

  close() {
    void this.ax?.then(
      (h) => h.close(),
      () => undefined,
    );
    void this.hid?.then(
      (h) => h.close(),
      () => undefined,
    );
    this.ax = this.hid = undefined;
  }
}
