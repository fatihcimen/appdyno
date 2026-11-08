import { alertButtonOf, elementsOf, must, sleep, type UiElement } from '@appdyno/core';
import { DeviceError, type Point, type Tree } from '@appdyno/protocol';
import type { ApkNames } from './apk-names.js';

/** What the person running the server lets `app install` answer on the phone. */
export type InstallAnswers = { prompts: boolean; warnings: boolean };

/** The device as the prompts need it, with its wake and its touches. */
export type InstallScreen = {
  currentFocus(): Promise<string>;
  focusSteady(): Promise<void>;
  ensureAwake(): Promise<unknown>;
  tree(): Promise<Tree>;
  press(p: Point, ms: number): Promise<unknown>;
  shell(command: string): Promise<string>;
};

/** A touch to make, what it answers, and the line the answer keeps of it; or a prompt left for a person. */
export type InstallStep =
  { touch: Point; what: string; said?: string } | { left: string; hint: string };

const CONSENT_PKG = 'com.miui.securitycenter';
const PROTECT_PKG = 'com.android.vending';
const PROMPT_WINDOW = new RegExp(
  `${CONSENT_PKG}/com\\.miui\\.permcenter\\.install\\.AdbInstallActivity|` +
    `${PROTECT_PKG}/com\\.google\\.android\\.finsky\\.protectdialogs\\.activity\\.PlayProtectDialogsActivity`,
);
/** On a Xiaomi the deny button counts down, and is what a slow answer gets. */
const COUNTDOWN = /\(\d+\)\s*$/;
const ADB_INPUT_ON = '1';
/** How the answer words a touch on that prompt, which the install's own refusal has to tell apart. */
export const CONSENT_TAPPED = "on the phone's USB install prompt";

/*
 * Play Protect's dialogs have no resource ids, so only its own strings tell its buttons apart, and a wrong
 * guess could send a private build to Google. These are from the Play Store's resources on a phone; a dialog in
 * any other language is left for a person.
 */
const BRAND = 'Google Play Protect';
const DONT_SEND = new Set(["Don't send", 'Gönderme']);
const SEND = new Set([
  'Send this time',
  'Always send unknown apps',
  'Bu seferlik gönder',
  'Bilinmeyen uygulamaları her zaman gönder',
]);
const MORE_DETAILS = new Set(['More details', 'Diğer ayrıntılar']);
const INSTALL_ANYWAY = new Set(['Install anyway', 'Yine de yükle', 'Yine de yükleyin']);

/** How long after a touch a prompt is looked at again, and how many touches it gets before it is called ignored. */
const AFTER_TOUCH_MS = 1_200;
const TOUCHES = 3;
/** Held: "install anyway" is a link in a text, and took no instant tap on a Xiaomi. */
const TOUCH_MS = 150;
const POLL_MS = 250;
const STILL_MS = 200;
const STILL_READS = 12;
/** "Install anyway" is the text's last line, from its left edge, and the tree has no node for it. */
const LINK_INSET_PX = 60;

const WAITS =
  "It was left alone and still waits on the phone, where a person's answer still installs it";
const TROUBLE = "could not answer the phone's prompt";

const lastParagraph = (e: UiElement) =>
  must((e.text ?? '').split('\n\n').pop(), 'a paragraph').trim();

type Texted = UiElement & { text: string };

/** A button's label is a text beside an empty button: that is how Compose's dialog reads. */
const labelsButton = (e: UiElement, els: UiElement[]) =>
  els.some((o) => o.parent === e.parent && o.type === 'android.widget.Button');

/** What the dialog says, to quote: without its brand, the app's name, its buttons and its link. */
function wordsOf(texts: Texted[], els: UiElement[], app: ApkNames) {
  return texts
    .filter(
      (e) =>
        e.text !== BRAND &&
        !app.names.includes(e.text) &&
        !MORE_DETAILS.has(e.text) &&
        !labelsButton(e, els),
    )
    .map((e) =>
      INSTALL_ANYWAY.has(lastParagraph(e))
        ? e.text.slice(0, e.text.lastIndexOf('\n\n')).trim()
        : e.text,
    )
    .join(' / ');
}

