# Katkıda bulunmak

[English](CONTRIBUTING.md)

appdyno'ya yardım ettiğiniz için teşekkürler. Burada herkes [Davranış Kuralları](CODE_OF_CONDUCT.tr.md)'na uyar.

## Bir değişiklik göndermek

Bir hata için Bug report formuyla, appdyno'nun henüz yapmadığı bir şey için de Feature request formuyla bir issue açın. Bir düzeltmeden büyük her şey için önce bir issue açıp neyi değiştirmek istediğinizi söyleyin: uymayabilecek bir işe emek vermekten sizi kurtarır. Bir güvenlik sorununu [SECURITY](SECURITY.tr.md) sayfasının dediği gibi özel olarak bildirin, asla bir issue ile değil.

Bir pull request tek bir değişiklik taşır. Açmadan önce `pnpm run ci` geçmeli ve her commit, bir kullanıcının fark edeceği bir değişiklikse `CHANGELOG.md` içindeki satırıyla birlikte, [Commit'ler](#commitler) bölümünün dediği gibi yazılmalı. Bir cihaza dokunuyorsa hangi cihazda çalıştırdığınızı söyleyin.

Katkınız, geri kalanı gibi [MIT Lisansı](LICENSE) altındadır.

## Kurulum

macOS, Node 26 ve pnpm 12 gerekir. appdyno'nun çalıştığı en eski sürüm Node 22'dir ve CI onda da test eder. [mise](https://mise.jdx.dev), `.mise.toml` dosyasının sabitlediği sürümleri kurar; başka bir yolla kurulmuş Node ve pnpm de olur.

```sh
mise install        # isteğe bağlı: Node 26, pnpm 12, yerel parçalar için de JDK 25 ve linter'lar
pnpm install
pnpm run ci         # lint, tipler, testler, derleme
```

`pnpm run ci` temiz bir klonda çalışır; cihaz, Xcode projesi ya da JDK istemez.

Bir cihaz üzerinde çalışmak için daha fazlası gerekir: iOS için Xcode; Android için `adb` ile birlikte Android SDK ve ajan için bir JDK 25. Ajanı bir kez derleyin, değiştirdiğinizde yeniden derleyin. Yayımlanan paketin kullanıcılarının JDK'ya ihtiyacı yoktur.

```sh
(cd android && ./gradlew :agent:assembleDebug)
pnpm build          # ajanı pakete koyar; ajan yoksa `pnpm pack` başarısız olur
```

## Kaynak koddan derlemek

`scripts/install.sh` kaynak kodunuzu derler ve `appdyno` komutunu ondan kurar. Bir değişiklikten sonra yeniden çalıştırın.

```sh
sh scripts/install.sh      # ajanı ve paketleri derler, appdyno'yu paketleyip kurar
appdyno doctor             # bu Mac'te ve bir cihazda hâlâ neyin eksik olduğu
```

Yalnızca iOS kullanacak olsanız da Android ajanını derler; bu yüzden PATH'inizde, `JAVA_HOME` ile ya da mise üzerinden bulunan bir JDK 25 ve Gradle'ın `ANDROID_HOME` ile ya da `android/local.properties` içindeki `sdk.dir` ile bulduğu, platform 37.2 ve build-tools 37.0.0 içeren Android SDK gerekir. Paketlenen dosyayı registry'den almadan `npm install -g` ile npm'in global prefix'ine ya da `APPDYNO_PREFIX`'in adını verdiği klasöre kurar. iOS runner'ları ilk kullanımda derlenir, ya da hemen `appdyno ios build` ile.

Mac uygulamasını derlemek için bkz. [Mac uygulaması](docs/reference/ci.tr.md#mac-uygulaması).

## Kontroller

```sh
pnpm run ci
scripts/lint-native.sh                        # TypeScript olmayan her şey; Xcode ve bir JDK gerekir
(cd android && ./gradlew --console=plain :agent:testDebugUnitTest)
(cd ios/RunnerCore && swift test)             # iOS runner'ının çekirdeği
```

`pnpm lint`, eslint'i ve `prettier --check`'i çalıştırır; `pnpm format` biçimi düzeltir. Aynı kontroller `.github/workflows/ci.yml` içinde de çalışır. eslint, bütün TypeScript ve JavaScript'i derleyicinin tipleriyle typescript-eslint'in `strictTypeChecked` ve `stylisticTypeChecked` kurallarına bağlı tutar. Tipler, lint'lediği her dosyayı kapsayan tek bir programındır, `tsconfig.eslint.json`; yeni bir kod klasörü onun `include`'una eklenir.

`scripts/lint-native.sh`, `.mise.toml`'un sabitlediği linter'ları çalıştırır ve herhangi bir uyarıda başarısız olur: shell betikleri için shellcheck ve shfmt (`ci.sh` zsh'tir, shellcheck onu okumaz, bu yüzden onu `zsh -n` ayrıştırır), workflow'lar için actionlint ve zizmor, `.swiftlint.yml` ile `--strict` altında SwiftLint, `android/.editorconfig` ile ktlint ve her modülün `lint.xml`'i ile, uyarılar hata sayılarak Android Lint, CI'da cask için `brew style` (Homebrew'a gem kurar, bu yüzden size ait bir Mac'te onun yerine `ruby -c` geçer), Objective-C için de `.clang-format` ile clang-format, Xcode'un önerdiği uyarılar hata olarak ve clang statik analizörü. `clang-format -i <file>` bir biçimi düzeltir, ara sıra ikinci bir geçişte. Bir API'nin bloğunun ya da callback'inin verdiği ve kodun okumadığı bir parametre `__unused` ile işaretlenir. Uyarılar yalnızca lint'e aittir: bir Mac'in viewer'ı ve yardımcıları ilk kullanımda derlediği bayraklar olduğu gibi kalır, çünkü daha yeni bir clang'ın yeni bir uyarısı bir kişiyi viewer'sız bırakmamalıdır.

`pnpm typecheck`, kökteki `tsconfig.json` ile her `.mjs`'i ve kökteki config'leri de paketlerin tiplerine bağlı tutar: bir betik elle çalıştırılır ve ona hiçbir test ulaşmaz. O config bir betiği bir paket kadar sıkı tutar: bir parametrenin ve sonradan dolan boş bir dizinin JSDoc tipi vardır, `/** @param {string} serial */` gibi.

Android'in trace'lerini okuyan Perfetto trace processor'ı `packages/driver-android/src/tools.ts` içinde sürümüyle ve sürümünün her zip için yayımladığı sha256 ile sabitlenir; uygulamanın build'i de aynı sabiti alır. Daha yeni bir sürüm, Android sürücüsünün gönderdiği her sorgu ondan aynı sütunları okuduğunda ve açılış sayıları tuttuğunda, `perf`, `measures-android` ve `frame-cause` suite'leri bir API 34 emulator'ında geçerek sabitlenir.

## Testler

`pnpm test` birim testlerini, yani her paketin `test` klasöründeki dosyaları cihaz olmadan çalıştırır; `npx vitest run <file>` tek bir dosyayı çalıştırır. Bir test dosyası 800 satırın altında kalır. Testlerin paylaştığı sahteler, yani bir cihazınki, bir ajanınki, bir saatinki ve dahası, hiçbir yayımlanan pakete girmeyen bir paket olan `packages/testing`'tedir. Bir test birini dosyasıyla alır, `@appdyno/testing/fake-device.js` gibi; testleri birini alan bir paket `@appdyno/testing`'i kendi `package.json`'unda listeler, `packages/testing`'in kendisinin bağlı olduğu bir paket hariç, çünkü pnpm o döngüyü reddeder: onlar için onu kökteki `package.json` listeler. Her test dosyası kendine ait bir durum klasöründe çalışır; onu `packages/appdyno/test/no-real-state.setup.ts` oluşturur. Testlerinin her biri boş bir klasör isteyen bir dosya `APPDYNO_STATE_DIR`'ı kendi `beforeEach`'inde stub'lar.

### Cihaz suite'leri

`device-tests` içindeki suite'ler gerçek bir emulator'da, simulator'da ya da telefonda çalışır ve onun adını siz verirsiniz. Hiçbir zaman varsayılan bir cihaz yoktur, çünkü başka cihazlar da bağlı olabilir. Ajanı, fixture uygulamalarını ve iOS runner'ını derleyin, Android fixture'larını kurun, sonra suite'leri çalıştırın:

```sh
(cd android && ./gradlew :agent:assembleDebug :fixture:assembleDebug :push-fixture:assembleDebug)
adb -s <serial> install -r -g android/fixture/build/outputs/apk/debug/fixture-debug.apk
adb -s <serial> install -r -g android/push-fixture/build/outputs/apk/debug/push-fixture-debug.apk
(cd ios && xcodebuild build-for-testing -project Appdyno.xcodeproj -scheme Runner \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath .derived)
APPDYNO_ANDROID_SERIAL=<serial> APPDYNO_IOS_UDID=<udid> pnpm test:device
```

Yalnızca elinizdeki cihazın değişkenini ayarlayın: bir emulator ya da Android telefon için `APPDYNO_ANDROID_SERIAL`, bir simulator için `APPDYNO_IOS_UDID`, bir iPhone için `APPDYNO_IPHONE_UDID`; sonuncusu [Araçlar](docs/reference/tools.tr.md#bir-telefona-ulaşmak) sayfasındaki imzalama değişkenlerini de ister. Cihazı adlandırılmamış bir suite atlanır. `pnpm test:device device-tests/smoke.test.ts` tek bir dosyayı çalıştırır. iOS derlemesi runner'ı ve her simulator suite'inin kurduğu fixture uygulamasını yapar. Bkz. `vitest.device.config.ts` ve hangi suite'in nerede çalıştığını da söyleyen [CI başvurusu](docs/reference/ci.tr.md); `scripts/ci.sh` her kontrolü yerelde çalıştırır ve sonuçları kaydeder.

Bir suite bir cihazı kullanmadan önce hub'ı, yani `appdyno hub`'ın ve Mac uygulamasının penceresini kapatın. Bir suite durumunu kendi klasöründe (`APPDYNO_STATE_DIR`), hub ise varsayılan klasörde tutar; bu yüzden hiçbiri diğerinin token'ını okuyamaz ve bir cihazda aynı anda tek bir ajan çalışır: ikinci gelen `AGENT_CONFLICT` ile durur. Açık bir hub ayrıca çalışan her emulator'ı ve simulator'ı kendiliğinden alır; bir suite'in cihazını da iki bağlantısı arasında alabilir.

### Bir görevin bir ajana maliyeti

İki betik, bir ajanın bir görevi bitirmek için ne ödediğini çağrı sayısı ve okuması gereken metin olarak ölçer. Bir yanıtı, bir ipucunu, bir aracın açıklamasını ya da sunucunun yönergelerini değiştirmeden önce ve sonra çalıştırın.

`node scripts/efficiency.mjs` cihaz istemez. Bu süreçteki bir istemci, test fixture'ları arasında kayıtlı ekranlarda sekiz görevi, sunucunun kendi sözlerini izleyen bir okuyucunun yapacağı gibi yapar: ekranı yönergelerin söylediği ya da bir yanıtın göstermediği yerde okur, bilinen işlemleri ancak yönergeler öyle diyorsa tek çağrıda gönderir, bir crash'in raporunu ya da logunu bir ipucu oraya yolluyorsa ister. Her görevin çağrılarını ve yanıtlarının karakter sayısını, metin ve yapılandırılmış içerik olarak, ayrıca kataloğun, yönergelerin ve birkaç tekil yanıtın boyutunu yazdırır; `--answers` her yanıtın tamamını ekler. Aynı görevler bir birim testidir, `packages/ops/test/efficiency`; her görevi çağrı sayısına bağlar, böylece bir göreve bir çağrı daha ödeten değişiklik `pnpm test`'i başarısız kılar.

`pnpm build && node scripts/bench.mjs <simulator id>` beş görevi gerçek bir modelle, her birini bir kez, bir MCP istemcisinin yazdırma kipindeki komut satırı üzerinden (`claude -p`, oturum açılmış) fixture kurulu bir simulator'da yapar: bir formu doldurup göndermek, sepete üç ürün koymak, simulator'ın Ayarlar uygulamasında bir ayarı bulup değiştirmek, uygulamayı çökertip nedenini log satırıyla söylemek, bir flow kaydedip yeniden oynatmak. İstemciye yalnızca bu çalışma kopyasının sunucusu verilir; her görevin geride bıraktığı, modelin sözünden alınmaz, sonradan cihaza sorulur. Her görev için yapılıp yapılmadığını, çağrıları, modele verilen yanıtların karakter sayısını, giren ve çıkan token'ları, turları ve süreyi yazdırır. `--tasks login,crash` bazılarını çalıştırır, `--model` modeli adlandırır, `--out` satırları JSON olarak, `--keep <dir>` her çalıştırmanın akışını yazar. Model kullanımı harcar, görev başına en çok `--budget` dolar (verilmezse 2); bir görevin tek çalıştırması tek bir gözlemdir: bir model aynı adımları iki kez atmaz.

## İç değişkenler

Bir kişinin ayarlayabilecekleri [CLI başvurusunda](docs/reference/cli.tr.md#sunucu-seçenekleri) ve onun yönlendirdiği sayfalardadır. Aşağıdaki değişkenler iç değişkenlerdir: appdyno'nun süreçlerinden biri onları bir başkasına verir ya da bir test ayarlar. Başka hiçbir şey onları ayarlamamalıdır ve herhangi biri değişebilir. `packages/appdyno/test/environment.test.ts`, TypeScript kaynaklarındaki her `APPDYNO_` adını belgelere ya da bu tabloya bağlı tutar.

| değişken                     | ayarlayan                                     | ne için                                                                                                     |
| ---------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `APPDYNO_HELPERS`            | Mac uygulamasının `appdyno` komutu            | uygulamanın hazır derlenmiş görüntüleyicisinin ve yardımcılarının yeri: ilk kullanımda hiçbir şey derlenmez |
| `APPDYNO_NATIVE_DIR`         | testler ve `scripts/build-app.mjs`            | görüntüleyicinin ve yardımcıların `~/Library/Caches/appdyno/native` yerine derlendiği yer                   |
| `APPDYNO_RUNNER_URL`         | testler                                       | simulator runner'ının zip'inin, sürümün sayfası yerine istendiği yer: sha256'sı yine paketinkidir           |
| `APPDYNO_HELD_BY_HUB`        | hub, çalıştırdığı bir komut için              | komut hub ile birlikte biter                                                                                |
| `APPDYNO_FORM_ALLOW_DEVICES` | masaüstü eklentisinin manifest dosyası        | kurulum formunun `--allow-devices` alanı: boş bırakılırsa liste yoktur                                      |
| `APPDYNO_FORM_ALLOW_APPS`    | masaüstü eklentisinin manifest dosyası        | aynısı, `--allow-apps` için                                                                                 |
| `APPDYNO_FORM_ALLOW_URLS`    | masaüstü eklentisinin manifest dosyası        | aynısı, `--allow-urls` için                                                                                 |
| `APPDYNO_FORM_ALLOW_WRITE`   | masaüstü eklentisinin manifest dosyası        | aynısı, `--allow-write` için: aralarında iki nokta olan klasörler, ev klasörü için `~`                      |
| `APPDYNO_FORM_TOOLSETS`      | masaüstü eklentisinin manifest dosyası        | aynısı, `--toolsets` için: aralarında virgül olan araç grupları                                             |
| `APPDYNO_PROBE_OUT`          | kare probe'unun başlatılışı, uygulama için    | uygulamadaki probe'un karelerini yazdığı dosya                                                              |
| `APPDYNO_VIEW_SOCKET`        | görünüm probe'unun başlatılışı, uygulama için | uygulamadaki probe'un yanıt verdiği soket                                                                   |
| `APPDYNO_RECORD_SEGMENT_S`   | `device-tests/evidence.test.ts`               | bir Android kaydının parçası, yoksa 180 sn; böylece uzun bir kaydın testi kısa sürer                        |

## Modüller

`packages/` altındaki her paket yalnızca kendi kuralının izin verdiği paketleri içe aktarabilir. Örneğin `core` `protocol`'ü içe aktarabilir, başka hiçbir şeyi değil; `driver-android` ve `driver-apple` de birbirini hiçbir zaman içe aktarmaz. Kurallar ve onları uygulayan test `packages/appdyno/test/boundaries.test.ts` içindedir. Bir paketin testleri de aynı kurala uyar; yalnızca o testin adıyla saydığı birkaçı dışında. Mimari gerektiriyorsa kuralı orada değiştirin, etrafından dolaşmayın.

`packages/appdyno/test/structure.test.ts`, `packages/*/src` içindeki her dosyayı ve bizim yazdığımız her `.kt`, `.swift`, `.m` ve `.h` dosyasını 450 satıra, bir paketin `test`'indeki ya da `device-tests`'teki her test dosyasını da 800 satıra bağlı tutar; testin bir gerekçeyle adını verdiği dosyalar dışında. Kaynaklarda iki kez geçen 8 satırlık bir diziyi de reddeder. İki sürücünün de yaptığı şey `core`'a aittir; iOS runner'ının cihaz olmadan verdiği kararlar `ios/RunnerCore`'a, Android ajanınınkiler ise içinde framework olmayan, birim testinin ulaştığı kendine ait bir sınıfa.

`packages/appdyno/test/function-size.test.ts` aynısını bir TypeScript fonksiyonu için 200 satırda yapar ve içindeki bir closure'ı da ayrıca sayar: bir dosyanın sınırı, bir sınıf kadar durum tutan tek bir closure'ı hiç görmez. Sınırı aşanların her biri, neyinin uzun olduğuyla birlikte adıyla anılır.

`packages/ops` bir istemcinin çağırdığıdır, `packages/hub` ise onun üstünde hub'ın ve bir pencerenin denetleyicisi. Hub'ın `ops`'tan aldığı, `ops`'un `index.ts`'inde dışarı verdiğidir ve yukarıdaki kural `ops`'un hub'ı içe aktarmasını engeller.

## Yeni bir platform

Bir platform tek bir sürücü paketidir: kendine ait bir araçla listelediği her cihaz türü için bir `DeviceProvider` (Apple'ın simulator'ları ve iPhone'ları iki türdür), bir `Device`, bir `PlatformScreen` ve bir `MeasureSource`; derleyici her birini portun tamamına bağlı tutar, ölçmenin hiçbir yolu olmayan şey için `cannot` vardır. Paketin dışında, platform `packages/protocol/src/messages.ts` içindeki `PLATFORMS`'u, ona göre anahtarlanmış `packages/core/src/device.ts` ve `packages/perf/src/dashboard/format.ts` içindeki tabloları, `packages/appdyno/src/providers.ts` içindeki sağlayıcılarını ve `boundaries.test.ts` içindeki kuralını alır. Listeyi `packages/appdyno/test/platforms.test.ts` tutar.

## Burada kullanılan sözcükler

Buradaki bazı adların kendine özgü bir anlamı vardır:

- Bir **place**, hub'ın penceresinde bir cihazın duracağı yerde duran şeydir: Yapay Zekâ İstemcileri ve Yardım. `HubServices` bunların bu Mac'ten istedikleridir.
- **Words**, `WordsTable.m` ve `wordsOf` içindeki, bir kişi için yazılmış metinlerdir; bir **need** ise bir kişiyle bir cihaz arasında duran şeydir, düzeltmesiyle birlikte.
- **said** ve **heard**, bir sürecin yazdığı ve karşı tarafın ondan aldığıdır; viewer'ın hattında ya da bir komutun çıktısında.
- Bir çalıştırmayı **keep** etmek, kayıtlarını kapı için saklamaktır; bir **source** ise bir pencerenin gösterdiğinin kaynağı ya da bir sayıyı ölçen şeydir.

## Commit'ler

Commit başına tek değişiklik. Konusu en fazla 72 karakterlik tek bir satırdır, `type(scope): what changed` biçiminde; `type`, `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci` ya da `chore`'dan biridir, kapsam ise isteğe bağlıdır, `fix(ios): ...` gibi. Nedeni ve okurun bunun ötesinde gereksindiği, boş bir satırdan sonra gövdeye girer. Bir kullanıcının fark edeceği bir değişiklik, `CHANGELOG.md` içinde Unreleased başlığının en üstüne İngilizce tek bir satır ekler; bir refactor, bir test, CI ya da iç bir belge hiçbir satır eklemez. `CHANGELOG.tr.md`'ye dokunmayın: bir sürüm çıkarılırken bakımcı Türkçe satırları yazar ve Unreleased bölümünü iki dosyada da o sürümün bölümüne taşır. `git log`'daki eski konular daha uzundur: yenilerini buna göre yazın.

## Yorumlar

Yalnızca kodun gösteremediği neden için yorum yazın. Kodun ne yaptığını yeniden söylemeyin. Fixture'lar ve testler nötr İngilizce adlar kullanır.

## Tipler ve sıkı lint

Kod typescript-eslint'in tipe dayalı kurallarını kendisi karşılar: bir kural, orada yanlış olduğu yerde yalnızca tek bir satır için, `-- why` ile kapatılır ve `eslint.config.js` ayarladığı her kural için nedenini söyler. Bir düzeltme kodun yaptığını hiçbir zaman değiştirmez. Bir seçim bırakan bir kuralı nasıl karşıladığı [lint başvurusundadır](docs/reference/lint.tr.md).

## Belgeler

[Belgeler](docs/README.tr.md), bir işi adım adım anlatan rehberleri ve bir şeye bakmak için bir başvuruyu tutar. Yeni bir sayfa bunlardan birine ve dizine girer. Belgelerdeki bir sayı, kendi ölçtüğünüz bir sayıdır: hangi cihazda ve hangi yük altında ölçtüğünüzü söyleyin.

Her belge İngilizce ve Türkçedir, `X.md` ve `X.tr.md`, ve birindeki bir değişiklik ikisinde de yapılır: `docs.test.ts` ikisini, her biri kendi dilinde, aynı satırlara, koda, sayılara ve bağlantılara bağlı tutar. Değişiklik günlüğü yayımlanmış her bölümünde böyledir, Unreleased bölümü ise [Commit'ler](#commitler) bölümünün dediği gibi yalnızca İngilizcedir.

Türkçede sayfalar ve Mac uygulamasının sözcükleri şu terimleri İngilizce tutar: cold launch, warm launch, crash, flow, simulator, emulator, runner, deep link, push, setup, teardown ve host; `Flow'u Kayda Al`, `Flow'lar` ve `Crash'ler` gibi. Yaygın sözcükler Türkçedir: rapor, ajan, dokunuş, kaydırma. `docs.test.ts` ile `words.test.ts`, bu terimlerin yerini aldığı Türkçe sözcükleri reddeder.

Diyagramlar `docs/images` içinde elle yazılmış SVG'lerdir, üreteç yoktur. Her birinin kendi zemini vardır, böylece her sayfada okunur, ve iki dosya olarak gelir: açık `X.svg` ve koyu `X.dark.svg`; bir sayfa onları, `<source media="(prefers-color-scheme: dark)">`'u GitHub'ın temasına göre seçen bir `<picture>` içinde gösterir: bir SVG'nin içindeki media query GitHub'ın temasını değil, sistemin temasını izler. Türkçe bir sayfa `X.tr.svg` ve `X.tr.dark.svg` gösterir. Bir tane çizmek için başka birinin stil bloğunu kopyalayın ve onun biçimlerine bağlı kalın: mavi sizin Mac'iniz, turkuaz ya da mor cihaz, pembe soran kimse. Ona iki temada da bakın.

`packages/appdyno/test/docs.test.ts` diyagramları koda, belgelerdeki her bağlantıyı da gerçek bir hedefe bağlı tutar.

## Sürümler

[CI başvurusunun](docs/reference/ci.tr.md#sürüm) anlattığı gibi bir tag yayımlar ve npm yayımlamayı workflow'dan token olmadan kabul eder. Bu, npmjs.com'da paketi elinde tutan kişinin bir kez yaptığı tek bir ayara dayanır: `appdyno` paketinin Settings sayfasında, Trusted Publisher altında GitHub Actions seçilir ve kullanıcı olarak `fatihcimen`, depo olarak `appdyno`, workflow dosyası olarak `release.yml` verilir, environment boş bırakılır. npm bunların hiçbirini kaydederken denetlemez, bu yüzden yanlış bir harf ancak bir sonraki yayımlamada görünür. Sürümler 1.3.0'dan beri bu yolla çıkar ve depo hiçbir npm token'ı tutmaz. Paketin yayımlama erişimi ayrıca iki adımlı doğrulama isteyecek ve token'ları reddedecek şekilde ayarlanabilir.

## Site

[appdyno.dev](https://appdyno.dev), Astro ve Starlight kullanan bir workspace paketi olan `site/` içinden derlenir. Belgeleri `docs/` içindeki dosyalardır ve her derlemede oldukları gibi okunur: `X.md` `/docs/X/` adresindeki, `X.tr.md` ise `/tr/docs/X/` adresindeki sayfadır; yani bir belgedeki değişiklik `site/` içinde hiçbir şey gerektirmez. Açılış sayfası `site/src/components/landing` içindedir ve her sözcüğü, anahtarı anahtarına, `site/src/i18n/en.ts` ile `site/src/i18n/tr.ts` içindedir. Sayfada dolaşan ejderha `site/src/components/mascot` içindedir: sayfa, modelinin kemiklerini ve kliplerini `names.ts` içindeki adlarla bulur; `models` bu adları dosyada korur, `check` de commit edilmiş dosyayı bu adlara bağlı tutar.

```sh
pnpm --filter @appdyno/site dev          # site localhost'ta; kaydedilen bir belge ya da bileşen yeniden gösterilir
pnpm --filter @appdyno/site check        # tipleri ve kendi testleri
pnpm --filter @appdyno/site build        # bütün site, site/dist içine
pnpm --filter @appdyno/site check:dist   # derlemedeki her bağlantı, görsel ve çapa, bir de her sayfanın head'i
pnpm --filter @appdyno/site models DIR   # DIR içindeki dyno.glb'yi site/public/models içine sıkıştırır
```

`pnpm run ci` sitenin derlemesini dışarıda bırakır. `.github/workflows/site.yml` bunları `site/` ya da `docs/` içine dokunan bir pull request'te çalıştırır ve `main`'e bir push'ta GitHub Pages'e yayımlar. Modelin yalnızca sıkıştırılmış hali commit edilir.
