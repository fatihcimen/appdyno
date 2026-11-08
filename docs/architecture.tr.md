# Mimari

[English](architecture.md)

Bu sayfa appdyno'yu değiştirmek üzere olan kişi içindir. Parçaların nasıl birleştiğini ve neden bu biçimde olduklarını anlatır. Okuduktan sonra ihtiyacınız olan klasörü kolayca bulabilmelisiniz.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/overview.tr.dark.svg">
  <img src="images/overview.tr.svg" alt="Bir yapay zekâ ajanı, bir kişi ya da bir betik sorar; Mac'inizdeki appdyno yönetir, gösterir, ölçer ve saklar; simülatörlere, emülatörlere ve telefonlara ulaşır">
</picture>

appdyno Mac'inizde çalışır, başka hiçbir yerde değil. Servis yok, daemon yok, telemetri yok. Her komut, MCP sunucusu ya da pencere kendi başına bir süreçtir; süreçler bir cihazı, onu kimin tuttuğunu söyleyen küçük bir dosya aracılığıyla paylaşır.

## Paketler

TypeScript'teki her şey `packages/` altındadır. Bir paket yalnızca buradaki haritada kendi altında kalanları içe aktarabilir.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/package-map.tr.dark.svg">
  <img src="images/package-map.tr.svg" alt="Paket haritası: en üstte appdyno; ops'un üstünde mcp, cli ve hub; flows ve perf'in üstünde ops; en altta core ve protocol; iki sürücünün adını yalnızca en üstteki paket anar">
</picture>

| paket            | içindekiler                                                                             |
| ---------------- | --------------------------------------------------------------------------------------- |
| `protocol`       | Host ile bir cihaz arasındaki her mesaj, bir şema olarak. Hiçbir şeye bağımlı değildir. |
| `core`           | `Device` portu, bir ekranı okumak, yansıtma oturumu, durum dosyaları.                   |
| `driver-android` | adb, Android ajanı, Android'in ölçümleri.                                               |
| `driver-apple`   | Simülatörler ve iPhone'lar, runner, yardımcılar, Apple'ın ölçümleri.                    |
| `flows`          | `.flow` biçimi: ayrıştırma, kaydetme, yeniden oynatma, dışa aktarma.                    |
| `perf`           | Bir ölçümün kayıtları, kapı, dashboard. Cihaz yok.                                      |
| `ops`            | Araçlar. Her biri bir `Op`: bir ad, bir şema, bir handler.                              |
| `mcp`            | MCP sunucusu, stdio ya da Streamable HTTP üzerinden.                                    |
| `cli`            | Komut satırını ayrıştırma, `install`, `update`.                                         |
| `hub`            | Pencereleri yönetir: hub'ın listesi, kayıt, ölçümler, bir kişinin girdisi.              |
| `appdyno`        | Yayımlanan tek paket. Diğerlerini birbirine bağlar ve giriş noktalarını tutar.          |

Bunu üç karar biçimlendirir.

**Bir araç bir kez yazılır.** `packages/ops` içindeki bir `Op`, bir MCP istemcisi için bir araç, komut satırında bir komut, bir akışta bir adım ve kütüphanede bir çağrıdır. Böylece bir düzeltme dördüne birden ulaşır ve hiçbiri diğerlerinden ayrı düşemez.

**Bir sürücünün adını yalnızca en üstteki paket anar.** `ops`, `core` içindeki `Device` portuna karşı çalışır. Ona Android ve Apple sürücülerini veren tek yer `appdyno/src/providers.ts`'dir. Bu, iki platformun birbirine yaslanmasını önler; yeni bir platformun tek bir paket olmasının nedeni de budur. Başka nelere dokunduğunu [CONTRIBUTING](../CONTRIBUTING.md#a-new-platform) listeler.

**Tek bir paket yayımlanır.** `packages/appdyno/scripts/bundle.mjs`, çalışma alanını ve her bağımlılığı `dist` içine gömer; böylece bir kurulum başka bir paket gerektirmez. Diğerleri `private`'tır. Paketler arasında adla içe aktarırsınız; aşağıdaki kurallar bu içe aktarmaları haritaya bağlı tutar.

## Bir araç çağrısı

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/tool-call.tr.dark.svg">
  <img src="images/tool-call.tr.svg" alt="Bir araç çağrısı: istemci tap çağırır; mcp onu ops'taki araca iletir; araç ekranı okur, sonra sürücü üzerinden ajana tek bir act isteği gönderir; ajan ekranın durulmasını bekler ve yanıt verir">
</picture>

Bir ajanın en çok yaptığı şey bakmak, işlem yapmak ve yeniden bakmaktır. Tasarımın büyük kısmı bu döngüye hizmet eder.

**Yanıt ekranı taşır.** Bir işlem durulmuş ekranı, neyin değiştiğini gösteren bir diff olarak döndürür; böylece bir istemcinin ne olduğunu görmek için ikinci bir çağrıya ihtiyacı olmaz. `settled`, ekranın durgunlaştığını söyler. `changed`, öncekinden farklı olduğunu söyler.

