# Shop

[English](README.md)

appdyno'yu denemek için küçük bir iOS uygulaması: bir katalog, bir sepet ve bir ödeme; içinde bilerek bırakılmış bir hata. Bir üründen üç ya da daha fazlası olan bir satır, indirim tablosunun sonunu aşar ve uygulama **Place order**'da ölür.

## Derleyin

Xcode'lu bir Mac'te, bir simülatör açıkken:

```sh
cd docs/examples/shop
xcodebuild -project Shop.xcodeproj -scheme Shop -sdk iphonesimulator -derivedDataPath build build
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/Shop.app
```

## Hatayı bulun

Ajanınıza sorun:

> dev.appdyno.shop'u aç, üç paket kahve çekirdeği al ve neyin bozulduğunu söyle.

**Place order**'a dokunuş, uygulamanın öldüğünü son log satırlarıyla birlikte söyler:

```text
APP_NOT_RUNNING: tapped @7rwa "Place order"; the app died: EXC_BREAKPOINT SIGTRAP Trace/BPT trap: 5 (~/Library/Logs/DiagnosticReports/Shop-….ips)
its last log lines:
2026-11-13 15:04:41.624 Df Shop[46315:14884fe] (libswiftCore.dylib) Swift/ContiguousArrayBuffer.swift:695: Fatal error: Index out of range
  launch_app starts it again, and crashes says why it died
```

`crashes` fonksiyonun adını verir: `total(of:)` içinden çağrılan `discount(forQuantity:)`.

## Düzeltin ve düzeltilmiş kalsın

[`flows/checkout.flow`](flows/checkout.flow) aynı ödemedir, bir akış olarak. Hata düzeltilene kadar siparişte başarısız olur, sonra geçer:

```sh
npx -y appdyno test flows/checkout.flow --device <simulator id>
```

`Shop/ShopApp.swift`'teki düzeltme: `discounts[min(quantity, discounts.count - 1)]`. CI'da çalışan akış, hatayı geri getiren bir pull request'i başarısız sayar.
