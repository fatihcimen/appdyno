import { DeviceError, PROTOCOL, type Hello, type Tree, type ActParams } from '@appdyno/protocol';
import { turnedTouch, turnsOf } from './mirror-sim.js';
import { type HelperProcess, startSimAx, startSimHid, type HelperAnswer } from './simhelper.js';
import { type DirectRead, type Refusal, toTree, type RawAx, sameTree } from './simtree.js';
import { hidKey, HID_MODIFIERS, touchEvents } from './simtouch.js';

export type DirectStatus = { input: string; read: string };

const HELPER_VERSION = 'helper';

/** Just after a boot on a loaded Mac the helper took 15 s to answer, and a runner takes longer. */
const HELLO_MS = 30_000;

/** UIKit's sheet comes up in about 0.5 s; an animation that never ends costs this once per touch. */
const ANIMATION_WAIT_MS = 1_000;

/** Another process may draw what was touched, and report nothing. */
const TOUCH_REPORT_MS = 300;

/** A size as the screen stands upright, as a touch's surface does whatever the app does. */
const upright = ([a, b]: [number, number]) => ({ w: Math.min(a, b), h: Math.max(a, b) });

type Starters = {
  ax: (udid: string) => Promise<HelperProcess>;
  hid: (udid: string) => Promise<HelperProcess>;
};

const leave = async (ax: HelperProcess) => {
  await ax.call({ op: 'leave' }, 2_000);
  ax.close();
};

/**
 * One simulator's helpers, used where they prove themselves: while a runner is up their reads are compared
 * with its own, and a touch that the app did not report is given to the runner, which then keeps every later
 * one (a Device Hub in Resize Mode swallows touches and reports success).
 * APPDYNO_SIM_DIRECT: `off`, `read` (no direct input), else both.
 */
