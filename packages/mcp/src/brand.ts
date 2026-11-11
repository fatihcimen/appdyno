import { SERVER_ICON_SVG } from '@appdyno/core';
import { DATA_LOSS_WORDS } from '@appdyno/ops';

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

export const INSTRUCTIONS = [
  'Tests, drives and measures iOS and Android apps on simulators, emulators and real phones: read the screen, tap, type, swipe, screenshots, video, logs, crashes, accessibility, network, and performance (frames, memory, CPU, launch time).',
  'Use these tools for anything on a phone, a simulator, an emulator or a mobile app.',
  'It drives one device: the one use_device selected, or the only one connected.',
  'Read the screen first; act on elements by ref or selector (tap, gesture, type_text, steps).',
  "A selector's text matches a label whatever its case or accents: the exact label if one matches, else every label that contains it; index picks one of several, from 0.",
  'Every action returns the settled screen after it (read: diff by default), no extra read needed, with changed: false when nothing moved and settled: false when it kept moving.',
  'No fixed sleeps: use wait_for. Take a screenshot only for a visual judgement.',
  'A failed answer starts with its code, and ends with a hint where there is one.',
  'When the app misbehaves: logs and crashes. Installing and managing apps: app. In every tool, app left out means the selected app.',
  "In the perf_ tools, scenario is the name a measure is kept under, a baseline takes 3 runs of it (perf_launch baseline: true), and probe: true puts the frame probe in an iOS simulator's app, which restarts it once: open the screen again and call again.",
  'Conditions and biometrics: device_setting. Pushes: push. Starting a simulator or emulator: simulator.',
  `${DATA_LOSS_WORDS} ask the person first.`,
  'To see why something was slow: report timeline, then the journey, then report stop: timeline.html holds video, touches, frames, requests, log and memory on one clock, in one file to send.',
].join(' ');
