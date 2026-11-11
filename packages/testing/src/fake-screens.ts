import type { Tree, WireNode } from '@appdyno/protocol';

export type Node = Partial<WireNode> & { b: [number, number, number, number]; go?: string };

/** A screen of the fake app: its nodes (a tap inside a node with `go` opens that screen). */
export const tree = (nodes: Node[], pkg = 'dev.app', hash?: string): Tree => ({
  windows: [{ type: 1, pkg, layer: 1, b: [0, 0, 1080, 2400], active: true, focused: true }],
  nodes: [
    { p: -1, w: 0, c: 'android.widget.FrameLayout', b: [0, 0, 1080, 2400], f: 17 },
    ...nodes.map(({ go: _go, ...n }) => ({
      p: 0,
      w: 0,
      c: 'android.widget.TextView',
      f: 17,
      ...n,
    })),
  ],
  truncated: false,
  elapsedMs: 3,
  hash: hash ?? JSON.stringify(nodes.map((n) => [n.c, n.id, n.b])),
});

/** A row that holds its name and state as texts of their own, as a settings list does. */
const row = (name: string, state: string, y: number, go?: string): Node[] => [
  {
    c: 'android.widget.LinearLayout',
    d: `${name} ${state}`,
    b: [0, y, 1080, y + 100],
    f: 19,
    ...(go && { go }),
  },
  { t: name, b: [100, y + 10, 500, y + 50] },
  { t: state, b: [100, y + 50, 500, y + 90] },
];
const settings = (wifi: string, go?: string): Node[] => [
  { t: 'Ayarlar', b: [0, 100, 1080, 200] },
  ...row('Wi-Fi', wifi, 300, go),
  ...row('Bluetooth', 'Off', 400),
  ...row('Hotspot', 'Off', 500),
];

/** A row and a control of its name at its very place, as a phone's list draws them. */
const doubled = (name: string, y: number, go?: string): Node[] =>
  ['android.widget.LinearLayout', 'android.widget.Button'].map((c) => ({
    c,
    t: name,
    b: [0, y, 1080, y + 100],
    f: 19,
    ...(go && { go }),
  }));

const FORM: Node[] = [
  { t: 'Bilgiler', b: [0, 100, 1080, 200] },
  {
    c: 'android.widget.EditText',
    id: 'dev.app:id/name',
    h: 'Adınız',
    b: [0, 300, 1080, 400],
    f: 1 | 4 | 16 | 128,
  },
  { c: 'android.widget.Button', t: 'Gönder', b: [0, 500, 1080, 600], f: 19, go: 'sent' },
];

export const SCREENS: Record<string, Node[]> = {
  settings: settings('On', 'settingsOff'),
  settingsOff: settings('Off'),
  doubled: [
    ...doubled('General', 300, 'home'),
    ...doubled('Camera', 400),
    ...doubled('Fonts', 500),
  ],
  login: [
    {
      c: 'android.widget.EditText',
      id: 'dev.app:id/user',
      h: 'User',
      b: [0, 100, 1080, 200],
      f: 149,
    },
    {
      c: 'android.widget.EditText',
      id: 'dev.app:id/pass',
      h: 'Password',
      b: [0, 300, 1080, 400],
      f: 1 | 4 | 16 | 128 | 512,
    },
    { c: 'android.widget.Button', t: 'Add', b: [0, 500, 500, 600], f: 19 },
    { c: 'android.widget.Button', t: 'Add', b: [500, 500, 1080, 600], f: 19 },
    {
      c: 'android.widget.Button',
      id: 'android:id/button1',
      t: 'OK',
      b: [0, 700, 1080, 800],
      f: 19,
      go: 'home',
    },
    { t: 'Merhaba s3cr3t-pass', id: 'dev.app:id/greeting', b: [0, 900, 1080, 1000] },
  ],
  home: [
    { t: 'Ana sayfa', b: [0, 100, 1080, 200] },
    { c: 'android.widget.Button', t: 'Form', b: [0, 300, 1080, 400], f: 19, go: 'form' },
    { c: 'android.widget.Button', t: 'İzin', b: [0, 500, 1080, 600], f: 19, go: 'permission' },
  ],
  form: FORM,
  sent: [...FORM, { t: 'Gönderildi', id: 'dev.app:id/result', b: [0, 700, 1080, 800] }],
};
