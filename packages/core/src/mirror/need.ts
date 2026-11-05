/**
 * What stands between a device and a live picture, in one table: a viewer's banner, `mirror status`,
 * `doctor` and a refusal all say the same words.
 */
export const NEEDS = {
  locked: {
    title: 'The device is locked',
    fix: 'Unlock it. The picture goes on; input stops where it asks for a passcode.',
  },
  asleep: {
    title: 'The screen is off',
    fix: 'Wake the device. The picture comes back by itself.',
  },
  'not-trusted': {
    title: 'The device does not trust this Mac',
    fix: 'Unlock it and tap Trust, or accept the USB debugging prompt.',
  },
  'developer-mode-off': {
    title: 'Developer Mode is off',
    fix: 'Settings, Privacy & Security, Developer Mode.',
  },
  'ui-automation-off': {
    title: 'UI Automation is off',
    fix: 'Settings, Developer, Enable UI Automation.',
  },
  'disk-image-missing': {
    title: 'The developer disk image is not mounted',
    fix: 'xcrun devicectl device info ddiServices --auto-mount-ddis',
  },
  'os-too-old': {
    title: 'This version of the OS is too old',
    fix: 'Update the device.',
  },
  'camera-or-mic': {
    title: 'The camera or microphone is in use',
    fix: 'Close the app using it. The picture comes back by itself.',
  },
  call: {
    title: 'A call is in progress',
    fix: 'End the call. The picture comes back by itself.',
  },
  siri: {
    title: 'Siri is active',
    fix: 'Dismiss Siri. The picture comes back by itself.',
  },
  'taken-over': {
    title: 'Another app is mirroring this device',
    fix: 'Stop it, then reconnect. appdyno never takes a stream from another app.',
  },
  'presented-elsewhere': {
    title: 'Another app may be showing this simulator',
    fix: 'Close the simulator in Device Hub. No picture has come from it.',
  },
  'no-compiler': {
    title: 'No compiler for the viewer',
    fix: 'xcode-select --install',
  },
  'no-hardware-decoder': {
    title: 'This Mac has no hardware decoder for this stream',
    fix: 'Use --quality standard.',
  },
  'camera-permission': {
    title: 'Camera permission is needed for this path',
    fix: 'Allow it in System Settings, Privacy & Security, Camera.',
  },
  'no-phone-stream': {
    title: 'This build has no iPhone stream',
    fix: 'The runner still drives the phone, by screenshots and its own input.',
  },
  'not-connected': {
    title: 'The device is not connected',
    fix: 'Connect it with a data cable: one that only charges shows nothing here. The picture comes back by itself.',
  },
  'simulator-off': {
    title: 'The simulator is off',
    fix: 'Boot it: appdyno simulator boot, or the simulator tool.',
  },
  'no-grpc': {
    title: 'This emulator has no gRPC port',
    fix: 'Boot it with the simulator tool, for a picture with no lag.',
  },
  'no-display': {
    title: 'No window server in this session',
    fix: 'Run from a logged-in desktop, or use --headless.',
  },
} as const satisfies Record<string, { title: string; fix: string }>;

export type Need = keyof typeof NEEDS;

/** A refusal that a person's step can clear: the session waits for it, and a command line names it. */
export class NeedError extends Error {
  constructor(
    readonly need: Need,
    readonly detail?: string,
  ) {
    super(`${NEEDS[need].title}${detail ? ` (${detail})` : ''}. ${NEEDS[need].fix}`);
  }
}