function consentStep(els: UiElement[], app: ApkNames): InstallStep | undefined {
  const byId = (id: string) => els.find((e) => e.identifier === id);
  const yes = byId('android:id/button2');
  const no = byId('android:id/button1');
  const named = byId(`${CONSENT_PKG}:id/name`)?.text;
  if (!yes?.text || !no?.text || !byId(`${CONSENT_PKG}:id/do_not_ask_checkbox`)) return undefined;
  if (!COUNTDOWN.test(no.text) || COUNTDOWN.test(yes.text)) return undefined;
  if (named && !app.names.includes(named))
    return {
      left: `the phone's USB install prompt names "${named}", and this file is ${app.id}. It was left alone`,
      hint: 'it says no by itself after about 10 s; see what else is being installed on the phone',
    };
  const { x, y } = must(alertButtonOf(yes), 'a button');
  return {
    touch: { x, y },
    what: 'consent',
    said: `tapped "${yes.text}" ${CONSENT_TAPPED} for ${app.id}`,
  };
}

function protectStep(els: UiElement[], app: ApkNames, warnings: boolean): InstallStep | undefined {
  const texts = els.filter((e): e is Texted => !!e.text);
  // its Compose content comes after the window, and after a wake it is drawn again
  if (!texts.some((e) => labelsButton(e, els))) return undefined;
  const words = wordsOf(texts, els, app);
  if (!texts.some((e) => app.names.includes(e.text)))
    return {
      left: `Play Protect shows a prompt that does not name ${app.id}: "${words}". It was left alone`,
      hint: 'answer it on the phone',
    };
  const no = texts.find((e) => DONT_SEND.has(e.text));
  if (no && texts.some((e) => SEND.has(e.text))) {
    const { x, y } = must(alertButtonOf(no), 'a button');
    return {
      touch: { x, y },
      what: 'scan',
      said: `answered "${no.text}" to Play Protect's prompt to send the app to Google: ${app.id} stayed on this machine`,
    };
  }
  const details = texts.find((e) => MORE_DETAILS.has(e.text));
  const anyway = texts.find((e) => INSTALL_ANYWAY.has(lastParagraph(e)));
  if (!details && !anyway)
    return {
      left: `Play Protect shows a prompt about ${app.id} that is not recognised: "${words}", with ${texts
        .filter((e) => labelsButton(e, els))
        .map((e) => `"${e.text}"`)
        .join(', ')}. ${WAITS}`,
      hint: 'answer it on the phone, and do not send the app if it asks to; Play Protect is read in English and Turkish only',
    };
  if (!warnings)
    return {
      left: `Play Protect warned about ${app.id}: "${words}". ${WAITS}`,
      hint: 'a person can answer it on the phone, or the server can pass warnings: --accept-install-warnings (APPDYNO_ACCEPT_INSTALL_WARNINGS=1)',
    };
  if (!anyway) {
    const { x, y } = must(alertButtonOf(details), 'a button');
    return { touch: { x, y }, what: 'details' };
  }
  const line = Math.min(...texts.map((e) => must(e.rect, 'a rect').height));
  const link = must(anyway.rect, 'a rect');
  return {
    touch: { x: link.x + LINK_INSET_PX, y: link.y + link.height - Math.round(line / 2) },
    what: 'warning',
    said: `passed a Play Protect warning for ${app.id}: "${words}"`,
  };
}

/** What to do about the prompt in this tree, if it is one and whole. */
export function installStep(tree: Tree, app: ApkNames, warnings: boolean): InstallStep | undefined {
  const pkg = tree.windows.find((w) => w.focused)?.pkg;
  const els = elementsOf(tree).filter((e) => e.pkg === pkg);
  if (pkg === CONSENT_PKG) return consentStep(els, app);
  if (pkg === PROTECT_PKG) return protectStep(els, app, warnings);
  return undefined;
}

