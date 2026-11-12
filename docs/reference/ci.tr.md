# CI ve sürümler

[English](ci.md)

`scripts/ci.sh` her denetimi sırayla çalıştırır ve ilk hatada durmaz: her adımın çıkış kodu ve süresi
`.ci/runs/<stamp>.json` dosyasına, çıktısı `.ci/logs/` altına gider. Betik herhangi bir adım başarısız olduğunda 1 ile, hiçbiri başarısız olmayıp
ölçüm yapan bir adım ertelendiğinde 3 ile çıkar, çünkü hiç çalışmamış bir adım başarılı sayılmaz. `mise` ve zsh ister: her adım `mise exec` altında çalışır.

| adım                                                | ne                                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| install, format, lint, lint-native, typecheck, unit | `pnpm install --frozen-lockfile`, prettier, eslint, native linter'lar (`scripts/lint-native.sh`), tsc, vitest (`--maxWorkers=2`) |
| agent                                               | Gradle: ajanın birim testleri, ajan, fixture uygulaması ve push fixture'ı                                                        |
| build                                               | `pnpm build` (ajan derlendiyse onu da paketler)                                                                                  |
| fixture-install, device-functional                  | `--device <serial>` ile: fixture uygulaması, sonra contract, smoke ve stdio suite'leri                                           |
| device-perf                                         | ölçüm doğruluğu suite'i (ölçüm yapan bir adım)                                                                                   |
| latency, regression-gate                            | `--nightly` ile: gecikme suite'i (`appdyno bench`, n = 30) ve kapı                                                               |
| runner-core                                         | iOS runner'ının Swift çekirdeği (`swift test`), Xcode'un olduğu yerde                                                            |
| ios-build, ios-functional, ios-perf                 | `--ios <simulator id>` ile: runner, contract ve stdio suite'leri, perf doğruluğu                                                 |
| iphone-build, iphone-functional                     | `--iphone <UDID>` ile: telefonlar için runner, iPhone suite'leri (imzalama değişkenleri)                                         |
| her dosya için bir adım                             | `--all-on <serial>` ile: o cihazın alabildiği her suite                                                                          |

**Hangi suite nerede çalışır.** Hiçbir cihaz suite'i kendiliğinden çalışmaz: her biri bir değişkene bağlıdır ve bir çalıştırmanın alması gereken her birinin adı verilmelidir.

