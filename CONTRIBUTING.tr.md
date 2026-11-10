# Katkıda bulunmak

[English](CONTRIBUTING.md)

Burada herkes [Davranış Kuralları](CODE_OF_CONDUCT.tr.md)'na uyar.

## Kurulum

macOS, Node 26 ve pnpm 12 gerekir. appdyno'nun çalıştığı en eski sürüm Node 22'dir ve CI onda da test eder.

```sh
mise install        # Node 26, pnpm 12, JDK 25 ve linter'lar (bkz. .mise.toml)
pnpm install
pnpm run ci         # lint, tipler, testler, derleme
```

Bu, temiz bir klonda; cihaz, Xcode projesi ve JDK olmadan çalışır.

Bir cihaz üzerinde çalışmak için daha fazlası gerekir: iOS için Xcode, Android için `adb` ile birlikte Android SDK. Android ajanını
bir kez derleyin, değiştirdiğinizde yeniden derleyin. Yayımlanan paketin kullanıcılarının JDK'ya ihtiyacı yoktur.

```sh
(cd android && ./gradlew :agent:assembleDebug)
pnpm build          # ajanı paketler; ajanı olmayan bir paket bu Mac'ten çıkmayı reddeder
```

## Kontroller

```sh
pnpm run ci
scripts/lint-native.sh                        # TypeScript olmayan her şey; Xcode ve bir JDK gerekir
(cd android && ./gradlew --console=plain :agent:testDebugUnitTest)
(cd ios/RunnerCore && swift test)             # iOS runner'ının çekirdeği
```

`pnpm lint`, eslint'i ve `prettier --check`'i çalıştırır; `pnpm format` biçimi düzeltir. Aynı kontroller
`.github/workflows/ci.yml` içinde de çalışır. eslint, bütün TypeScript ve JavaScript'i derleyicinin tipleriyle typescript-eslint'in `strictTypeChecked`
ve `stylisticTypeChecked` kurallarına bağlı tutar.

