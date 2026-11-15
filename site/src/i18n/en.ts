/** Every word of the site in English. `tr.ts` has the same keys, held to them by `Words`. */
export const en = {
  meta: {
    title: 'appdyno: let an AI agent drive, test and measure your mobile app',
    description:
      'Let an AI agent drive, test and measure your mobile app: iOS simulators, Android emulators and real phones, from one open-source MCP server, command line and Mac app.',
    locale: 'en_US',
    other: 'Türkçe',
  },
  nav: {
    label: 'Site',
    console: 'Try it',
    tools: 'What it does',
    faq: 'Questions',
    docs: 'Docs',
    github: 'GitHub',
  },
  hero: {
    kicker: 'MCP server · CLI · Mac app',
    title: 'Put your app on the <em>dyno</em>.',
    lede: 'Reproduce a mobile bug, find its cause with measurements, and turn the same flow into a test that runs again.',
    copy: 'Copy',
    copied: 'Copied',
  },
  bench: {
    label: 'The appdyno test bench: a dino technician runs a phone on a dynamometer',
    dino: 'A small dinosaur mechanic in a navy jumpsuit, holding a tablet',
    phone: 'A smartphone clamped on a dynamometer test bench with gauges',
    launch: 'cold launch',
    frames: 'frames / s',
    memory: 'memory',
  },
  console: {
    title: 'Ask. Watch it drive.',
    sub: 'Pick a job. The agent makes the same calls it would make on your simulator, emulator or phone, and every answer comes back with the screen as it settled. This is an example session.',
    jobs: 'Jobs to try',
    phone: 'An iPhone simulator running the shop example',
    client: 'agent → appdyno',
    ready: 'ready',
    running: 'running',
    done: 'done',
    idle: 'Pick a job above. The calls and answers show here.',
    you: 'you',
    app: {
      name: 'Beans',
      cart: 'Cart',
      add: 'Add',
      place: 'Place order',
      products: ['Ethiopia Guji', 'Colombia Huila', 'Kenya Nyeri'],
      prices: ['250 g · €14', '250 g · €12', '250 g · €15'],
      pushBody: 'Your order shipped. It arrives Thursday.',
      stopped: 'Beans stopped',
      stoppedAt: 'The app ended at Place order.',
    },
    checkout: {
      chip: 'Test the checkout',
      ask: 'test the checkout with three bags',
      tapped: 'tapped "Add"',
      ended: 'the app ended at this tap',
      crashed: 'Beans crashed at 09:41:07:',
    },
    push: {
      chip: 'Send a push',
      ask: 'send a shipping push',
      sent: 'sent by simctl push · the banner shows on the screen',
    },
    link: {
      chip: 'Open a deep link',
      ask: 'open the Kenya product page by its link',
      opened: 'opened in dev.beans',
      header: 'header',
    },
    perf: {
      chip: 'Measure the launch',
      ask: 'how fast does it start cold?',
      launch: 'cold launch, 5 runs: p50',
      scroll: '59 fps p50, 2 slow frames of 300 · memory 182 MB, no growth',
    },
    views: {
      chip: 'What draws this screen?',
      ask: 'what draws this screen?',
      framework: 'framework:',
    },
  },
  rack: {
    title: "What's on the rack",
    sub: '48 tools in one server. What a platform cannot do is refused with the reason, never faked.',
    tools: [
      {
        name: 'Read and drive',
        text: 'The screen as elements with refs, folded so it stays short. Tap, type, swipe, scroll to.',
        code: 'screen · tap · type_text · scroll_to',
      },
      {
        name: 'Pushes and links',
        text: 'Alert, rich, background and Live Activity pushes to a simulator or emulator, and deep links.',
        code: 'push · open_link',
      },
      {
        name: 'Measure',
        text: 'Cold and warm launch, frames as a list scrolls, memory, network, with baselines a CI gate holds.',
        code: 'perf_launch · perf_scroll · perf_compare',
      },
      {
        name: 'Native views',
        text: 'The view tree under the framework that draws it: SwiftUI, UIKit, Compose, Flutter, React Native, web.',
        code: 'screen views',
      },
      {
        name: 'Flows and evidence',
        text: 'Flows that replay on any device, visual baselines, video with taps marked, logs and crash reports.',
        code: 'flow run · record · logs · crashes',
      },
      {
        name: 'The device itself',
        text: 'Dark mode, locale, location, slow network, memory warnings, shakes, photos, then everything put back.',
        code: 'device_setting · restore',
      },
    ],
    safe: 'Safe by default: appdyno never resets or erases a phone, asks a person before anything that destroys data, and hides the secrets you name. No cloud, no telemetry, MIT.',
  },
  dials: {
    example: 'The dials show an example session.',
  },
  faq: {
    title: 'Questions',
    items: [
      {
        q: 'What is appdyno?',
        a: 'An open-source MCP server, command line, TypeScript library and Mac app that lets an AI agent drive, test and measure iOS and Android apps on simulators, emulators and real phones.',
      },
      {
        q: 'Which devices does it work with?',
        a: 'iOS simulators and iPhones with iOS 17 or newer, through Xcode, and Android emulators and phones with Android 8.0 or newer, through adb.',
      },
      {
        q: 'Which AI clients can use it?',
        a: 'Any MCP client. One command, npx -y appdyno install, finds the clients on your Mac and adds appdyno to the ones you pick.',
      },
      {
        q: 'What do I need to run it?',
        a: 'A Mac, and Node 22 or newer. The Mac app carries its own Node, and runs on Apple silicon with macOS 13.5 or newer.',
      },
      {
        q: 'Is it free, and where does my data go?',
        a: 'appdyno is free and open source under the MIT license. It runs on your Mac, with no cloud and no telemetry.',
      },
      {
        q: 'Can an agent erase my phone?',
        a: 'No. No tool erases or resets a device, and a person approves anything that loses data before it is done.',
      },
    ],
  },
  footer: {
    npm: 'npm',
    github: 'GitHub',
    changelog: 'Changelog',
    docs: 'Docs',
    analytics: 'This site counts visits with Cloudflare Web Analytics, without cookies.',
  },
  notFound: {
    title: 'Page not found',
    text: 'There is no page at this address.',
    home: 'Home',
    docs: 'Docs',
  },
  docs: {
    guides: 'Guides',
    reference: 'Reference',
    examples: 'Examples',
    architecture: 'How it works',
  },
};

export type Words = typeof en;