| nerede                                                                     | ne çalışır                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`, `main`'e bir push'ta ya da bir pull request'te | lint, tipler, birim testleri, ajanın birim testleri ve build'i, runner'ın çekirdeği. **Hiç cihaz suite'i yok**, bu yüzden bir cihaz suite'inin kendi bozulması yalnızca aşağıdakilerde görülür |
| `scripts/ci.sh`, seçeneksiz                                                | aynısı, bu Mac'te                                                                                                                                                                              |
| `--device <serial>`                                                        | `android`, `smoke`, `mcp-stdio`, sonra `perf`                                                                                                                                                  |
| `--ios <simulator id>`                                                     | `ios`, `mcp-stdio`, sonra `ios-perf`                                                                                                                                                           |
| `--iphone <UDID>`                                                          | `iphone`, `iphone-mcp`. `APPDYNO_IPHONE_FIXTURE_APP` ister ve o olmadan başlamayı reddeder: fixture olmadan ölçümleri atlanır ve adım ok okunurdu                                              |
| `--all-on <serial>`                                                        | o cihazın değişkenini okuyan her dosya, her biri bir adım, böylece kimsenin onları hatırlaması gerekmez: Android'de 47, bir simülatörde 38, bir iPhone'da 29                                   |
| yalnızca adı verildiğinde, her biri kendi kapısıyla                        | `hub.clients`, `hub.connect`, `hub.connect.sim`, `hub.driving`, `hub.room`, `hub.shared`, `mirror.pair`, `trace-temp`: değişkenleri her dosyanın başındadır                                    |

`--all-on` cihazın türünü kendisine verilen kimlikten alır ve ondan başka hiçbir şey istemez. Sahibi olduğunuz bir cihaza ulaşabilenleri çalıştırır, bu yüzden ona başka bir cihaz vermeyin: suite'leri fixture'ı kurar, çökertir ve sıfırlar, bazıları da ayarları değiştirip geri koyar.

Her testi atlayan bir vitest çalıştırması 0 ile çıkar, bu yüzden bir adım çalıştırmanın bildirdiğini okur. `--device`, `--ios` ya da `--iphone` ile adı verilen ve hiçbir şey çalıştırmayan bir suite başarısızlıktır, adımında 3 çıkış koduyla. `--all-on` altında böyle bir dosya `none` okur ve hiçbir şeyi başarısız kılmaz, çünkü bir tarama kendine ait ayrı bir kapısı olan dosyaları da alır ve log neyin atlandığını adıyla söyler; çalışıp başarısız olan bir dosya ise çalıştırmayı yine başarısız kılar.

**Mirror.** `device-tests/mirror.simulator.test.ts` ve `mirror.android.test.ts`, aynı değişkenlerle,
headless çalışır. `APPDYNO_MIRROR_WINDOW=1` tek gerçek pencereyi ekler, pencere hemen ardından kapanır. `APPDYNO_MIRROR_RESTART=1` adı verilen simülatörü penceresinin altında kapatıp yeniden başlatır, `APPDYNO_MIRROR_RESTART_AVD=<avd>` da adı verilen emülatörü yayınının altında öldürür ve o AVD'yi `simulator`'ün yoluyla başlatır: her biri, sahibi olduğunuz bir cihazın baştan bir açılışına mal olur. Şunlar için bir kişi gerekir
ve hiçbir suite bunları yapmaz: bir yayın sırasında telefonun kablosunu çıkarmak; parolalı bir telefonun kilidini açmak; PIN ile kilitli bir Android telefon, burada `DEVICE_LOCKED` yalnızca bir emülatörde kanıtlandı, çünkü hiçbir suite bir kişinin telefonuna PIN koymaz; Mac'i uyutup uyandırmak;
ses çıkaran ve bir bildirim gönderen, penceresiz bir `hand_off`; bir pencerede, sesiyle bir `hand_off`; bir
iPhone'da, yayın sırasında kamera ya da bir arama, bir yayını tutan Device Hub ve parolayla kilitli bir telefon; bir kişinin
tıkladığı bir pencereye yazmak, çünkü bir testin penceresi klavyeyi hiç tutmaz.

`device-tests/mirror.iphone.test.ts` (`APPDYNO_IPHONE_UDID`) derlenmiş olandan çalışır, çünkü yayının thread'i
kaynaklardan başlayamaz: önce `pnpm build`. Her dokunuştan önce ekranı okur.

**Gerileme kapısı** (`scripts/ci-gate.mjs`): her işlemin p50'si, `.ci/history.jsonl` içindeki son beş
başarılı çalıştırmanın medyan p50'sine karşı; %20 ve 10 ms'den fazla yavaşlama ya da başarısız herhangi bir işlem
çalıştırmayı başarısız kılar. Her çalıştırma geçmişe commit'i, ortamı (host ve cihaz yükü,
GPU modu) ve sayılarıyla eklenir; başarısız bir çalıştırma saklanır ama asla baseline olmaz.

**Paylaşılan bir makinede**: ölçüm yapan adımlar (device-perf, latency) `APPDYNO_BUSY_FILE` var olduğu sürece atlanır
ve çalışırken `APPDYNO_LOCK_FILE` yazar. Bir cihaz hiçbir zaman varsayılan olarak seçilmez: onu `--device` belirtir.

```sh
scripts/ci.sh                                      # cihaz yok
scripts/ci.sh --device emulator-5580               # + cihaz suite'leri
scripts/ci.sh --device emulator-5580 --nightly     # + gecikme geçmişi ve kapı
scripts/ci.sh --ios <simulator id>                 # + iOS simülatörü
scripts/ci.sh --iphone <UDID>                      # + iPhone (APPDYNO_IOS_PROFILE, _KEYCHAIN, _KEYCHAIN_PASSWORD, APPDYNO_IPHONE_FIXTURE_APP)
scripts/ci.sh --all-on <serial>                    # + o cihazın alabildiği her suite
```

## Sürüm

Bir tag yayımlar, başka hiçbir şey yayımlamaz. `.github/workflows/release.yml`, `v1.2.3` üzerinde çalışır: kapı olarak `ci.yml`, sonra tag'in `packages/appdyno/package.json` içindeki sürüm olduğunun denetimi, derlenen ajan ve paket, Mac uygulaması, `npm publish --provenance --access public` ve disk imajı, cask ve appcast ile bir GitHub sürümü. Sürüm notları geri alınamayan her şeyden önce yazılır; sonraki bir adım başarısız olduktan sonra yeniden çalıştırılan bir çalışma sürümü npm'de bulur ve GitHub sürümüne geçer. Actions sekmesinden elle çalıştırılan `release.yml` bir provadır: kapı ve imzalanıp noter onayından geçmiş Mac uygulaması, açıp bakmak için çalışmayla birlikte 3 gün tutulur ve hiçbir şey yayımlanmaz.

Bir sürüm şunlara dayanır:

- Depo herkese açıktır. npm, paket herkese açık olsa bile özel bir depodan provenance üretmez ve `appdyno update` provenance'ı olmayan bir sürümü reddeder.
- `packages/appdyno/package.json` içindeki `repository` onunla, büyük-küçük harf dahil, eşleşir. npm bunu yayımlarken denetler, `update` de her sürümü o adrese bağlı tutar, bu yüzden başka yerde derlenmiş bir sürüm reddedilir.
- npm yayımlamayı, npmjs.com'da ayarlanan güvenilir yayımcı olarak `release.yml`'den ya da bir `NPM_TOKEN` secret'ıyla kabul eder. Bir paketin ilk yayımlaması bu secret'ı ister, çünkü bir paketin güvenilir bir yayımcısı olabilmesi için önce var olması gerekir; yayımcı ayarlandığında secret kaldırılabilir. Yayımlama job'ının Node 26'sında güvenilir yayımcı olarak yayımlayabilen bir npm vardır.

Bir tag'den önce, klasöründe pnpm olmayan bir node'dan, `node scripts/check-package.mjs` tarball'ı boş bir ev klasörüne kurar. Workflow'un dışında kalır, çünkü yolunda bir JDK olan yerde çalışmayı reddeder.

`scripts/check-update.mjs`, `update`'i ve doğrulamasını gerçekten, geçici bir klasörde, herkese açık paketlerle, bu makinede hiçbir şeyi değiştirmeden çalıştırır: provenance'ı olan bir sürüm, olmayan bir sürüm, yalnızca bağımlılığında olan bir sürüm, kurcalanmış bir registry ve npm ile pnpm altında başarısız bir kurulum. Ağ ve npm 11.12 ya da üstü gerektirir.

### Mac uygulaması

`scripts/build-app.mjs`, `.app-build` içinde `Appdyno.app`'i, disk imajını ve bir cask'i yapar ve her parçanın ne kadar tuttuğunu yazdırır. Secret olmadan ad hoc imzalar. Şunlar, deponun aynı adlı secret'ları olarak, gerisini açar:

| secret                                                                      | ne yapar                                                                                            |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `APPDYNO_CERTIFICATE`, `APPDYNO_CERTIFICATE_PASSWORD`                       | sürümün anahtar zinciri için bir Developer ID Application sertifikası, base64 bir `.p12`            |
| `APPDYNO_SIGN_IDENTITY`                                                     | o kimliğin adı, `build-app.mjs`'in aldığı tek kimlik: hardened runtime ile imzalar                  |
| `APPDYNO_NOTARY_APPLE_ID`, `APPDYNO_NOTARY_PASSWORD`, `APPDYNO_NOTARY_TEAM` | uygulamayı ve disk imajını noter onayından geçirir ve staple eder, böylece çift tıklama onları açar |
| `APPDYNO_UPDATE_KEY`                                                        | bir Ed25519 özel anahtarı, PEM: appcast'i imzalar, açık yarısı uygulamaya girer                     |

`release.yml` onu `--release` ile çalıştırır; bu, imzalanmamış ve noter onayından geçmemiş bir build'i reddeder: bir sürümdeki disk imajı çift tıklamayla açılır. Bir Mac'ten noter onayı almak için `xcrun notarytool store-credentials` parolayı anahtar zincirinde ve süreç listesinin dışında tutar, `APPDYNO_NOTARY_PROFILE` da onun sakladığı profilin adını verir.

**Disk imajının penceresi.** Disk imajına çift tıklamak kendine ait bir pencere açar: `scripts/icon-art.mjs`'in çizdiği arka planı, uygulama ve Applications onun koyduğu yerlerde, ve birimin üzerinde uygulamanın simgesi. Bunu, imajın `.DS_Store`'unda, Finder ve AppleScript olmadan dmgbuild yazar; böylece başında kimsenin olmadığı bir runner da aynısını derler. `uvx` onu kendi wheel'inden ve ihtiyaç duyduğu iki paketinkilerden, her biri PyPI'nin yayımladığı özete bağlı olarak çalıştırır, `build-app.mjs` de imajı imzalamadan önce içinde ne olduğunu denetler. uv `.mise.toml`'dadır, `release.yml` de aynı sürümü, özetine bağlı olarak, `setup-uv` ile alır.

**Hardened runtime.** Her binary onunla imzalanır ve yalnızca biri bir entitlement taşır: Node'da `com.apple.security.cs.allow-jit` vardır, çünkü V8 çalıştırdığı kodu kendisi yazar. Başka hiçbir şeyin buna ihtiyacı yoktur. Developer ID ile imzalanmış ve noter onayından geçmemiş bir build macOS 27'de, bir simülatörde çalıştırıldı: Node'un JIT'i, WebAssembly ve bir worker; CoreSimulator'ı dosya yolundan yükleyen görüntüleyici (Apple imzaladığı için kütüphane doğrulaması buna izin verir); `TextScan`; yardımcılarıyla birlikte Ayarlar'ı MCP üzerinden yöneten sunucu; ve alt süreç olarak `adb`. Başka birinin imzaladığı bir kütüphaneyi yüklemek `disable-library-validation` gerektirirdi.

`openssl genpkey -algorithm ed25519` bir güncelleme anahtarı yapar. Onu saklayın: bir uygulama yalnızca derlendiği anahtarla imzalanmış sürümleri doğrulayabilir, bu yüzden anahtarı kaybetmek insanların uygulamayı elle yeniden kurması demektir. Bir kimlik yalnızca bu değişkenlerden alınır, asla makinede aranıp bulunmaz.

`scripts/check-app.mjs` uygulamayla bir yabancının karşılaştığı gibi karşılaşır: temiz bir ev klasörü ve Node'u ya da geliştirici araçları olmayan bir PATH; burada olası her aracın yerinde, kendisine ulaşılıp ulaşılmadığını bildiren sahte bir kopya durur. adb'yi indirir, hub'ı açar, gerçek bir disk imajından günceller, kurcalanmış olanı reddeder ve uygulamayı taşır. `--android <serial>` o cihazda, kareleri kaydedilen bir pencere ekler, `--iphone <udid>` de aynısını bir iPhone'da yapar. `--keep`, oluşturduğu geçici klasörü, içindeki temiz ev klasörünü ve oraya kurduklarını bırakır ve yerini yazdırır. Ağ gerektirir ve pencereler geride kalır.