export class DirectSim {
  private ax: Promise<HelperProcess> | undefined;
  private hid: Promise<HelperProcess> | undefined;
  /** The input helper's first ask, answered: what is sent after it waits for it. */
  private hidAsked: Promise<void> | undefined;
  private readChecked = false;
  private readOff: string | undefined;
  private inputOff: string | undefined;
  private screen: { w: number; h: number } | undefined;
  private rotated = false;
  private axDeaths = 0;
  private misreads = 0;
  /** How many touches the app in front has reported finished, as of the last answer. */
  touchesEnded: number | undefined;
  /** The count of those reports once the last touch sent has been handled: a tap makes two. */
  private touchesDue = 0;
  private reporting = false;

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
      read: this.readOff ? `runner: ${this.readOff}` : this.screen ? 'direct' : 'not used yet',
    };
  }

  /**
   * What a host needs to know of this simulator, from the read helper: no test runner has to start for it.
   * Undefined when the helper cannot say, or in landscape, where its read is not verified.
   */
  async hello(): Promise<Hello | undefined> {
    if (this.readOff) return undefined;
    const a = this.note(await (await this.helperAx()).call({ op: 'hello' }, HELLO_MS));
    const size = a.screen as [number, number] | undefined;
    if (!a.ok || !size?.[0] || !size[1]) return undefined;
    this.screen = upright(size);
    if (size[0] > size[1]) return undefined;
    return {
      agentVersion: HELPER_VERSION,
      protocol: PROTOCOL,
      platform: 'ios',
      osVersion: String(a.osVersion),
      model: String(a.model),
      screen: { ...this.screen, density: Number(a.scale), rotation: 0 },
    };
  }

  /**
   * Both helpers started and asked once, for a first read and a first touch to find them up: the input helper's first
   * message, a ping no app sees, took 120 ms more than the next.
   */
  warm() {
    if (!this.readOff) void this.hello().catch(() => undefined);
    if (this.inputOff) return;
    this.hid ??= this.start.hid(this.udid);
    void this.hid.then((h) => this.asked(h)).catch(() => undefined);
  }

  /**
   * The input helper's first ask, a ping, once: a daemon that leaves it unanswered, or a helper that ends as it connects,
   * takes no touch either, and the first goes to the runner, not answered TIMEOUT as maybe sent.
   */
  private asked(h: HelperProcess) {
    return (this.hidAsked ??= h.call({ op: 'ping' }, 8_000).then(
      (a) => {
        if (!a.ok)
          this.inputOff ??= `the input helper's first ask: ${a.error ?? a.refused ?? 'failed'}`;
      },
      () => undefined,
    ));
  }

  /** Portrait only is verified for the read helper; a touch turns with the app in front. */
  setRotation(rotation: number) {
    this.rotated = rotation !== 0;
  }

  private async helperAx() {
    this.ax ??= this.start.ax(this.udid).catch((e: unknown) => {
      const why = (e instanceof Error ? e.message : String(e)).slice(0, 120);
      this.turnReadOff(`the read helper did not start: ${why}`);
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
    this.screen = upright(size);
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

  /** Whether a read or a look at what is in front can be asked of the helper. */
  get reads() {
    return !this.readOff && !this.rotated;
  }

  /** A touch is sent in the screen's points, which a read or the hello tell. */
  get screenKnown() {
    return !!this.screen;
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
      this.inputOff = `the app's reports cannot be observed: ${String(a.refused)}`;
    this.reporting = a.ok;
    return a.ok;
  }

  /**
   * UIKit takes no touches while a view animates, and the tree shows it where it ends from the start: waits
   * until the app in front says no animation runs, at most ANIMATION_WAIT_MS. Milliseconds waited, if it can
   * say (APPDYNO_ANIMATION_WAIT=0: not asked). Asked right after a touch, it first waits for the app to report
   * that touch: an animation the touch starts has not begun before that, and the report would say all is still.
   */
  async animationsOver(): Promise<number | undefined> {
    if (process.env.APPDYNO_ANIMATION_WAIT === '0') return undefined;
    const a = this.note(
      await (
        await this.helperAx()
      ).call(
        { op: 'animations', within: ANIMATION_WAIT_MS / 1_000, touches: this.touchesDue },
        ANIMATION_WAIT_MS + 3_000,
      ),
    );
    return a.ok ? a.ms : undefined;
  }

  /** Until the app has handled the last touch sent, as far as it reports that: a read before then misses its effect. */
  async touchHandled(withinMs = TOUCH_REPORT_MS) {
    if ((this.touchesEnded ?? 0) >= this.touchesDue) return;
    this.note(
      await (
        await this.helperAx()
      ).call(
        { op: 'touched', touches: this.touchesDue, within: withinMs / 1_000 },
        withinMs + 3_000,
      ),
    );
  }

  /** The turns that stand the app in front up; undefined where it will not say and it was turned. */
  private async turns() {
    const a = await (await this.helperAx()).call({ op: 'orientation' }, 3_000);
    return (a.ok ? turnsOf(a.orientation as number) : undefined) ?? (this.rotated ? undefined : 0);
  }

  /**
   * Sends the action straight to the simulator; false, with nothing sent, when the runner must do it. Asked and given no
   * answer, it may have gone through, and the runner's would make it twice: TIMEOUT, sent.
   */
  async send(action: ActParams): Promise<boolean> {
    if (this.inputOff || !this.screen) return false;
    this.hid ??= this.start.hid(this.udid);
    const hid = await this.hid.catch((e: unknown) => {
      const why = (e instanceof Error ? e.message : String(e)).slice(0, 120);
      this.inputOff = `the input helper did not start: ${why}`;
      return undefined;
    });
    if (!hid) return false;
    await this.asked(hid);
    if (this.inputOff) return false;
    const key = action.kind === 'key' ? hidKey(action.key) : undefined;
    const held = action.kind === 'key' ? action.modifiers?.map((m) => HID_MODIFIERS[m]) : undefined;
    const turns = key ? 0 : await this.turns();
    if (turns === undefined) return false;
    const { w, h } = this.screen;
    const events = touchEvents(action, turns % 2 ? { w: h, h: w } : this.screen)?.map((e) =>
      turnedTouch(e, turns),
    );
    if (!key && !events) return false;
    if (hid.closed) {
      this.inputOff = 'the input helper ended';
      return false;
    }
    const last = events?.[events.length - 1]?.at ?? 0;
    const a = await hid.call(
      key ? { op: 'key', ...key, ...(held && { modifiers: held }) } : { op: 'touch', events },
      last + 5_000,
    );
    if (!a.ok) {
      this.inputOff = a.error ?? a.refused ?? 'the input helper failed';
      const e = new DeviceError(
        'TIMEOUT',
        `the ${action.kind} went to the input helper, which did not say it was sent: ${this.inputOff}`,
        'read the screen to see whether it went through before doing it again',
      );
      e.sent = true;
      throw e;
    }
    if (events && this.reporting)
      this.touchesDue = (this.touchesEnded ?? 0) + (action.kind === 'tap' ? 2 : 1);
    return true;
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
    await leave(ax);
    return {
      input: h.ok ? 'ok' : (h.error ?? h.refused ?? 'no answer'),
      read: a.ok ? 'ok' : (a.refused ?? 'no answer'),
    };
  }

  /** `runnerStays`: accessibility stays on for it; else the simulator is left as this helper found it. */
  close(runnerStays = false) {
    void this.ax?.then(
      (h) => (runnerStays ? h.close() : leave(h)),
      () => undefined,
    );
    void this.hid?.then(
      (h) => h.close(),
      () => undefined,
    );
    this.ax = this.hid = undefined;
    this.hidAsked = undefined;
  }
}
