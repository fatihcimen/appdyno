# appdyno

A local device automation server for mobile QA: one MCP stdio server (`appdyno-mcp`) and a
TypeScript host library (`appdyno`) that drive the iOS simulator, real iPhones, the Android
emulator and real Android phones through our own on-device agents, and measure app and device
performance on each of them.

Status: planning. No implementation yet.

- Runs only on the machine it is started on: the MCP client starts it over stdio; it opens no
  network listener beyond loopback and device port forwards.
- Android: a Kotlin on-device agent on the platform UI automation APIs, reached over an adb forward.
- iOS: an XCUITest-based agent in Swift for the simulator and real iPhones.
