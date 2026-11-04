/** The server's icon: a plain phone outline. */
export const DEVICE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="9" y="3" width="14" height="26" rx="3" fill="none" stroke="#444" stroke-width="2"/><line x1="14" y1="25" x2="18" y2="25" stroke="#444" stroke-width="2" stroke-linecap="round"/></svg>';

export const SERVER_INFO = {
  name: 'appdyno',
  title: 'appdyno',
  version: '0.6.0',
  icons: [
    {
      src: `data:image/svg+xml;base64,${Buffer.from(DEVICE_ICON_SVG).toString('base64')}`,
      mimeType: 'image/svg+xml',
      sizes: ['any'],
    },
  ],
};

export const INSTRUCTIONS =
  'Drives a mobile device: the one use_device selected, or the only one connected. Read the screen first; act on elements by ref or selector (tap, gesture, type_text, steps). ' +
  'Every action returns the settled screen after it (read: diff by default), no extra read needed, with changed: false when nothing moved and settled: false when it kept moving. ' +
  'No fixed sleeps: use wait_for. Take a screenshot only for a visual judgement. A failed answer has code and hint. When the app misbehaves: logs and crashes. ' +
  'Apps: app; an app left out is the selected one, scenario names what a measure is kept under, and probe is the frame probe of an iOS simulator, which relaunches the app. Conditions, push and biometrics: device_setting. Starting a simulator or emulator: simulator.';
