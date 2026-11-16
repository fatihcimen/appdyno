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
    mac: 'Mac app',
    docs: 'Docs',
    github: 'GitHub',
  },
  hero: {
    title:
      'Reproduce a mobile bug, find its cause with measurements, and turn the same flow into a test that runs again.',
    sub: 'appdyno lets an AI agent drive, test and measure your iOS and Android app.',
    copy: 'Copy',
    copied: 'Copied',
    clients: 'Works with any MCP client.',
    shot: 'A real run: a terminal of MCP tool calls goes through the checkout of the shop example on an iPhone simulator in the appdyno hub, three bags of coffee beans into the cart and on to Place order, which takes the app down, and the answer says it died, with its last log line: Fatal error: Index out of range',
  },
  mascot: {
    picture: 'A small navy dragon with a cyan belly and magenta wings',
    tap: 'The dragon. Press it for a small puff of fire.',
    rest: 'Rest the dragon',
    wake: 'Wake the dragon',
  },
  console: {
    title: 'Ask. Watch it drive.',
    sub: 'Pick a job. The agent makes the same calls on your simulator, emulator or phone.',
    jobs: 'Jobs to try',
    phone: 'An iPhone simulator running the shop example',
    client: 'agent → appdyno',
    ready: 'ready',
    running: 'running',
    done: 'done',
    idle: 'Pick a job above. The calls and answers show here.',
    you: 'you',
    tools: 'See all 34 tools',
    example: 'An example session: its numbers are examples.',
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
    flow: {
      chip: 'Replay it as a test',
      ask: 'save the checkout as a flow and run it again',
      saved: 'saved 4 steps as flows/checkout.flow',
      replayed: '4 steps, no model · fails at Place order, as before',
    },
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
        problem: 'Frames drop as the product list scrolls.',
        evidence: '<code>perf_scroll</code>: 41 fps before the fix, 59 after.',
        test: 'A flow with a <code>perf_compare</code> gate.',
      },
      {
        name: 'A checkout crash',
        problem: 'The app dies at Place order.',
        evidence: 'Its last log line, and the stack from <code>crashes</code>.',
        test: 'A flow that fails in CI until the fix.',
      },
      {
        name: 'A value lost in a web view',
        problem: 'A value is lost between a native screen and a web view.',
        evidence: '<code>webview</code> reads the page inside the web view.',
        test: 'A flow up to the switch, then <code>webview</code> reads the value.',
      },
    ],
  },
  mac: {
    title: 'A Mac app, for the person in the room',
    sub: 'Watch what the agent does, and use the same device while it drives.',
    points: [
      {
        name: 'Every device in one window',
        text: '<code>appdyno hub</code> shows each one live, driven by mouse and keyboard.',
      },
      {
        name: 'Performance as it happens',
        text: 'Frames, CPU and memory, read live.',
      },
      {
        name: 'Your AI clients',
        text: 'It adds appdyno to each MCP client on this Mac.',
      },
    ],
    download: 'Download the Mac app',
    after: 'Apple silicon, macOS 13.5 or newer. The app updates itself.',
    shot: 'The hub in its dark look: an iPhone simulator live in Settings while an AI client scrolls it, and the Performance pane reading the picture at 84 frames a second, CPU and memory',
  },
  source: {
    title: 'Open source',
    local: 'appdyno sends no telemetry and needs no cloud: it runs on your Mac.',
    license: 'MIT license',
    star: 'Star on GitHub',
    registry: 'On the MCP registry as',
    contribute: 'Contributing',
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