**Ekranın ne zaman durgun olduğuna ekrana en yakın taraf karar verir.** Ajan ya da runner ekranı izler ve ekran 200 ms boyunca sessiz kaldığında, en çok 3 s içinde, yanıt verir. Bunu cihazda yapmak gidiş-dönüş gerektirmez ve hiçbir şey kıpırdamazken hat sessiz kalır. Runner'ı olmayan bir simülatör aynısını Mac'te, `simsettle.ts` içinde, kendi zamanlamalarıyla yapar: orada bir okuma yaklaşık 30 ms sürer, bu yüzden daha sık bakabilir. Kurallar ve pencerenin neleri yakaladığı [protokolde](reference/protocol.md#settle).

**Bir seçici son anda çözülür.** Hedef, dokunuştan hemen önce, taze bir okumada bulunur. Arada kıpırdayan bir ekran onu yanlış yere gönderemez. Birden çok eşleşme, ref'leriyle birlikte reddedilir. Bir tahmin başarı gibi görünürdü.

**Bir ret öğretir.** Başarısız bir çağrı, bir `code` ve bir `hint` taşıyan bir `isError` yanıtıdır; başarısız bir işlem dokunuşunun gidip gitmediğini de söyler. Argümanlar geldiklerinde sıkı biçimde denetlenir; bir sunucunun neye dokunabileceğini her zaman bayrakları belirler, hiçbir zaman bir araç çağrısı değil.

Her platformun kendi giriş yolu vardır. Bir simülatörün hiç ajana ihtiyaç duymadığı yer dışında hepsi aynı protokolü konuşur.

| cihaz     | orada ne çalışır                                         | Mac ona nasıl ulaşır                                      |
| --------- | -------------------------------------------------------- | --------------------------------------------------------- |
| Android   | ajan: shell kullanıcısı olarak çalışan bir `app_process` | adb sunucusu üzerinden, token ile bir abstract soket      |
| simülatör | başta hiçbir şey: Mac'teki yardımcılar okur ve dokunur   | yardımcılar; runner bir şey ona ihtiyaç duyduğunda başlar |
| iPhone    | runner, bir XCTest paketi                                | `usbmuxd`                                                 |

## Bir pencere

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/touch-and-frame.tr.dark.svg">
  <img src="images/touch-and-frame.tr.svg" alt="Bir dokunuş ve bir görüntü: her cihaz pencereyi kendi yoluyla besler; bir dokunuş her zaman pencereden Node'a, sonra cihaza gider">
</picture>

Bir pencere cihazın kendisi gibi hissettirmelidir. Biçimini bu belirler.

**Pencere native'dir, kontrol düzlemi Node'dur.** `mac/Viewer` içindeki viewer Objective-C'dir; her pencere için bir süreçtir ve ilk kullanımda `clang` ile derlenir. Görüntüyü çözer ve çizer. Node yayınları başlatır ve durdurur, girdiyi taşır ve neyin yanlış olduğunu adıyla söyler. İkisi viewer'ın stdin ve stdout'unda, her seferinde bir satır JSON konuşur. Her mesajı [hat](reference/mirror.md#the-wire) listeler.

**Bir görüntü var olan en kısa yolu izler.** Bir Android telefonda viewer ajana kendisi bağlanır, böylece Node hiçbir kareyi görmez. Bir simülatör yüzeyini paylaşır, bir emülatör de bir dosyayı doldurur. Node'un bunlardaki tek payı yeni bir karenin geldiğini söylemektir. İstisna iPhone'dur: yayınını Node sürecinin bir worker thread'i tutar ve bu thread adlandırılmış bir pipe'a yazar.

**Bir dokunuş tek bir yol izler ve bir kişinin girdisi hiç beklemez.** Her dokunuş `MirrorSession` ve cihazın `Mirror.input`'u üzerinden geçer. Android'de bu kendi başına bir bağlantıdır, böylece bir parmak bir sürücünün yaptığı işin arkasında sıraya girmez.

Bir kişi ve bir ajan bir cihazı aynı anda kullanabilir. Bir ajanın çağrıları sürücü üzerinden, bir kişinin girdisi pencerenin oturumu üzerinden geçer. Hub'ın eklediği şeyler `packages/hub` içindedir ve hub işi yalnızca bir dokunuşun yanında sıraya koyar, asla önünde değil.

## Ölçmek

Her ölçüm platformun kendi araçlarından okunur ve geldiği ham çıktıyla birlikte saklanır. Okunamayan bir sayı adıyla reddedilir, asla sıfır olarak bildirilmez. Her cihazın neyi okuyabildiğini [Ne nerede çalışır](reference/perf.md#what-works-where) söyler.

Bir çalıştırma `packages/perf` içinde bir kayıt kümesine dönüşür; bir baseline da bir çalıştırma kümesidir. Kapı bunları tek bir fonksiyonda, `compareMetric` içinde, şu sırayla karşılaştırır.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/perf-gate.tr.dark.svg">
  <img src="images/perf-gate.tr.svg" alt="Kapı nasıl karar verir: sırayla yedi soru, her biri bir kararla biter: new, refused, ok, few-samples, improvement, noisy ya da regression">
</picture>

Önemli olan sıradır. Bir değişiklik bir tabanı, bir sıra testini ve baseline'ın çalıştırmadan çalıştırmaya kendi oynamasını geçmelidir. Bir çalıştırmanın örnekleri onun yükünü ve ısısını paylaşır; bu yüzden değişmemiş bir uygulamanın iki çalıştırması, yalnızca bir sıra testine bakılırsa çoğu zaman anlamlı biçimde farklıdır. Her parçayla ve her parça olmadan oranlar [Kapı](reference/perf.md#the-gate) bölümünde.

Karar veremeyen bir kapı geçirmemelidir. Bu yüzden `few-samples`, `noisy` ve `refused` hepsi 1 ile çıkar.

## Native kod

| klasör           | dil         | ne olduğu                                                                                   |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `android/agent`  | Kotlin      | Cihazdaki ajan: ağaç, girdi, durulma, video yayını.                                         |
| `ios/Runner`     | Swift       | XCTest runner'ı, bir simülatörde ya da bir telefonda.                                       |
| `ios/RunnerCore` | Swift       | Runner'ın cihaz olmadan verdiği kararlar, `swift test` ile test edilir.                     |
| `ios/SimHelper`  | Objective-C | Bir simülatörün ihtiyaç duyduğu yardımcılar: dokunma, erişilebilirlik, başlatma, probe'lar. |
| `mac/Viewer`     | Objective-C | Pencere ve hub.                                                                             |
| `mac/App`        | karışık     | Mac uygulamasının kabuğu: menü çubuğu, başlatıcı, simge, cask.                              |
| `mac/TextScan`   | Objective-C | Bir ekranın sözcüklerini ağaç olmadan okuyan `TextScan`.                                    |

`android/fixture` ve `ios/Fixture` test uygulamalarıdır. Her birinde bilinen maliyetler yerleşiktir, böylece bir ölçüm bir doğruya karşı denetlenebilir: 40 ms çizen bir ekran, 50 MB'lık bir ayırma, 500 ms'lik bir takılma.

## Durum

| ne                                     | nerede                                               |
| -------------------------------------- | ---------------------------------------------------- |
| bir cihazı kim tutuyor, ajan adresleri | `~/Library/Caches/appdyno` ya da `APPDYNO_STATE_DIR` |
| çalıştırmalar, trace'ler               | aynı klasörün altında ya da `--measurements`         |
| baseline'lar ve bütçeler               | projenizde `.appdyno/perf/`, commit etmek için       |

Bir cihaz üzerindeki talep bir pid ve bir başlangıç zamanı tutar; böylece ölü bir sahibin talebi talep sayılmaz ve bir çökmeden sonra temizlenecek bir şey kalmaz. Her birim testi çalıştırması kendi klasörünü alır ve sizin gerçek durumunuza ulaşamaz.

## Testlerin tuttukları

Önemli kurallar birer testtir, böylece sessizce eskiyemezler.

| test                                          | tuttuğu                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/appdyno/test/boundaries.test.ts`    | Paket haritası: her paketin neyi içe aktarabileceği.                              |
| `packages/appdyno/test/structure.test.ts`     | Bir dosyaya 450 satır, iki kez geçen 8 satırlık bir dizi yok.                     |
| `packages/appdyno/test/function-size.test.ts` | Bir fonksiyona 200 satır.                                                         |
| `packages/mcp/test/catalog.test.ts`           | Kataloğun boyutu ve belgelerin her aracı listelemesi.                             |
| `packages/protocol/test/native.test.ts`       | Kotlin, Swift ve TypeScript taraflarının protokolde anlaşması.                    |
| `packages/appdyno/test/docs.test.ts`          | Belgelerdeki her bağlantının bir yere varması ve bu diyagramların kodla uyuşması. |

Cihaz suite'leri `device-tests` içindedir. Adını verdiğiniz bir cihaz isterler ve CI hiçbirini çalıştırmaz: bkz. [CI sayfası](reference/ci.tr.md).

**Diyagramlar nasıl doğru kalır.** Her biri `docs/images` içinde elle yazılmış tek bir SVG'dir, üreteci yoktur. Biri koddan uzaklaştığında `docs.test.ts` başarısız olur: paket haritası her paketin satırını taşır ve bu satırlar içe aktarma kurallarına karşı denetlenir. Kapının resmi kapının sabitlerine karşı denetlenir ve bir diyagramın andığı her yol var olmalıdır. Bir testin görmediği biçimde değişen bir rotayı ya da yerleşimi yeniden çizmek yine size kalır.
