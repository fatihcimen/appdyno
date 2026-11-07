import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUSH_PLACEHOLDERS, run, type Push, type PushRoute, type PushType } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg, shq } from './adb.js';

/** What only Google's servers hand an app: its code runs on a message only by them. */
const NO_SERVER = "no onMessageReceived: that needs Google's servers";
const STYLES: Partial<Record<PushType, string>> = {
  alert: 'bigtext',
  rich: 'bigpicture',
  inbox: 'inbox',
  messaging: 'messaging',
  media: 'media',
};
/** Where a style takes a line of the body each. */
const LINES: Record<string, string> = {
  inbox: ', a line of the body each',
  messaging: ', a line of the body each, who: what',
};
const DATA_KEY = /^[\w.-]{1,100}$/;
/** `Intent.FLAG_ACTIVITY_CLEAR_TOP`. */
const CLEAR_TOP = '0x04000000';

/** An FCM message of placeholders, as the fields make one: what this tool reads of it. */
const fcmTemplate = (type: PushType) => {
  const { title, body, image, data } = PUSH_PLACEHOLDERS;
  return JSON.stringify({
    notification: { title, body, ...(type === 'rich' && { image }) },
    data,
  });
};

type Fcm = {
  notification?: { title?: string; body?: string; image?: string; click_action?: string };
  android?: {
    notification?: { title?: string; body?: string; image?: string; click_action?: string };
  };
  data?: Record<string, unknown>;
};

/** A push's fields, from its own or from an FCM message given as its payload. */
function fieldsOf(push: Push) {
  const fcm = (push.payload ?? {}) as Fcm;
  const shown = { ...fcm.notification, ...fcm.android?.notification };
  const data = Object.entries(fcm.data ?? push.data ?? {}).map(([k, v]) => [k, String(v)] as const);
  const bad = data.find(([k]) => !DATA_KEY.test(k));
  if (bad)
    throw new DeviceError(
      'INVALID_ARGUMENT',
      `a data key is letters, digits, _ . -: not ${bad[0]}`,
    );
  return {
    title: shown.title ?? push.title ?? 'appdyno',
    body: shown.body ?? push.body ?? '',
    image: shown.image ?? push.image,
    action: shown.click_action,
    data,
  };
}

/**
 * Each type on Android. The shell draws one, though not as the app: it can open nothing when tapped. `tapped` is what
 * Firebase documents for a push tapped while the app is in the background: the launcher activity, or the one
 * `click_action` names, opened with the data in its intent's extras.
 * https://firebase.google.com/docs/cloud-messaging/android/receive
 */
export const ANDROID_PUSHES: PushRoute[] = [
  ...Object.entries(STYLES).map(([type, style]): PushRoute => ({
    type: type as PushType,
    route: `drawn by the shell in the ${style} style${LINES[style] ?? ''}; the app's code gets nothing`,
    fields: type === 'rich' ? ['title', 'body', 'image'] : ['title', 'body'],
    template: fcmTemplate(type as PushType),
  })),
  {
    type: 'tapped',
    route: "the launcher activity, or click_action's, opened with the data as extras",
    fields: ['data'],
    template: fcmTemplate('tapped'),
  },
  {
    type: 'background',
    why: `a data message reaches the app only as onMessageReceived: ${NO_SERVER}`,
  },
  {
    type: 'live_activity',
    why: `a Live Update is the app's own notification, built from a data message: ${NO_SERVER}`,
  },
  { type: 'voip', why: "PushKit's, an iOS push: a call reaches an Android app as a data message" },
  {
    type: 'widgets',
    why: "WidgetKit's, an iOS push: an Android widget updates from the app's own code",
  },
];

export class AndroidPush {
  constructor(private readonly sh: (command: string) => Promise<string>) {}

  async send(app: string, push: Push): Promise<string> {
    const pkg = assertPkg(app);
    const f = fieldsOf(push);
    if (push.type === 'tapped') return this.tapped(pkg, f.action, f.data);
    const style = STYLES[push.type];
    if (!style) throw new DeviceError('UNSUPPORTED', `Android takes no ${push.type} push here`);
    const lines = f.body.split('\n').filter(Boolean);
    const args =
      style === 'bigpicture'
        ? ['--picture', await this.picture(f.image)]
        : style === 'inbox'
          ? lines.flatMap((l) => ['--line', shq(l)])
          : style === 'messaging'
            ? [
                '--conversation',
                shq(f.title),
                ...lines.flatMap((l) => [
                  '--message',
                  shq(l.includes(':') ? l : `${f.title}:${l}`),
                ]),
              ]
            : [];
    const out = await this.sh(
      `cmd notification post -S ${style} ${args.join(' ')} -t ${shq(f.title)} appdyno-${pkg} ${shq(lines[0] ?? f.title)}`,
    );
    if (/Exception|Error/.test(out))
      throw new DeviceError(
        'INTERNAL',
        `the notification was not drawn: ${out.trim().split('\n')[0]}`,
      );
    return `drawn by the shell in the ${style} style, not by ${pkg}: its code got nothing, and a tap opens nothing (${NO_SERVER}); type tapped opens it as a tapped push`;
  }

  /** As a person's tap on a push opens the app: its activity, with the data as extras. */
  private async tapped(
    pkg: string,
    action: string | undefined,
    data: (readonly [string, string])[],
  ) {
    let target = `-a ${shq(action ?? '')} -p ${pkg}`;
    if (!action) {
      const out = await this.sh(
        `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER -a android.intent.action.MAIN ${pkg}`,
      );
      const component = out.trim().split('\n').at(-1)!;
      if (!component.startsWith(`${pkg}/`))
        throw new DeviceError('NOT_FOUND', `${pkg} has no launcher activity: ${component}`);
      target = `-n ${component}`;
    }
    const extras = data.flatMap(([k, v]) => ['--es', k, shq(v)]).join(' ');
    // as Firebase's own tap opens it: the activity on top of the app's task anew, with this intent
    const out = await this.sh(`am start -W -f ${CLEAR_TOP} ${target} ${extras}`);
    if (/Error|Exception/.test(out))
      throw new DeviceError('NOT_FOUND', `the app did not open: ${out.trim().split('\n').at(-1)}`);
    return `opened ${pkg} as a tapped push, with ${data.length} data keys as extras: ${NO_SERVER}`;
  }

  /**
   * The image as the shell takes it, from a link or a file on this Mac: in the command itself, as the system cannot
   * read the shell's files, made small enough for one argument.
   */
  private async picture(image: string | undefined) {
    if (!image)
      throw new DeviceError('INVALID_ARGUMENT', 'a rich push needs image: a link or a file');
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-push-'));
    try {
      let file = image;
      if (/^https?:\/\//.test(image)) {
        const r = await fetch(image);
        if (!r.ok)
          throw new DeviceError('NOT_FOUND', `the image did not come: ${r.status} from ${image}`);
        file = join(dir, 'picture');
        writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      }
      const small = join(dir, 'small.jpg');
      await run('sips', [
        '-s',
        'format',
        'jpeg',
        '-s',
        'formatOptions',
        '70',
        '-Z',
        '720',
        file,
        '--out',
        small,
      ]).catch(() => {
        throw new DeviceError('INVALID_ARGUMENT', `not an image this Mac reads: ${image}`);
      });
      return `data:base64,${readFileSync(small).toString('base64')}`;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
