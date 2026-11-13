# Shop

[Türkçe](README.tr.md)

A small iOS app to try appdyno on: a catalog, a cart and a checkout, with one bug left in on purpose. A line of three or more of one product reads past the end of the discount table, and the app dies at **Place order**.

## Build it

On a Mac with Xcode, and a simulator booted:

```sh
cd docs/examples/shop
xcodebuild -project Shop.xcodeproj -scheme Shop -sdk iphonesimulator -derivedDataPath build build
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/Shop.app
```

## Find the bug

Ask your agent:

> Open dev.appdyno.shop, buy three bags of coffee beans, and tell me what breaks.

The tap on **Place order** answers that the app died, with its last log lines:

```text
APP_NOT_RUNNING: tapped @7rwa "Place order"; the app died: EXC_BREAKPOINT SIGTRAP Trace/BPT trap: 5 (~/Library/Logs/DiagnosticReports/Shop-….ips)
its last log lines:
2026-11-13 15:04:41.624 Df Shop[46315:14884fe] (libswiftCore.dylib) Swift/ContiguousArrayBuffer.swift:695: Fatal error: Index out of range
  launch_app starts it again, and crashes says why it died
```

`crashes` names the function: `discount(forQuantity:)`, called from `total(of:)`.

## Fix it, and keep it fixed

[`flows/checkout.flow`](flows/checkout.flow) is the same checkout, as a flow. It fails at the order until the bug is fixed, and passes after:

```sh
npx -y appdyno test flows/checkout.flow --device <simulator id>
```

The fix, in `Shop/ShopApp.swift`: `discounts[min(quantity, discounts.count - 1)]`. Run in CI, the flow fails a pull request that brings the bug back.
