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

| nerede                                                                     | ne çalışır                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`, `main`'e bir push'ta ya da bir pull request'te | lint, tipler, birim testleri, ajanın birim testleri ve build'i, runner'ın çekirdeği ve simülatör smoke'u: `ios`, `keys`, `views.simulator`, `flows-ci`. **Hiç Android suite'i yok**, bir simülatörün başka suite'i de yok, bu yüzden onların bozulması yalnızca aşağıdakilerde görülür |
| `scripts/ci.sh`, seçeneksiz                                                | aynısı, bu Mac'te                                                                                                                                                                                                                                                                      |
| `--device <serial>`                                                        | `android`, `smoke`, `mcp-stdio`, sonra `perf`                                                                                                                                                                                                                                          |
| `--ios <simulator id>`                                                     | `ios`, `mcp-stdio`, sonra `ios-perf`                                                                                                                                                                                                                                                   |
| `--iphone <UDID>`                                                          | `iphone`, `iphone-mcp`. `APPDYNO_IPHONE_FIXTURE_APP` ister ve o olmadan başlamayı reddeder: fixture olmadan ölçümleri atlanır ve adım ok okunurdu                                                                                                                                      |
| `--all-on <serial>`                                                        | o cihazın değişkenini okuyan her dosya, her biri bir adım, böylece kimsenin onları hatırlaması gerekmez: Android'de 50, bir simülatörde 42, bir iPhone'da 29                                                                                                                           |
| yalnızca adı verildiğinde, her biri kendi kapısıyla                        | `hub.clients`, `hub.connect`, `hub.connect.sim`, `hub.driving`, `hub.room`, `hub.shared`, `mirror.pair`, `trace-temp`, `soak`: değişkenleri her dosyanın başındadır                                                                                                                    |

`--all-on` cihazın türünü kendisine verilen kimlikten alır ve ondan başka hiçbir şey istemez. Sahibi olduğunuz bir cihaza ulaşabilenleri çalıştırır, bu yüzden ona başka bir cihaz vermeyin: suite'leri fixture'ı kurar, çökertir ve sıfırlar, bazıları da ayarları değiştirip geri koyar.

Her testi atlayan bir vitest çalıştırması 0 ile çıkar, bu yüzden bir adım çalıştırmanın bildirdiğini okur. `--device`, `--ios` ya da `--iphone` ile adı verilen ve hiçbir şey çalıştırmayan bir suite başarısızlıktır, adımında 3 çıkış koduyla. `--all-on` altında böyle bir dosya `none` okur ve hiçbir şeyi başarısız kılmaz, çünkü bir tarama kendine ait ayrı bir kapısı olan dosyaları da alır ve log neyin atlandığını adıyla söyler; çalışıp başarısız olan bir dosya ise çalıştırmayı yine başarısız kılar.

**Simülatör smoke'u.** `ci.yml`'in `sim-smoke` job'ı `node scripts/sim-smoke.mjs` komutunu GitHub'ın barındırdığı macOS runner'ında, imajının seçtiği Xcode ile çalıştırır: bir pull request'te, `main`'e ya da bir `ci-trial/**` dalına yapılan push'ta, Actions sekmesinden elle ve bir sürümün kapısında. Script kendi simülatörünü oluşturur, o Xcode'un SDK'sının iOS runtime'ında adı yalın olan en yeni iPhone'u, penceresiz başlatır, runner'ı ve fixture'ı derler, suite'leri çalıştırır ve ne olursa olsun simülatörü siler: okuyan, dokunan, yazan ve durmadan hareket eden bir ekranda yerleşen `ios.test.ts`, `keys.test.ts`, `views.simulator.test.ts` ve derlenmiş komut satırıyla flow'ları yeniden oynatan `flows-ci.test.ts`. Hiçbir şey çalıştırmayan bir suite onu çıkış kodu 3 ile başarısız kılar. Hiçbir şey ölçmez, çünkü barındırılan bir runner'ın süreleri bir Mac'inkiler hakkında bir şey söylemez. Geriye çalışmanın 30 gün tutulan `sim-smoke` artifact'i kalır: vitest'in yazdığı haliyle `report.json` ve cihazı, işletim sistemini, Xcode'u ve tarihi [test edilen sürümlerin](tools-tested.tr.md#test-edilen-sürümler) sütunlarıyla, her suite'in sayılarını ve saniyelerini de veren `device-summary.md`. Job yalnızca okuyan bir token ister, hiçbir şey yayımlamaz ve önbellek tutmaz; bir `ci-trial/**` dalında başka hiçbir job çalışmaz. Bir Mac'te aynı komut onu `pnpm build`'den sonra çalıştırır.

**Android bunun içinde değildir.** GitHub'ın barındırdığı macOS runner'ları iç içe sanallaştırması olmayan Apple silicon sanal makineleridir, bu yüzden bir Android emülatörü onlarda başlayamaz. Android suite'leri bir Mac'te, `scripts/ci.sh --device` ve `--all-on` ile çalışır.

**Mirror.** `device-tests/mirror.simulator.test.ts` ve `mirror.android.test.ts`, aynı değişkenlerle,
headless çalışır. `APPDYNO_MIRROR_WINDOW=1` tek gerçek pencereyi ekler, pencere hemen ardından kapanır. `APPDYNO_MIRROR_RESTART=1` adı verilen simülatörü penceresinin altında kapatıp yeniden başlatır, `APPDYNO_MIRROR_RESTART_AVD=<avd>` da adı verilen emülatörü yayınının altında öldürür ve o AVD'yi `simulator`'ün yoluyla başlatır: her biri, sahibi olduğunuz bir cihazın baştan bir açılışına mal olur. Şunlar için bir kişi gerekir
ve hiçbir suite bunları yapmaz: bir yayın sırasında telefonun kablosunu çıkarmak; parolalı bir telefonun kilidini açmak; PIN ile kilitli bir Android telefon, burada `DEVICE_LOCKED` yalnızca bir emülatörde kanıtlandı, çünkü hiçbir suite bir kişinin telefonuna PIN koymaz; Mac'i uyutup uyandırmak;
ses çıkaran ve bir bildirim gönderen, penceresiz bir `hand_off`; bir pencerede, sesiyle bir `hand_off`; bir
iPhone'da, yayın sırasında kamera ya da bir arama, bir yayını tutan Device Hub ve parolayla kilitli bir telefon; bir kişinin
tıkladığı bir pencereye yazmak, çünkü bir testin penceresi klavyeyi hiç tutmaz.

`device-tests/mirror.iphone.test.ts` (`APPDYNO_IPHONE_UDID`) derlenmiş olandan çalışır, çünkü yayının thread'i
kaynaklardan başlayamaz: önce `pnpm build`. Her dokunuştan önce ekranı okur.

**Soak.** `device-tests/soak.test.ts`, kütüphane üzerinden, bir programın sürdüğü gibi, tek bir cihazda yarım saat boyunca tek bir oturum tutar. Her döngü fixture'ın ekranlarını tohumunun karıştırdığı bir sırayla alır: ekran ve ham ağacı, doldurulup gönderilen bir form, bir listenin dokunuşları ve `scroll_to`, yanıtlanan bir diyalog, yataya dönüş ve geri, web görünümünün okunması ve içinde bir betiğin çalıştırılması, iOS'ta kayan bir afişin altındaki kopyalar, dokunuşun ya da bir sonraki okumanın bildirmesi ve `launch_app`'in geri alması gereken bir çökme, ve cihazın ajanının, appdyno'nun durum dosyasının tuttuğu pid ile oturumun altında sonlandırılması: iOS runner'ının xcodebuild'i ya da bir Android cihazdaki ajan. Başka hiçbir sürece ve başka hiçbir cihaza dokunmaz. Her çağrının aracı, kodu ve süresi saklanır ve her toparlanma sayılır: başlatılan ajanlar, bir diğerinin yerini alan her biri, bir çökmeden ve bir başarısızlıktan sonraki açılışlar. Android'de dokunuşun bildirdiği bir çökmeyi sistem geri alır, uygulamayı göreviyle yeniden başlatır; böylece bir sonraki okuma ve `launch_app` onu önde bulur. 2026-11-15'te her birinde 30 dakika, tohum 20261115 ile çalıştı: iOS 26.5'te bir iPhone 17 simülatörü, hiçbiri başarısız olmayan 1312 çağrı, sonlandırılan 41 runner ve 41 çökmenin her biri toparlandı; Android 15'te bir Pixel 8 emülatörü, hiçbiri başarısız olmayan 2900 çağrı, sonlandırılan 100 ajan ve 100 çökmenin her biri toparlandı.

`APPDYNO_SOAK_DEVICE`, üzerinde fixture olan bir simülatörü, bir emülatörü ya da bir Android telefonu adlandırır; fixture, cihaz suite'lerinin derlediği gibi derlenmiş olmalıdır: `CODE_SIGNING_ALLOWED=NO` ile yapılmış bir iOS build'inin web görünümü başka bir adla listelenir ve `webview` orada hiçbirini bulmaz. `APPDYNO_SOAK_MINUTES` süreyi ayarlar (30), `APPDYNO_SOAK_SEED` bir sırayı yeniden oynatır, `APPDYNO_SOAK_OUT` raporun yazıldığı yerdir (yoksa geçici bir klasör), `APPDYNO_SOAK_MIN_RATE` da başarılı olması gereken çağrıların payıdır (99).

```sh
APPDYNO_SOAK_DEVICE=<id> APPDYNO_SOAK_MINUTES=60 pnpm test:device device-tests/soak.test.ts
```

`soak.json` her çağrıyı tutar, `soak.md` de önce okunacak olanı: başarı oranı, her aracın p50 ve p95'i, bilerek konulan her hata ve bildirilip bildirilmediği, toparlanmalar, aracının medyanının 3 katından yavaş her çağrı, başarısızlıklar ve host sürecinin başta ve sondaki belleği. Isınma ve bilerek konulan hatalar orana ve sürelere girmez. O oranın altında ya da gerektiği gibi bildirilmeyen bir hatada başarısız olur.

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

Bir tag yayımlar, başka hiçbir şey yayımlamaz. `.github/workflows/release.yml`, `v1.2.3` üzerinde çalışır: kapı olarak `ci.yml` ve içindeki simülatör smoke'u, böylece commit'i orada bir cihaz suite'inde başarısız olan bir tag hiçbir şey yayımlamaz; sonra tag'in `packages/appdyno/package.json` içindeki sürüm olduğunun denetimi, derlenen ajan ve paket, derlenip çalıştırılan masaüstü eklentisi, Mac uygulaması, kapıdan alınan smoke'un `device-summary.md` dosyası, `SHA256SUMS`, disk imajı ve masaüstü eklentisi için bir derleme provenance'ı, `npm publish --provenance --access public` ve disk imajı, masaüstü eklentisi, cask, appcast, `device-summary.md` ve `SHA256SUMS` ile bir GitHub sürümü. Sürüm notları geri alınamayan her şeyden önce yazılır; sonraki bir adım başarısız olduktan sonra yeniden çalıştırılan bir çalışma sürümü npm'de bulur ve GitHub sürümüne geçer. Actions sekmesinden elle çalıştırılan `release.yml` bir provadır: kapı, imzalanıp noter onayından geçmiş Mac uygulaması ve masaüstü eklentisi, açıp bakmak için çalışmayla birlikte 3 gün tutulur; hiçbir şey yayımlanmaz ve hiçbir şey için provenance kaydedilmez.

Bir sürüm şunlara dayanır:

- Depo herkese açıktır. npm, paket herkese açık olsa bile özel bir depodan provenance üretmez ve `appdyno update` provenance'ı olmayan bir sürümü reddeder.
- `packages/appdyno/package.json` içindeki `repository` onunla, büyük-küçük harf dahil, eşleşir. npm bunu yayımlarken denetler, `update` de her sürümü o adrese bağlı tutar, bu yüzden başka yerde derlenmiş bir sürüm reddedilir.
- npm yayımlamayı paketin güvenilir yayımcısı olarak `release.yml`'den kabul eder, başka hiçbir yoldan değil: workflow'da token yoktur. Yayımcının npmjs.com'da nasıl ayarlandığını [Katkıda bulunmak](../../CONTRIBUTING.tr.md#sürümler) anlatır. npm 11.5.1 ya da daha yenisi gerekir; yayımlama job'ı bunu Node 26'sının npm'inde denetler.

`SHA256SUMS` bir sürümün diğer her dosyasını SHA-256'sıyla adlandırır, GitHub da disk imajı ve masaüstü eklentisi için, her birini derleyen workflow çalışmasını söyleyen bir derleme provenance'ı tutar. Bir sürümün dosyaları, hangilerini aldıysanız, tek bir klasördeyken:

```sh
shasum -a 256 --ignore-missing -c SHA256SUMS
gh attestation verify appdyno-<version>.mcpb --repo fatihcimen/appdyno
```

Bir tag'den önce, klasöründe pnpm olmayan bir node'dan, `node scripts/check-package.mjs` tarball'ı boş bir ev klasörüne kurar. Workflow'un dışında kalır, çünkü yolunda bir JDK olan yerde çalışmayı reddeder.

`node scripts/build-mcpb.mjs` masaüstü eklentisini, `.app-build/appdyno-<version>.mcpb` dosyasını üretir: `npm pack`'in ürettiği paket, paketlenen sunucunun listelediği araçlarla `packages/appdyno/mcpb/manifest.json` ve 512 px boyutunda Mac uygulamasının simgesi, manifest dosyasını doğrulayan `mcpb pack` ile paketlenir. `node scripts/check-mcpb.mjs` onu açar ve sunucusunu manifest dosyasının kendi komutuyla, boş bir ev klasöründe, kurulum formu boşken ve doluyken stdio üzerinden çalıştırır; `tools/list` yanıtını manifest dosyasındaki araçlara bağlı tutar. Dosya imzalı değildir: nerede derlendiğini derleme provenance'ı söyler.

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
