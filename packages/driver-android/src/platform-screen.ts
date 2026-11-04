import { alertButtonOf, alertOf, type PlatformScreen } from '@appdyno/core';

const INPUT_METHOD_WINDOW = 2;
const SYSTEM_WINDOW = 3;
const SYSTEM_UI = 'com.android.systemui';
const SYSTEM_DIALOGS =
  /^(android|com\.(google\.)?android\.(permissioncontroller|packageinstaller))$/;
const PERMISSION_PACKAGES = /^com\.(google\.)?android\.permissioncontroller$/;
const ALLOW = /:id\/permission_allow(_foreground_only|_one_time)?_button$/;
const DENY = /:id\/permission_deny(_and_dont_ask_again)?_button$/;
const STATUS_BAND_DP = 56;

export const androidScreen: PlatformScreen = {
  /**
   * Its system windows that hold the focus, and its permission and chooser dialogs; a dialog of an app is the app's own.
   * Without the focus a system window asks nothing: a maker's edge panel handle, always there, or a toast.
   */
  systemAlert(tree, elements) {
    const pkgs = new Set(
      tree.windows
        .filter(
          (w) =>
            w.pkg &&
            w.pkg !== SYSTEM_UI &&
            ((w.type === SYSTEM_WINDOW && w.focused) || SYSTEM_DIALOGS.test(w.pkg)),
        )
        .map((w) => w.pkg!),
    );
    return alertOf(
      elements.filter((e) => e.pkg && pkgs.has(e.pkg)),
      (e) => !!e.clickable,
    );
  },

  /** A permission controller's allow or deny button, by id, in any language. */
  // shortcut: ids of the stock permission controller; add an OEM's when a device shows another
  alertButton(elements, action) {
    return alertButtonOf(
      elements.find((e) => {
        const id = e.identifier ?? '';
        const pkg = /^([\w.]+):id\//.exec(id)?.[1] ?? '';
        return (
          !!e.rect && PERMISSION_PACKAGES.test(pkg) && (action === 'allow' ? ALLOW : DENY).test(id)
        );
      }),
    );
  },

  keyboardOpen: (tree) => tree.windows.some((w) => w.type === INPUT_METHOD_WINDOW),

  /** The first app window's top when it leaves room for the bar, else a tall bar's height. */
  statusBand(tree, density = 160) {
    const app = tree.windows.find((w) => w.type === 1 && w.b[1] > 0);
    return app ? app.b[1] : Math.round((STATUS_BAND_DP * density) / 160);
  },
};
