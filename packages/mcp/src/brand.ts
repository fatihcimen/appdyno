import { SERVER_ICON_SVG } from '@appdyno/core';

/** The server's icon, as a client shows it. */
export const DEVICE_ICON_SVG = SERVER_ICON_SVG;

export const SERVER_INFO = {
  name: 'appdyno',
  title: 'appdyno',
  version: '0.6.0',
  description:
    'Test, drive and measure iOS and Android apps on simulators, emulators and real phones.',
  websiteUrl: 'https://github.com/fatihcimen/appdyno',
  icons: [
    {
      src: `data:image/svg+xml;base64,${Buffer.from(DEVICE_ICON_SVG).toString('base64')}`,
      mimeType: 'image/svg+xml',
      sizes: ['any'],
    },
  ],
};

export const INSTRUCTIONS =
  'Tests, drives and measures iOS and Android apps on simulators, emulators and real phones: read the screen, tap, type, swipe, screenshots, video, logs, crashes, accessibility, network, and performance (frames, memory, CPU, launch time). Use these tools for anything on a phone, a simulator, an emulator or a mobile app. ' +
  'It drives one device: the one use_device selected, or the only one connected. Read the screen first; act on elements by ref or selector (tap, gesture, type_text, steps). ' +
  'Every action returns the settled screen after it (read: diff by default), no extra read needed, with changed: false when nothing moved and settled: false when it kept moving. ' +
  'No fixed sleeps: use wait_for. Take a screenshot only for a visual judgement. A failed answer has code and hint. When the app misbehaves: logs and crashes. ' +
  'Apps: app; an app left out is the selected one, scenario names what a measure is kept under, and probe is the frame probe of an iOS simulator, which relaunches the app. Conditions, push and biometrics: device_setting. Starting a simulator or emulator: simulator. ' +
  'To see why something was slow: report timeline, then the journey, then report stop: timeline.html holds video, touches, frames, requests, log and memory on one clock, in one file to send.';
