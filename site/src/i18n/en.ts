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
    story: 'How it works',
    console: 'Try it',
    tools: 'What it does',
    mac: 'Mac app',
    source: 'Open source',
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
    label: 'The appdyno test bench: a small dragon looks after a phone on a dynamometer',
    dragon: 'A small navy dragon with a cyan belly and magenta wings, standing on the bench',
    phone: 'A smartphone clamped on a dynamometer test bench with gauges',
    launch: 'cold launch',
    frames: 'frames / s',
    memory: 'memory',
  },
  mascot: {
    tap: 'The bench dragon. Press it for a small puff of fire.',
    rest: 'Rest the dragon',
    wake: 'Wake the dragon',
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
  story: {
    title: 'What happens on the dyno',
    sub: 'One request, six moves. Scroll, and the phones do what the agent does on yours.',
    ios: 'iPhone 17 · simulator',
    android: 'Pixel 9 · emulator',
    steps: {
      read: {
        name: 'It reads the screen',
        text: 'Not pixels: the elements on the screen, each with a ref the agent can act on. <code>screen</code> gives them folded, so the answer stays short.',
      },
      tap: {
        name: 'It taps and types',
        text: 'By text, id or ref. Every action answers with the screen once it has settled, so the agent sees what it did in the same call.',
      },
      push: {
        name: 'It sends a push and opens a link',
        text: "A push of each type a simulator or an emulator takes, and the deep links your app opens. The banner is the app's own.",
      },
      measure: {
        name: 'It measures the launch',
        text: "Cold launch, frames while a list scrolls, memory: read with the platform's own tools, and kept as a baseline a CI gate holds.",
      },
      crash: {
        name: 'It finds the crash',
        text: "When a tap takes the app down, the same answer says so, with the app's last log line. <code>crashes</code> then gives the stack, down to the function.",
      },
      replay: {
        name: 'It replays the flow on Android',
        text: 'What the agent did once is saved as a flow. It runs again with no model: on an Android emulator, on a phone, in CI.',
      },
    },
    died: 'tapped "Place order", and the app died',
    lastLog: 'its last log line',
    saved: 'saved 4 steps as flows/checkout.flow',
    replayed: '4 steps, no model · fails at Place order, as on the iPhone',
    example: 'An example session: its times and numbers are examples.',
  },
  cases: {
    title: 'Three bugs, from report to regression test',
    problem: 'Problem',
    evidence: 'Evidence',
    test: 'Regression test',
    note: 'The numbers are an example.',
    items: [
      {
        name: 'A list that got slow',
        problem: 'Frames drop when the product list scrolls.',
        evidence:
          '<code>perf_scroll</code> before and after the fix: 41 fps with 38 slow frames of 300, then 59 fps with 2.',
        test: 'A flow that scrolls the list, with a <code>perf_compare</code> gate that fails when the frames drop again.',
      },
      {
        name: 'A checkout crash',
        problem: 'The app dies at Place order with three bags in the cart.',
        evidence:
          'The tap that took it down, its last log line, <code>Fatal error: Index out of range</code>, and the stack from <code>crashes</code>.',
        test: 'A flow that replays to the crash, and fails in CI until the bug is fixed.',
      },
      {
        name: 'A bug where native meets web',
        problem: 'A value is lost when the checkout moves from a native screen into a web view.',
        evidence:
          'The screen as elements up to the switch, and <code>webview</code> reading the page inside the web view.',
        test: 'A flow that replays the native steps up to the switch, then <code>webview</code> reads the value on the other side.',
      },
    ],
  },
  mac: {
    title: 'A Mac app, for the person in the room',
    sub: 'The agent is not alone on the device: you watch what it does, and use the same device while it drives.',
    points: [
      {
        name: 'Every device in one window',
        text: '<code>appdyno hub</code> opens every device on this Mac in one window, driven by mouse and keyboard while an agent drives it too.',
      },
      {
        name: 'Performance as it happens',
        text: 'Its Performance pane reads frames, CPU and memory as they happen.',
      },
      {
        name: 'Your AI clients',
        text: 'AI Clients shows each MCP client on this Mac as it truly stands, and adds appdyno to it.',
      },
      {
        name: 'Phones by cable or Wi-Fi',
        text: 'A phone joins by cable, or by Wi-Fi once paired with <code>appdyno pair</code>.',
      },
    ],
    download: 'Download the Mac app (.dmg)',
    after:
      'From the latest release on GitHub. Apple silicon, macOS 13.5 or newer. The app updates itself.',
    shots: {
      hub: {
        alt: 'The hub in its dark look: an iPhone simulator live in Settings while an AI client scrolls it, and the Performance pane reading the picture at 84 frames a second, CPU and memory',
        caption:
          'The hub: the devices on the left, the selected one live in the middle, its Performance pane on the right.',
      },
      links: {
        alt: "A real run: an MCP client lists the links a test app opens on an iPhone simulator in the hub, opens its deep link, sends it a push its own code shows, then another one onto the home screen, with each call's real time and first line of answer below",
        caption:
          "An agent opens an app's links and sends it a push while the window shows the phone.",
      },
      checkout: {
        alt: 'A real run: a terminal of MCP tool calls goes through the checkout of the shop example on an iPhone simulator in the appdyno hub, three bags of coffee beans into the cart and on to Place order, which takes the app down, and the answer says it died, with its last log line: Fatal error: Index out of range',
        caption:
          "A real run, not a mock-up: the checkout of the shop example, with each call's real time.",
      },
    },
  },
  source: {
    title: 'Open source, all of it',
    sub: 'The server, the command line, the Mac app and the agents that run on the devices are in one public repository. Read it, build it, change it.',
    license: {
      name: 'MIT license',
      text: 'Use it at work, change it, ship it. The license is one short file.',
    },
    github: {
      name: 'The code is on GitHub',
      text: 'Source, docs, tests and every release, with its changelog.',
      star: 'Star on GitHub',
    },
    local: {
      name: 'It runs on your Mac',
      text: 'appdyno sends no telemetry and needs no cloud: it runs on your Mac.',
    },
    install: {
      name: 'One command to install',
      text: 'It finds the MCP clients on this Mac and adds appdyno to the ones you pick.',
    },
    registry: {
      name: 'On the official MCP registry',
      text: 'Listed under its own name, so a client that reads the registry finds it.',
    },
    contribute: {
      name: 'Contributions welcome',
      text: 'Bug reports, fixes and new ideas. The guide says how to build and test.',
    },
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
