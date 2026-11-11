# Araçlar nasıl test edildi

[English](tools-tested.md)

[Araçların](tools.tr.md) neyin üzerinde çalıştırıldığı ve her çalıştırmanın ne gösterdiği. Cihaz suite'leri `device-tests/` içindedir; nasıl çalıştırılacaklarını [CI ve sürümler](ci.tr.md) söyler. _Fixture_, appdyno'nun kendi test uygulaması `dev.appdyno.fixture`'dır. _Host yükü_, Mac'in 1 dakikalık yük ortalamasıdır; 15 çekirdekte.

## Android 17

Her Android cihaz suite'i 2026-11-08'de Android 17, API 37 emülatöründe çalıştı: `system-images;android-37.0;google_apis;arm64-v8a` revizyon 8, build `CE2A.260420.051.A3`, emülatör 37.2.13, 420 dpi'de 1080x2400, CPU'sunda çizen (`swiftshader_indirect`), adbd root değil, 15 çekirdekte 8 ile 28 arası host yükünde her seferinde bir dosya. Bu çalıştırma hiçbir proxy'yi değiştirmediği için `evidence.test.ts`'in proxy testi dışarıda bırakıldı. Başarısız olan bir test yeniden çalıştırıldı, ardından Android 17'yi geri kalanından ayırmak için aynı yapımdan, revizyon 14, build `UE1A.230829.050` olan bir API 34 emülatöründe de çalıştırıldı. Android 17'nin değiştirdikleri; her biri düzeltildi ve onda yeniden çalıştırıldı:

- Dispatcher, enjekte edilen dokunuşları, kim gönderirse göndersin, tek ve bütün bir olay dizisine bağlı tutar. Uzun basma sırasında öldürülen bir ajanın basılı bıraktığı bir parmak, sonraki her parmak basışının reddedilmesine yol açtı ("Invalid DOWN event - pointers already down") ve durum çubuğunda tutulduğunda bir sonraki activity başlangıcında bildirim perdesini açtı. Yeni bir ajan basılı bırakılmış bir parmağı kaldırır; reddedilen bir parmak basışı da onu kaldırır ve yeniden dener. Basılı kalmış bir parmak yoksa dispatcher ajanın iptalini reddeder ve bunu durumuyla birlikte loga yazar, bir başlangıçta en çok iki kez; API 34 bunun hiçbirini yazmaz. Google'ın Android 17 sayfaları bunu anmıyor.
- Kimlik bilgisi sorusu, içinde bir kimlik bilgisi görünümü olan biyometrik sorudur ve parmak izi olarak okunuyordu: artık parola olarak okunur.
- 37'yi hedefleyen bir uygulama bu Mac'e `10.0.2.2` üzerinden ya da yerel ağa yalnızca `ACCESS_LOCAL_NETWORK` ile ulaşır: o olmadan fixture'ın indirmesi takılı kaldı, `perf_snapshot` ve `network` 0 bayt saydı. Fixture bunu ister ve `adb install -g` verir; 37'yi hedefleyen kendi uygulamanızın da aynı şey için buna ihtiyacı vardır. Böyle bir uygulama için `via: proxy` ile `network` denenmedi.
- `cmd package compile --reset` bir `.dm`'in profilini tutar ve onunla hiçbir şey derlemez; bu yüzden `compile` ile bir açılış ölçümü, `.dm`'in derlediği bir uygulamayı `verify`'da bıraktı. Ölçüm o uygulamayı yeniden `speed-profile`'da derler; uygulamada da sonra `reason=cmdline` yazar.
- Başka bir API aralığı için bir `.dm` kurulumda "The profile is in the wrong format" ile reddedilir; API 34 ise onu kabul edip hiçbir şey derlemiyordu.
- `dumpsys meminfo` native ayırmaları türüne göre listeler, bitmap satırı yalnızca uygulama bir bitmap tuttuğunda vardır: orada satırın olmaması 0 bitmap olarak okunur; böyle bir listesi olmayan bir Android'de ise hiçbir değer okunmaz.
- `locksettings clear`, PIN ayarlı olmayan yerde "has no password" diyerek başarısız olur, tıpkı bir test kendi PIN'ini temizledikten sonra olduğu gibi: o testin temizliği bu yanıtı tamamlanmış sayar.