/**
 * The tree once its windows have stopped moving: a prompt slides up with its buttons already read at their last
 * place. A touch then took nothing, or fell above the dialog, which cancels the install.
 */
async function stillTree(s: InstallScreen): Promise<Tree | undefined> {
  const places = (t: Tree) => JSON.stringify(t.windows.map((w) => w.b));
  let before = await s.tree();
  for (let i = 0; i < STILL_READS; i++) {
    await sleep(STILL_MS);
    const now = await s.tree();
    if (places(now) === places(before)) return now;
    before = now;
  }
  return undefined;
}

const ignored = async (s: InstallScreen, what: string) => {
  const setting = (await s.shell('getprop persist.security.adbinput')).trim();
  return new DeviceError(
    'PERMISSION_REQUIRED',
    `the phone ignored ${TOUCHES} touches on its install prompt (${what}): the system can block injected touches on that window`,
    // no such property: this maker has no such setting to send anyone to
    !setting
      ? 'answer it on the phone'
      : setting === ADB_INPUT_ON
        ? '"USB debugging (Security settings)" already reads on here: answer it on the phone'
        : 'turn on "USB debugging (Security settings)" in Developer options, or answer it on the phone',
  );
};

/**
 * The screen on, as asleep a phone would say no by itself, and no prompt open yet: one open before this call's install
 * starts is an earlier install's, whose app a touch meant for this one would install, and it holds back this one's
 * own prompt until the verifier gives up.
 */
export async function readyForInstall(s: InstallScreen) {
  await s.ensureAwake();
  if (PROMPT_WINDOW.test(await s.currentFocus()))
    throw new DeviceError(
      'PERMISSION_REQUIRED',
      'the phone already shows an install prompt from before this install, which was left alone. Nothing was installed',
      'answer it on the phone, then install again',
    );
}

/**
 * Answers the prompts of the install that `pending` follows, on this device, until it ends. What it did goes in
 * `said`. Throws PERMISSION_REQUIRED when a person must answer; any other trouble only goes in `said`, as the
 * install is not this watcher's to end.
 */
export async function answerInstallPrompts(
  s: InstallScreen,
  names: () => Promise<ApkNames>,
  warnings: boolean,
  pending: () => boolean,
  said: string[],
): Promise<void> {
  let app: ApkNames | undefined;
  let last = '';
  let touches = 0;
  /** Only the last trouble is said, and none once a touch has gone through since. */
  const clearTrouble = () => {
    const i = said.findIndex((line) => line.startsWith(TROUBLE));
    if (i >= 0) said.splice(i, 1);
  };
  const answerOnce = async () => {
    const focus = await s.currentFocus();
    // a screen timing out as the prompt comes takes the prompt's chance with it
    if (!focus) await s.ensureAwake();
    if (!PROMPT_WINDOW.test(focus)) return;
    await s.focusSteady();
    const tree = await stillTree(s);
    if (!tree || !pending()) return;
    app ??= await names().catch((e: unknown) => {
      throw new DeviceError(
        'PERMISSION_REQUIRED',
        `the phone asks about this install, and the file's names could not be read to check it: ${e instanceof Error ? e.message : String(e)}. ${WAITS}`,
        'answer it on the phone',
      );
    });
    const step = installStep(tree, app, warnings);
    if (!step) return;
    if ('left' in step) throw new DeviceError('PERMISSION_REQUIRED', step.left, step.hint);
    touches = step.what === last ? touches + 1 : 1;
    last = step.what;
    if (touches > TOUCHES) throw await ignored(s, step.what);
    await s.press(step.touch, TOUCH_MS);
    clearTrouble();
    if (step.said && !said.includes(step.said)) said.push(step.said);
    await sleep(AFTER_TOUCH_MS);
  };
  while (pending()) {
    await answerOnce().catch((e: unknown) => {
      if (e instanceof DeviceError && e.code === 'PERMISSION_REQUIRED') throw e;
      clearTrouble();
      said.push(`${TROUBLE}: ${(e as Error).message}`);
    });
    await sleep(POLL_MS);
  }
}