`scripts/lint-native.sh`, `.mise.toml`'un sabitlediği linter'ları çalıştırır ve herhangi bir uyarıda başarısız olur: shell
betikleri için shellcheck ve shfmt (`ci.sh` zsh'tir, shellcheck onu okumaz, bu yüzden onu `zsh -n` ayrıştırır), workflow'lar için
actionlint ve zizmor, `.swiftlint.yml` ile `--strict` altında SwiftLint, `android/.editorconfig` ile ktlint ve her
modülün `lint.xml`'i ile, uyarılar hata sayılarak Android Lint, CI'da cask için `brew style` (Homebrew'a gem kurar, bu yüzden
size ait bir Mac'te onun yerine `ruby -c` geçer), Objective-C için de `.clang-format` ile clang-format, Xcode'un önerdiği
uyarılar hata olarak ve clang statik analizörü. `clang-format -i <file>` bir biçimi düzeltir, ara sıra ikinci bir
geçişte. Bir API'nin bloğunun ya da callback'inin verdiği ve kodun okumadığı bir parametre `__unused` ile işaretlenir. Uyarılar yalnızca
lint'e aittir: bir Mac'in viewer'ı ve yardımcıları ilk kullanımda derlediği bayraklar olduğu gibi kalır, çünkü daha yeni bir clang'ın yeni
bir uyarısı bir kişiyi viewer'sız bırakmamalıdır.

`pnpm typecheck`, kökteki `tsconfig.json` ile her `.mjs`'i ve kökteki config'leri de paketlerin tiplerine bağlı tutar:
bir betik elle çalıştırılır ve ona hiçbir test ulaşmaz. O config bir betiği bir paket kadar sıkı tutar: bir parametrenin ve
sonradan dolan boş bir dizinin JSDoc tipi vardır, `/** @param {string} serial */` gibi.

Android'in trace'lerini okuyan Perfetto trace processor'ı `packages/driver-android/src/tools.ts` içinde sürümüyle ve
sürümünün her zip için yayımladığı sha256 ile sabitlenir; uygulamanın build'i de aynı sabiti alır. Daha yeni bir sürüm,
Android sürücüsünün gönderdiği her sorgu ondan aynı sütunları okuduğunda ve açılış sayıları tuttuğunda, `perf`,
`measures-android` ve `frame-cause` suite'leri bir API 34 emülatöründe geçerek sabitlenir.

## Cihaz suite'leri

Bunlar gerçek bir emülatör, simülatör ya da telefon ister ve onun adını siz verirsiniz. Hiçbir zaman varsayılan bir cihaz yoktur, çünkü
başka cihazlar da bağlı olabilir.

```sh
(cd android && ./gradlew :agent:assembleDebug :fixture:assembleDebug :push-fixture:assembleDebug)
adb -s <serial> install -r -g android/fixture/build/outputs/apk/debug/fixture-debug.apk
adb -s <serial> install -r -g android/push-fixture/build/outputs/apk/debug/push-fixture-debug.apk
(cd ios && xcodebuild build-for-testing -project Appdyno.xcodeproj -scheme Runner \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath .derived)
APPDYNO_ANDROID_SERIAL=<serial> APPDYNO_IOS_UDID=<udid> pnpm test:device
```

Yalnızca elinizdeki cihazın değişkenini ayarlayın. iOS derlemesi runner'ı ve her simülatör suite'inin kurduğu
fixture uygulamasını yapar. `APPDYNO_IPHONE_UDID` iPhone suite'lerini çalıştırır ve
[Araçlar](docs/reference/tools.tr.md#bir-telefona-ulaşmak) sayfasındaki imzalama değişkenlerini ister. Bkz. `vitest.device.config.ts` ve `docs/reference/ci.md`. `scripts/ci.sh`
her kapıyı yerelde çalıştırır ve sonuçları kaydeder.

Bir suite'in kullandığı cihazda hub'ı kapatın. Bir suite durumunu `APPDYNO_STATE_DIR` ile kendine ait bir klasörde tutar, bu yüzden
varsayılan klasöre bağlı kalan bir hub'ın ajanını paylaşamaz; ikisi de diğerinin token'ını okuyamaz ve bir cihazda
tek bir ajana yer vardır. Bir hub bir suite'in ajanını kullanımda bulursa `AGENT_CONFLICT` ile durur; bir hub'ınkini bulan
bir suite de öyle. Bir hub çalışan bir emülatörü ya da simülatörü kendiliğinden alır, bu yüzden iki bağlantı arasındaki bir suite ajanını
açık bırakılmış birine yine kaptırabilir, bir telefon da kimin bağlı olduğunu gösteren tabloyu bir shell'den saklayabilir.

## Kendine ait değişkenler

Bir kişinin ayarlayabilecekleri [CLI başvurusunda](docs/reference/cli.tr.md#sunucu-seçenekleri) ve onun yönlendirdiği
sayfalardadır. Aşağıdaki değişkenler appdyno'nun kendinedir: süreçlerinden biri onları bir başkasına verir ya da bir test
ayarlar. Başka hiçbir şey onları ayarlamamalıdır ve herhangi biri değişebilir. `packages/appdyno/test/environment.test.ts`,
kaynaklardaki her `APPDYNO_` adını belgelere ya da bu tabloya bağlı tutar.

| değişken                   | ayarlayan                               | ne için                                                                                                     |
| -------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `APPDYNO_HELPERS`          | Mac uygulamasının `appdyno` komutu      | uygulamanın hazır derlenmiş görüntüleyicisinin ve yardımcılarının yeri: ilk kullanımda hiçbir şey derlenmez |
| `APPDYNO_NATIVE_DIR`       | testler ve `scripts/build-app.mjs`      | görüntüleyicinin ve yardımcıların `~/Library/Caches/appdyno/native` yerine derlendiği yer                   |
| `APPDYNO_HELD_BY_HUB`      | hub, çalıştırdığı bir komut için        | komut hub ile birlikte biter                                                                                |
| `APPDYNO_PROBE_OUT`        | kare ölçerin başlatılışı, uygulama için | uygulamadaki ölçerin karelerini yazdığı dosya                                                               |
| `APPDYNO_RECORD_SEGMENT_S` | `device-tests/evidence.test.ts`         | bir Android kaydının parçası, yoksa 180 sn; böylece uzun bir kaydın testi kısa sürer                        |

## Modüller

`packages/` altındaki her paket yalnızca kendi kuralının izin verdiği paketleri içe aktarabilir. Örneğin `core`
`protocol`'ü içe aktarabilir, başka hiçbir şeyi değil; `driver-android` ve `driver-apple` de birbirini hiçbir zaman içe aktarmaz. Kurallar
ve onları uygulayan test `packages/appdyno/test/boundaries.test.ts` içindedir. Bir paketin testleri de, testin adını verdiği
birkaçı dışında, kendi kuralına uyar. Mimari gerektiriyorsa kuralı orada değiştirin, etrafından dolaşmayın.

`packages/appdyno/test/structure.test.ts`, `packages/*/src` içindeki bir dosyayı ve bizim yazdığımız her `.kt`, `.swift`, `.m` ve `.h`
dosyasını, bir gerekçeyle adını verdikleri dışında, tek bir işe ve 450 satıra bağlı tutar ve iki kez geçen 8 satırlık bir diziyi
reddeder. İki sürücünün de yaptığı şey `core`'a aittir; iOS runner'ının cihaz olmadan verdiği kararlar
`ios/RunnerCore`'a, Android ajanınınkiler ise içinde framework olmayan, birim testinin ulaştığı kendine ait bir sınıfa.

`packages/appdyno/test/function-size.test.ts` aynısını bir TypeScript fonksiyonu için 200 satırda yapar; içindeki bir closure
da ayrıca sayılır: bir dosyanın sınırı, bir sınıf kadar durum tutan tek bir closure'ı hiç görmez. Sınırı aşanların
her biri, neyinin uzun olduğuyla birlikte adıyla anılır.

`packages/ops` bir istemcinin çağırdığıdır, `packages/hub` ise onun üstünde hub'ın ve bir pencerenin denetleyicisi. Hub'ın
`ops`'tan aldığı, `ops`'un `index.ts`'inde dışarı verdiğidir ve yukarıdaki kural `ops`'un hub'ı içe aktarmasını engeller.

## Yeni bir platform

Bir platform tek bir sürücü paketidir: kendine ait bir araçla listelediği her cihaz türü için bir `DeviceProvider` (Apple'ın
simülatörleri ve iPhone'ları iki türdür), bir `Device`, bir `PlatformScreen` ve bir `MeasureSource`; derleyici her birini
portun tamamına bağlı tutar, ölçmenin hiçbir yolu olmayan şey için `cannot` vardır. Paketin dışında, platform
`packages/protocol/src/messages.ts` içindeki `PLATFORMS`'u, ona göre anahtarlanmış `packages/core/src/device.ts` ve
`packages/perf/src/dashboard/format.ts` içindeki tabloları, `packages/appdyno/src/providers.ts` içindeki sağlayıcılarını ve
`boundaries.test.ts` içindeki kuralını alır. Listeyi `packages/appdyno/test/platforms.test.ts` tutar.

## Burada kullanılan sözcükler

Buradaki bazı adların kendine özgü bir anlamı vardır:

- Bir **place**, hub'ın penceresinde bir cihazın duracağı yerde duran şeydir: Yapay Zekâ İstemcileri ve Yardım. `HubServices` bunların bu Mac'ten istedikleridir.
- **Words**, `WordsTable.m` ve `wordsOf` içindeki, bir kişi için yazılmış metinlerdir; bir **need** ise bir kişiyle bir cihaz arasında duran şeydir, düzeltmesiyle birlikte.
- **said** ve **heard**, bir sürecin yazdığı ve karşı tarafın ondan aldığıdır; viewer'ın hattında ya da bir komutun çıktısında.
- Bir çalıştırmayı **keep** etmek, kayıtlarını kapı için saklamaktır; bir **source** ise bir pencerenin gösterdiğinin kaynağı ya da bir sayıyı ölçen şeydir.

## Commit'ler

Commit başına tek değişiklik, `git log --oneline -15` üslubunda kısa bir mesajla: `type: what changed`;
`type`, `feat`, `fix`, `refactor`, `test`, `docs`'tan biridir ve isteğe bağlı bir kapsam alır, `fix(ios): ...` gibi.

## Yorumlar

Yalnızca kodun gösteremediği neden için yorum yazın. Kodun ne yaptığını yeniden söylemeyin. Fixture'lar
ve testler nötr İngilizce adlar kullanır.

## Tipler ve sıkı lint

Kod typescript-eslint'in tipe dayalı kurallarını kendisi karşılar: bir kural, orada yanlış olduğu yerde yalnızca tek bir satır için,
`-- why` ile kapatılır ve `eslint.config.js` ayarladığı her kural için nedenini söyler. Bir düzeltme kodun yaptığını
hiçbir zaman değiştirmez.

- Bir `!`, derleyicinin izleyebildiği şeye yerini bırakır: bir index yerine bir destructuring ya da girdiler üzerinde bir döngü, `has` sonra
  `get!` yerine tek bir `get` ve bir kontrol, bir `if`'in daralttığı değerin bir `const`'ta tutulması. Kodun tiplerin bilemediğini bildiği yerde
  (sınırlar içindeki bir index, kendi koyduğu bir anahtar, bir regex'in grubu) core'un `must(value, 'what')`'ı eksik olanı adıyla söyleyerek
  hata fırlatır; bir `!` ise undefined ile devam ederdi. Hiçbir şeyi içe aktarmayan `protocol` bir `if` ile kontrol eder. Onun yerine hiçbir zaman
  `as` kullanılmaz. Bir testte vitest'in `assert(x)`'i daraltır; eşleştiricisi undefined'da başarısız olan bir `expect`'in içinde
  `?.` yeterlidir.
- `await` içermeyen bir `async` fonksiyon, hiçbir çağıranın ondan bir promise beklemediği yerde düz bir fonksiyondur ve çağıranlar
  `await`'lerini bırakır. Tipi ya da bir çağıran bir promise istediğinde (bir port, onun bir sahtesi, üzerindeki bir `.catch`)
  `Promise.resolve(x)` döndürür, bir `throw` yerine de `Promise.reject(e)`, çünkü bir `.catch` throw'u kaçırırdı; kendi başına
  hata fırlatabilecek bir gövde `new Promise((resolve) => { resolve(work()); })` içine girer.
- Dışarıdan gelen (JSON, hat, bir cihaz, bir dosya, ortam, argv, bir aracın çıktısı), bir şema ya da bir kontrol onu daraltana kadar `unknown`'dır ya da
  neyin eksik olabileceğini söyleyen bir tiptir; böylece üzerindeki bir kontrol tiplerin de ihtiyaç duyduğu bir kontrol olur:
  `no-unnecessary-condition` onu hiçbir zaman kaldırmaz. Biçimini kodun kendisinin yazdığı JSON çağrının yerinde cast edilir,
  hiçbir zaman onu gizleyen bir generic ile değil. Bir `catch` callback'i `(e: unknown)` alır ve onu
  `e instanceof Error ? e.message : String(e)` ile okur.
- Bir callback'in ayarladığı ve derleyicinin başladığı değer sandığı bir bayrak `let done = false as boolean` olur;
  typescript-eslint bunun için bunu önerir, yanında nedenini söyleyen bir söz bulunur.
- `||` string'ler ve boolean'lar için kalır, orada `''` ve `false` istendiği gibi geçip gider; bir sayı ya da bir nesne `??` alır,
  `0`'ın da geçip gitmesi gerekmedikçe; o zaman satır bunu söyler.
- Bağlanmadan dolaştırılan şey (`stop`, bir sahtenin üyeleri) bir ok fonksiyonudur ya da bağlanmıştır. Bir mock, bir testte olduğu
  mock olarak okunur, hiçbir zaman portunun tipinden değil.
- Bir şablon string'ler ve sayılar tutar: bir undefined, olamayacağı yerde daraltmayla gider; `String(x)` ise metnin
  kastedildiği yerde onu korur. vitest'in asimetrik eşleştiricileri `any` tiplidir: bir nesnenin içindeki `as unknown` olur.
- Bir birleşimdeki `void`, `undefined`'dır; hiçbir şey yanıtlamayan bir fonksiyon `Promise<undefined>` der, çünkü TypeScript
  `void` için `return` kabul etmez.

## Belgeler

[Belgeler](docs/README.tr.md), okuru bir işin içinden geçiren rehberleri ve bir şeye bakmak için bir başvuruyu tutar. Yeni
bir sayfa bunlardan birine ve dizine girer. Belgelerdeki bir sayı sizin çalıştırdığınız bir sayıdır: neyin üzerinde ve hangi yükle olduğunu söyleyin.

Her belge İngilizce ve Türkçedir, `X.md` ve `X.tr.md`, `CHANGELOG.md` de, ve birindeki bir değişiklik ikisinde de yapılır,
bir değişiklik günlüğü satırı da: `docs.test.ts` ikisini, her biri kendi dilinde, aynı satırlara, koda, sayılara ve bağlantılara bağlı tutar.

Diyagramlar `docs/images` içinde elle yazılmış SVG'lerdir, üreteç yoktur. Her birinin kendi zemini vardır, böylece her sayfada okunur, ve
iki dosya olarak gelir: açık `X.svg` ve koyu `X.dark.svg`; bir sayfa onları, `<source media="(prefers-color-scheme: dark)">`'u
GitHub'ın temasına göre seçen bir `<picture>` içinde gösterir: bir SVG'nin içindeki media query GitHub'ın temasını değil,
sistemin temasını izler. Türkçe bir sayfa `X.tr.svg` ve `X.tr.dark.svg` gösterir. Bir tane çizmek için başka birinin stil bloğunu kopyalayın
ve onun biçimlerine bağlı kalın: mavi sizin Mac'iniz, turkuaz ya da mor cihaz, pembe soran kimse. Ona iki temada da
bakın.
`packages/appdyno/test/docs.test.ts` onları koda, belgelerdeki her bağlantıyı da gerçek bir hedefe bağlı tutar.