Bunlardan sonra 45 suite'in 37'sinin her testi, taramada ya da düzeltmesinden sonra yeniden çalıştırılarak geçti; `perf.test.ts` ve `evidence.test.ts` yalnızca ağ testleri için yeniden çalıştı. 8'i, her biri API 34'te de aynı biçimde başarısız olan ya da bu emülatörün yapımının açıkladığı birer testte başarısız oldu: başka bir build'in native çökme sembolleri, NDK r30'un `ndk-stack`'i bunlar için artık uyarmıyor, oysa r28'inki aynı tombstone'da uyarıyor; CPU'sunda çizen emülatörlerde `vitals.test.ts`'in açık ekranı ve `mirror.hud.test.ts`'in canlı sayıları, oysa [performans başvurusu](perf.tr.md#ne-nerede-çalışır) Mac'in GPU'sunda çizer; Wi-Fi açıkken mobil verinin kapatılması, ama API 37 emülatörü bu Mac'e `10.0.2.2` üzerinden yine de ulaştı; testi her ikisinde de bir ajan kaybeden yüksek kontrastlı metin; `report`'un komut satırından adımları; kayıtlı parmak izi olmayan bir parmak izi sensörü, test sensör olmamasını beklerken `NOT_FOUND` yanıtı verir; ve emülatörün gRPC ile kendi görüntüsü, çünkü bu emülatör portunu adlandıran bir dosya yazmadı. `diagnose.test.ts`, `crashes.test.ts`'ten hemen sonra her ikisinde de başarısız olur, çünkü sistemin çökme iletişim kutusu çöken süreci canlı tutar ve önde bir uygulama penceresi kalmaz; tek başına çalıştırıldığında ise geçer. `exits.test.ts`, `timeline.test.ts` ve `perf-compare.test.ts` birer kez başarısız oldu ve yeniden çalıştırılınca geçti.

Google'ın Android 17 için, bütün uygulamalara ve 37'yi hedefleyen uygulamalara yönelik davranış değişikliklerinden şunlar bu aracın yaptığına dokunabilir: yukarıdaki yerel ağ izni; fiziksel bir klavyeyle yazılırken gizlenen parolalar, bir döndürmeden sonra yeniden gösterilmeyen IME ve fiziksel bir klavyeyle yazmanın erişilebilirlik olayları, suite'lerin yazma, döndürme ve parola alanı testleri bunlardan geçti; yansımanın değiştiremediği static final alanlar, ajan bunların hiçbirini değiştirmez; ve burada denenmeyenler: `setContentCaptureEnabled(false)`'un artık içerik yakalamayı engellememesi, bu aracın yaptığı ekran yakalama bu değildir; arka plan sesinin ve bir `IntentSender` ile başlatmaların sıkılaştırılması; çıkışında `MemoryLimiter:AnonSwap` yazan bellek sınırlayıcı; ve büyük ekran yönü için kapsam dışı kalma seçeneğinin kaldırılması. Hiçbir sayfa `am`, `cmd`, `pm`, `run-as`, uygulamanın kendi uid'inden bir FCM broadcast'i, bildirimler, logcat, App Link doğrulaması, uygulama başına diller ya da edge-to-edge için bir değişiklik anmıyor ve her biri için suite'ler geçti.

## Önce kişiye sormak

`device-tests/ask-person.test.ts`, her MCP revizyonunda bir simülatörde stdio üzerinden bir evet, bir hayır, soramayan bir istemci ve seçeneği çalıştırır; fixture'ın verisi hayırda ve hiçbir şeyin soramadığı yerde yerinde kalır. `app install` bir simülatörde kurulu fixture'ın üstüne çalıştırıldı ve fixture'ın tuttuğu bir dosya sonrasında da yerindeydi.

## Push bildirimleri

`device-tests/push.test.ts` ile, MCP sunucusu üzerinden stdio ile çalıştırıldı. Bir API 34 emülatöründe `tapped` fixture'ı açtı, fixture'ın ekranı kendisine verilen iki anahtarı gösterdi; ona gönderilen diğer her tür reddedildi, çünkü fixture'da Firebase Messaging yok; hiç kimse de bir bildirim çizmedi. iOS 27.2'li bir iPhone 17 Pro simülatöründe alanlardan bir alert ve APNs'in kendi payload'undan rozet, ses ve kategori içeren bir alert, anahtarlarıyla fixture'ın koduna ulaştı; `simctl` bir background push'u reddetti: "Notification has no user visible content". Fixture arka plandayken bir alert ve `content-available` içeren bir alert, kodunda bir önceki push'u bıraktı, fixture çalışmıyorken olduğu gibi.

Rich bir push'u değiştirmek uygulamanın Notification Service Extension'ının işidir ve bir simülatör `simctl push` için hiçbirini çalıştırmaz. Xcode 11.4'ün sürüm notları "The mutable-content key is not honored" der, Xcode 14'ünkiler de uzak bildirimlerin "support more features (like Notification Service Extensions) than locally simulated notifications using .apns payload files or the simctl push command" olduğunu söyler. iOS 27.2 simülatöründe Xcode 27.1 ile denendi: `pluginkit`'in kurulu olarak listelediği bir extension ile derlenen fixture, `mutable-content` içeren bir push'u kendi kodunda değişmeden aldı ve extension'ın hiçbir süreci başlamadı. Logu nedenini söylüyor: `simctl`, bildirim merkezine kendi yaptığı bir isteği verir (`CoreSimulatorBridge` "Forwarding addRequest"), bu yüzden bir extension'ı çalıştıran apsd push'u hiç görmez.

Bir Live Activity'nin push'u `liveactivitiesd`'ye topic'iyle, yani sonuna `.push-type.liveactivity` eklenmiş uygulama kimliğiyle ulaşır; `simctl push` ise bir uygulamanınkinden başka topic almaz. Aynı simülatörde `dev.appdyno.fixture.push-type.liveactivity` verildiğinde onu bir uygulama sandı ve "Source is not authorized" ile reddedildi; `event: start` payload'unu da fixture'ın kendi kimliğine düz bir bildirim olarak gönderdi. Apple'ın bu push'lar için adını verdiği süreçler olan `liveactivitiesd`, `apsd` ve `chronod` ikisinden de hiçbir şey loglamadı.

### Android'de FCM'in kendi mesajı

MCP sunucusu üzerinden stdio ile, `device-tests/push.test.ts` tarafından, Firebase Messaging 26.0.1 içeren ve seçenekleri uydurma bir uygulama olan `android/push-fixture` kullanılarak çalıştırıldı. adbd'si root olmayan bir API 34 emülatöründe, uygulama öndeyken bir background push, ana ekrandayken bir Live Activity'ninki ve süreci öldürüldükten sonra bir background push verileriyle `onMessageReceived`'e ulaştı; boşluk ve kesme işareti içeren bir değer verildiği gibi geldi; uygulama öndeyken bir alert ve rich bir push başlık, metin ve görselleriyle ona ulaştı; ana ekrandayken bir alert'i SDK'sı çizdi ve hiçbir koda ulaşmadı; bildirim izni geri alındığında yanıt bunu söyledi. Firebase Messaging içermeyen fixture'a dördünün her biri bu nedenle reddedildi ve shell hiçbir şey yayımlamadı. Root'lanmamış, Android 14'lü bir Samsung Galaxy A52'de öndeyken, ana ekrandayken ve öldürüldükten sonra veri push'ları ona aynı şekilde ulaştı. Elle, Firebase Messaging 24.1.0 üzerinde aynı türden bir test uygulamasıyla, o emülatörde root olarak gönderilen broadcast `onMessageReceived`'e ulaştı; shell'in uid'inden gönderilen ise ne orada ne de Samsung'da hiçbir yere ulaştı; `push`'un root'u kendisinin kullanmasını yalnızca birim testleri sınıyor, çünkü buradaki hiçbir cihaz adbd'yi kendiliğinden root olarak çalıştırmıyor.

### Apple'ın ve Google'ın sunucuları

FCM isteği, Firebase'in tek bir cihaza giden bir mesaj için belgelediği ve burada kaydedilmiş isteğe karşı, yollar ve bir uygulamanın logcat'inin okunması da sahte bir cihazla test edilir; hiçbir test Google'a ulaşmaz. Bir API 34 emülatöründe, `device-tests/push.test.ts` ile, suite'in kendine ait bir durum klasöründe uydurulmuş bir hesapla, FCM'in aldığı türler yollarıyla listelendi ve her push bu Mac'ten bir şey çıkmadan reddedildi: hiç token yazdırmayan fixture'dan token yok, bir topic adlandıran bir payload, kurulu olmayan bir uygulama. Buradan henüz FCM üzerinden hiçbir push gönderilmedi: bir projenin hesabını bekliyor.

İstek biçimleri her tür için kaydedilmiş isteklere karşı, gönderim de yerel bir HTTP/2 sunucusuna karşı test edilir; hiçbir test Apple'a ulaşmaz. iOS 27.2'li bir iPhone 17 Pro simülatöründe, `device-tests/push.test.ts` ile, suite'in kendine ait bir durum klasöründe uydurulmuş bir anahtarla, APNs'in aldığı türler yollarıyla listelendi ve her push bu Mac'ten bir şey çıkmadan reddedildi: hiç token yazdırmayan fixture'dan token yok, content state'i olmayan bir Live Activity payload'u, fixture'ın bildirmediği VoIP, kurulu olmayan bir uygulama. Buradan henüz APNs üzerinden hiçbir push gönderilmedi ve hiçbir iPhone çalıştırması yapılmadı: bir telefonu ve bir ekibin anahtarını bekliyorlar.

## Bağlantılar

`open_link` `links` ikisinde de çalıştırıldı: simülatörde fixture'ın şeması, emülatörde de şeması, `https://example.com/order*` App Link'i ve o alan adının durumu; kurulumdan hemen sonra `none`, doğrulayıcı denedikten sonra doğrulayıcının kendine ait bir sayı. Bir bağlantının sorusu ve `opened` yanıtı, iOS 27.2'li, az önce silinmiş bir iPhone 17 Pro simülatöründe, bir pencerenin Bağlantılar panelinden çalıştırıldı. Hiçbir başka yolun Ayarlar'ı açmadığı tek uygulamalık bir izin listesi altında bir simülatör `App-prefs:root=General` bağlantısını açıyordu: böyle bir bağlantının Ayarlar'ın kendi kimliğine bağlı tutulmasının nedeni budur.

## Kablosuz bağlantılar ve biyometri

`device-tests/settings.test.ts` bir emülatörde mobil veriyi kapattı ve uçak modunu açtı; bu, emülatörün bu Mac'e giden yolunu kesti, `restore` da onu geri getirdi. Android 16'lı bir Xiaomi'de üç kablosuz bağlantı da etkili oldu ve 234 ile 1.127 ms arasında geri okundu, kayıtlı ağlarına dokunulmadı; anahtar açık okunduktan birkaç saniye sonra Wi-Fi'ına yeniden katıldı. `biometric` bir API 34 emülatöründe çalıştırıldı; kayıt ve fixture'ın sorusunun iki yönde de yanıtlanmasıyla birlikte bütün denetim 17 s sürdü. Bir iPhone'da `devicectl device simulate biometrics`'in yanıtı, yüz kaydı olmayan tek bir iPhone'da görüldü; bir taklidi kabul eden hiçbir telefon da görülmedi.

## Bir simülatörde yapılamayanlar

Bir simülatörün animasyonları olduğu gibi kalır, çünkü onları yavaşlatmanın bir yolu bulunamadı. UIKit'in `UIAnimationDragCoefficient`'ı `com.apple.UIKit` içinde, global domain'de ya da bir başlatma argümanı olarak 10'a ayarlandığında da iOS 27.2'li bir iPhone 17 Pro simülatöründe fixture'ın 300 ms'lik kayması, hiç ayar yokken olduğu gibi, 0,7 s içinde bitti. iOS 27.1'li bir iPhone Duo simülatörü uygulamasını dış ekranda gösterir. O ekran `simctl io screenConfig` ile kapatıldığında, yeniden başlatılan Ayarlar iç ekranda hiçbir şey göstermedi; yani bu da onu katlamak değil.

## Bir iPhone'un kendi koşulları

Kablosuyla bağlı bir iPhone 13 Pro Max'te çalıştırıldı: fixture'ın verisi 4 dosyadan hiçe indi; konumu Allowed'dan "Not asked"a döndü, yeniden sordu ve `alert deny` onu "Denied" yaptı; `network slow` sonrasında `SlowNetworkEdgeBad`, `full` sonrasında hiçbiri geri okundu; `thermal serious` sonrasında `ThermalSerious`, `nominal` sonrasında hiçbiri geri okundu; fixture `tr-TR` gösterdi. One UI'lı bir Samsung'da `network slow` sınırı 29.600'e ayarladı ve `restore` onu sildi, çünkü anahtarın önceden değeri yoktu.

## Yavaş bir ağ

Bir API 34 emülatöründe bu Mac'ten bir megabayt 778 ms sürdü, 100.000'lik bir sınır altında 11,2 s; `restore`'dan sonra sınır kalkmıştı.

## Katlanma

`fold`, API 34'lü 7,6" katlanabilir bir emülatörde çalıştırıldı; cihazın durumu istekten sonra `CLOSED` okundu, `restore`'dan sonra hiçbir şey okunmadı.

## Diller

Android'de `locale` bir API 30 emülatöründe çalıştırıldı; Ayarlar `tr-TR`'den sonra Türkçe, `restore`'dan sonra İngilizce okundu. Bir simülatörde iOS 27.2'li bir iPhone 17 Pro'da çalıştırıldı; `tr-TR`'de tutulan Settings, simülatörün kendi `AppleLocale`'i olduğu gibi kalırken Ayarlar diye okundu, `restore`'dan sonra yeniden Settings diye okundu.

## Kilitli bir telefon

API 36'lı ve test için PIN ayarlanmış bir emülatörde, host yükü 220-250'de, `screen`, `tap` ve `swipe` `DEVICE_LOCKED` ile reddedildi ve hiçbir dokunuş gitmedi, `device-tests/guards.test.ts` ile. Parolası olmayan bir iPhone'da son dokunuştan 90 s sonraki bir kaydırma ana ekran düğmesine tek basıştan sonra uygulamaya ulaştı, bir başlatma ekranı uyandırdı ve uygulama seçilmemiş bir oturum kilit ekranını kendiliğinden geçti. Denenen telefon `passcodeRequired: false` okur; bu yüzden parolalı bir telefon için ret yalnızca koddan gelir ve çalıştırılmadı.

## Çökmeler

`symbols` ile `crashes` bir iPhone 13 Pro Max'te çalıştırıldı: sembolleri ayıklanmış bir Release build'in çökmesinde önce çıplak bir `Fixture` çerçevesi, sonra dSYM'sinden `Fixture fixtureCrash(_:)` okundu.
