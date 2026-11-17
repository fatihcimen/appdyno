# Araçlar nasıl test edildi

[English](tools-tested.md)

[Araçların](tools.tr.md) neyin üzerinde çalıştırıldığı ve her çalıştırmanın ne gösterdiği. Cihaz suite'leri `device-tests/` içindedir; nasıl çalıştırılacaklarını [CI ve sürümler](ci.tr.md) söyler. _Fixture_, appdyno'nun kendi test uygulaması `dev.appdyno.fixture`'dır. _Host yükü_, Mac'in 1 dakikalık yük ortalamasıdır; her çalıştırmanın söylediği sayıda çekirdekte.

## Test edilen sürümler

Bu sayfadaki bir çalıştırmanın eksiksiz adlandırdığı her cihaz, işletim sistemi ve Xcode, en yeniden eskiye. [CI ve sürümler](ci.tr.md) sayfasındaki simulator smoke'u aynı dört sütunu, her sürümün bir dosya olarak taşıdığı `device-summary.md` dosyasının başına yazar: orada olup burada olmayan bir satır, yalnızca smoke'un suite'lerinin çalıştığı bir ikiliyi adlandırır. Smoke buradaki satırlarında 18 durum çalıştırdı; 1.3.0'dan bu yana değiştirici tuşlu tuşlar da içinde olmak üzere 21 durum çalıştırır ve 21 durumun GitHub'ın runner'ında bir çalıştırması henüz kayıtlı değildir.

| cihaz                              | işletim sistemi                         | Xcode         | tarih      | ne çalıştı                                                                                                                                                                   |
| ---------------------------------- | --------------------------------------- | ------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iPhone 17 simulator                | iOS 27.2 (24B8117)                      | 27.2 (27B52)  | 2026-11-17 | 41 suite, her seferinde bir dosya: 292 geçti, 2 kaldı: [Simulator'larda 1.3.0](#simulatorlarda-130)                                                                          |
| iPhone Duo simulator'ı             | iOS 27.2 (24B91016s)                    | 27.2 (27B52)  | 2026-11-17 | `fold.test.ts` üç kez: bir kez 6'da 6, iki kez 6'da 5: [Katlanma](#katlanma)                                                                                                 |
| iPhone 17 simulator                | iOS 26.5 (23F77)                        | 26.5 (17F42)  | 2026-11-17 | 41 suite, her seferinde bir dosya: 292 geçti, 2 kaldı: [Simulator'larda 1.3.0](#simulatorlarda-130)                                                                          |
| Android emulator, Pixel 7          | Android 16, API 36 (BE2A.250530.026.F3) | yok           | 2026-11-17 | 50 suite, her seferinde bir dosya: 348 geçti, 4 kaldı: [Emulator'larda 1.3.0](#emulatorlarda-130)                                                                            |
| Android emulator, Pixel 9 Pro Fold | Android 15, API 35 (AE3A.240806.043)    | yok           | 2026-11-17 | bir katlanma, koşullar, pil sayfası ve pencerenin çubuğu: 24 geçti, hiçbiri kalmadı: [Emulator'larda 1.3.0](#emulatorlarda-130)                                              |
| iPhone 13 Pro Max                  | iOS 27.2 (24B119)                       | 27.2 (27B52)  | 2026-11-17 | `person-prompts` dışında telefon alan her suite, iki turda: 132 geçti, 1 kaldı: [iOS 27.2'li bir iPhone](#ios-272li-bir-iphone)                                              |
| Xiaomi REDMI 15C                   | Android 16, API 36, HyperOS 3.0.301.0   | yok           | 2026-11-17 | telefon alan her suite, iki turda: 235 geçti, hiçbiri kalmadı: [HyperOS 3'lü bir Xiaomi](#hyperos-3lü-bir-xiaomi)                                                            |
| iPhone 17 simulator'ı              | iOS 26.5 (23F77)                        | 26.6 (17F113) | 2026-11-16 | GitHub'ın barındırılan macOS runner'ında simulator smoke'u: 18 durumu yalnızca runner ile geçti, çünkü makinede simulator HID servisi yok; suite'ler 417 s (bütün job 15 dk) |
| iPhone 17 simulator                | iOS 26.5 (23F77)                        | 26.5 (17F42)  | 2026-11-16 | bir Mac'te simulator smoke'u: 18 durumu simulator'ın yardımcılarıyla 189 s'de, yalnızca runner ile 219 s'de geçti, 10 çekirdekte host yükü 40 ile 329 arasında               |
| iPhone 17 simulator                | iOS 27.2 (24B8117)                      | 27.2 (27B52)  | 2026-11-16 | simulator suite'leri, her seferinde bir dosya: [Xcode 27.2](#xcode-272)                                                                                                      |
| iPhone Duo simulator'ı             | iOS 27.2 (24B91016s)                    | 27.2 (27B52)  | 2026-11-15 | 1.3.0'dan önce, araçların dışında bir deneme: menteşe olayı onu katlayıp açtı, appdyno 1.2.0 da açıkken onu okudu: [Katlanma](#katlanma)                                     |
| Android emulator                   | Android 17, API 37 (CE2A.260420.051.A3) | yok           | 2026-11-08 | her Android suite'i: [Android 17](#android-17)                                                                                                                               |

## Simulator'larda 1.3.0

Her simulator suite'i 2026-11-17'de, macOS 26.7.3 yüklü, 10 çekirdekli bir Mac'te her seferinde bir dosya çalıştı: Xcode 26.5 (17F42) altında iOS 26.5 (23F77) yüklü bir iPhone 17 simulator'ında, 2 ile 56 arası host yükünde; ve `DEVELOPER_DIR` ile kullanılan Xcode 27.2 (27B52) altında, runner'ı ve fixture'ları onunla derlenmiş, iOS 27.2 (24B8117) yüklü yeni bir iPhone 17 simulator'ında, yanında Android suite'leri çalışırken 3 ile 190 arası host yükünde. Kalan bir suite, nedeni bulununca yeniden çalıştı. `simulator-create.test.ts` stok bir modelin adıyla bir simulator yaptığı için dışarıda bırakıldı; `mirror.simulator.test.ts`'in gerçek bir pencere açan ya da bir simulator'ı onun altında yeniden başlatan ve yalnızca istenince çalışan üç bloğu da öyle. Atlanan öteki her durum başka bir platformundur: Android, bir emulator ya da bir iPhone.

Çalıştırmaların bulduğu, her biri düzeltilip yeniden çalıştırılan:

- Yan tutulan bir simulator'da ref ile "Your name"e yapılan `type_text` metni parola alanına yazdı ve yazdığını söyledi: klavye formu yukarı kaldırdı, parola alanı "Your name"in okunduğu yere geldi ve simulator'ın tuşları alanı o yerle aradı. Tuşlar artık dokunulan alanı ne olduğuyla izler. Bu, simulator'ı döndüren bir flow'u olan `flows-ci.test.ts`'ten sonra çalışan `flows.test.ts`'te görüldü: bir simulator'ın not edilecek bir döndürme kilidi yoktur, bu yüzden dönüşü geri konmaz; suite'in denetimi de dönmüş olsun olmasın `rotation 0` okunan ana ekranı okuyordu. CI suite'i artık simulator'ı kendisi dik durdurur.
- iOS 27.2'de bir web view'in sayfası daha `about:blank` iken listelenir ve onu gösteren link'ten hemen sonraki bir `inspect_app` `web_click` 4 çalıştırmanın 4'ünde orada hiçbir şey bulamadı. Artık, seçiciyle yapılan bir tap'in öğesini beklediği gibi, seçicisini 1,5 sn'ye kadar bekler.
- Mac uygulamasının New Simulator'ı her runtime'ı adıyla ekliyordu, bu Mac'te de iOS 27.2 adlı iki runtime vardı, ikincisi tek bir model için: menü birini tuttu, hiçbir şey seçilmedi ve Create hiçbir şey yapmadı, izin listesine bağlı bir hub'ın reddini bile göstermedi. Her runtime artık kendi satırıdır.
- Bir açılışta bir uygulamanın kayıtlı sahnesini bir kez atan bir iOS 26.5 simulator'ı, yeniden açılana kadar her açılışta onu atar; `keys.test.ts`'in öndeyken yaptığı durdurmalar da buna yol açtı: ondan sonra çalışan `lifecycle.test.ts` tuttuğu değeri kaybetti, yeni bir açılıştan sonra ise 2 çalıştırmanın 2'sinde tuttu. Suite artık önce simulator'ı yeniden açar.
- `gate-why.test.ts` fixture için frame probe'unu tutulmuş bıraktı; bu yüzden ardından çalışan `ios-perf.test.ts`, probe'suz başlattığı bir uygulamada probe'u buldu. Kalan bir `network.simulator.test.ts` ya da `flows.test.ts` durumu da çalışır bir capture ya da kayıt bıraktı ve bu, ardından gelen her durumu reddetti. Her suite artık tuttuğunu bitirir.
- Durumlar bir reddi hâlâ bir MCP istemcisinin okuduğu kod ve ipucu olmadan, veri kaybı sorusunu 1.3.0'dan önceki araç adıyla, Notification Center'ı da tarih görünümünün satırıyla okuyordu; bir okuma o satırı, yalnızca listelediği tarihi ve saati tuttuğu için artık dışarıda bırakır: her biri düzeltildi.

Her suite'in sayısı son bütün çalıştırmasıdır; orada kalan her durum düzeltmesinden sonra yeniden çalıştırıldı. Geçen, kalan ve atlanan:

| suite               | iOS 26.5    | iOS 27.2    |
| ------------------- | ----------- | ----------- |
| `allow-apps`        | 4, 0, 5     | 4, 0, 5     |
| `app-data`          | 1, 0, 3     | 1, 0, 3     |
| `ask-person`        | 8, 0, 0     | 8, 0, 0     |
| `build-and-run`     | 2, 0, 2     | 2, 0, 2     |
| `crashes`           | 2, 0, 2     | 2, 0, 2     |
| `diagnose`          | 3, 0, 10    | 3, 0, 10    |
| `driving`           | 22, 0, 41   | 22, 0, 41   |
| `evidence`          | 22, 0, 42   | 22, 0, 42   |
| `flows-ci`          | 7, 0, 7     | 7, 0, 7     |
| `flows`             | 9, 0, 21    | 9, 0, 21    |
| `fold`              | 0, 0, 12    | 0, 0, 12    |
| `gate-why`          | 4, 0, 8     | 4, 0, 8     |
| `guards`            | 1, 0, 9     | 1, 0, 9     |
| `hub.device`        | 1, 0, 0     | 1, 0, 0     |
| `hub`               | 2, 0, 0     | 2, 0, 0     |
| `install-ipa`       | 2, 0, 1     | 2, 0, 1     |
| `ios`               | 42, 0, 0    | 41, 1, 0    |
| `ios-perf`          | 15, 2, 0    | 16, 1, 0    |
| `keys`              | 8, 0, 17    | 8, 0, 17    |
| `lifecycle`         | 5, 0, 7     | 5, 0, 7     |
| `mcp-stdio`         | 8, 0, 8     | 8, 0, 8     |
| `measures-sim`      | 7, 0, 0     | 7, 0, 0     |
| `mirror.hud`        | 2, 0, 0     | 2, 0, 0     |
| `mirror.record`     | 4, 0, 14    | 4, 0, 14    |
| `mirror.simulator`  | 5, 0, 3     | 5, 0, 3     |
| `mirror.window`     | 10, 0, 0    | 10, 0, 0    |
| `network.simulator` | 18, 0, 0    | 18, 0, 0    |
| `open-settings`     | 23, 0, 30   | 23, 0, 30   |
| `perf-compare`      | 1, 0, 2     | 1, 0, 2     |
| `person-prompts`    | 1, 0, 4     | 1, 0, 4     |
| `picture-words`     | 2, 0, 4     | 2, 0, 4     |
| `push`              | 8, 0, 10    | 8, 0, 10    |
| `scroll`            | 3, 0, 6     | 3, 0, 6     |
| `settings`          | 4, 0, 16    | 4, 0, 16    |
| `small-tools`       | 11, 0, 20   | 11, 0, 20   |
| `steps`             | 2, 0, 4     | 2, 0, 4     |
| `timeline`          | 2, 0, 6     | 2, 0, 6     |
| `views.simulator`   | 9, 0, 0     | 9, 0, 0     |
| `watch`             | 7, 0, 14    | 7, 0, 14    |
| `window.push-token` | 2, 0, 0     | 2, 0, 0     |
| `window.sends`      | 3, 0, 2     | 3, 0, 2     |
| 41'inin tümü        | 292, 2, 330 | 292, 2, 330 |

Kalanlar ve açık kalan öteki şeyler [1.3.0'da açık kalanlar](#130da-açık-kalanlar) bölümündedir. `fold.test.ts` yalnızca bir Duo simulator'ı alır; bir Duo'daki çalıştırmaları [Katlanma](#katlanma) bölümündedir.

## Emulator'larda 1.3.0

Her Android suite'i 2026-11-17'de, iOS suite'lerinin yanında, Pixel 7 profilli, Android 16, API 36 yüklü bir emulator'da her seferinde bir dosya çalıştı: `system-images;android-36;google_apis;arm64-v8a` revizyon 7, build `BE2A.250530.026.F3`, emulator 37.2.12, Mac'in GPU'sunda çizen, 10 çekirdekte 2 ile 375 arası host yükünde. Katlanabilir bir cihazın durumları Pixel 9 Pro Fold profilli, Android 15, API 35 yüklü bir emulator'da çalıştı: revizyon 9, build `AE3A.240806.043`. İlkinde 50 suite 348 testi geçti, 4'ünde kaldı; her suite son bütün çalıştırmasıyla sayıldı, orada kalan her durum düzeltmesinden sonra yeniden çalıştırıldı. 319'u bir iPhone'un, bir simulator'ın, katlanabilir bir cihazın ya da yalnızca istenince açılan bir pencerenin olduğu için atlandı. Katlanabilir cihazda `fold.test.ts` 6'da 6, `settings.test.ts` 15'te 15, `open-settings.test.ts`'in pil sayfası 1'de 1 ve `mirror.hud.test.ts` 2'de 2 geçti; çubuğun katlanma durumu katlanabilirin daha geniş penceresinde atlandı.

Çalıştırmaların bulduğu, her biri düzeltilip yeniden çalıştırılan:

- `mode: hot` ya da `warm` ile `measure_performance` `launch`, uygulamayı ana ekrana gönderdikten 800 ms sonra, uygulama daha duraklarken yeniden başlatıyordu; sistem de görevini hiçbir başlatma zamanlanmadan geri getiriyordu: her çalıştırmada `UNKNOWN`. Artık uygulama durana kadar, en çok 5 sn, bekler; hot başlatma 31 ile 43 ms, warm 48 ile 81, cold 346 okundu.
- Agent'ın bıraktığı bir dönüş, döndürme kilidini üç saniye boyunca her saniye, ardından gelenin üstüne yeniden yazıyordu: `set_device` `restore` otomatik döndürmeyi geri koydu ve 4 çalıştırmanın 4'ünde 30 ms sonra yeniden kilitlendi. Artık yalnızca açık otomatik döndürme yeniden yazılır.
- Suite'lerin kendilerininkiler: bir emulator'ın Wi-Fi'ı bu Mac'e kendiliğinden ulaştığı için mobil veri Wi-Fi kapalıyken kapatılır; pencerenin canlı sayıları Görünüm menüsünün yaptığı gibi açılır, çubuğun Show Performance'ı 780 pt'de katlaması da kendi durumudur; akışının altında öldürülen bir emulator, çalıştığı serial ile yeniden açılır; kilitten sonraki bir okuma da yalnızca sistemin uyuklamasını değil, ekranın kapanmasını bekler.

API 36 emulator'ında, her biri anlaşılmış olarak, her çalıştırmasında hâlâ kalanlar: `open-settings.test.ts`'in pil sayfası, çünkü imajda o sayfanın istediği bir paket yok, API 35 imajı ise onu açar; `frame-cause.test.ts`'in her karede 100 ms'lik GC durumu, bir emulator onu `gc` değil `busy` diye adlandırır, 4 çalıştırmanın 4'ünde; `measures-android.test.ts`'in enerji durumu, bir emulator birimlerini karıştırır, 4 çalıştırmanın 4'ünde; ve `vitals.test.ts`'in açık ekranı, bir emulator onu %99,67 yavaş kare okur, [Android 17](#android-17) bölümünün API 37'de bulduğu gibi.

## Android 17

Her Android cihaz suite'i 2026-11-08'de Android 17, API 37 emulator'ında çalıştı: `system-images;android-37.0;google_apis;arm64-v8a` revizyon 8, build `CE2A.260420.051.A3`, emulator 37.2.13, 420 dpi'de 1080x2400, CPU'sunda çizen (`swiftshader_indirect`), adbd root değil, 15 çekirdekte 8 ile 28 arası host yükünde her seferinde bir dosya. Bu çalıştırma hiçbir proxy'yi değiştirmediği için `evidence.test.ts`'in proxy testi dışarıda bırakıldı. Başarısız olan bir test yeniden çalıştırıldı, ardından Android 17'yi geri kalanından ayırmak için aynı yapımdan, revizyon 14, build `UE1A.230829.050` olan bir API 34 emulator'ında de çalıştırıldı. Android 17'nin değiştirdikleri; her biri düzeltildi ve onda yeniden çalıştırıldı:

- Dispatcher, enjekte edilen dokunuşları, kim gönderirse göndersin, tek ve bütün bir olay dizisine bağlı tutar. Uzun basma sırasında öldürülen bir ajanın basılı bıraktığı bir parmak, sonraki her parmak basışının reddedilmesine yol açtı ("Invalid DOWN event - pointers already down") ve durum çubuğunda tutulduğunda bir sonraki activity başlangıcında bildirim perdesini açtı. Yeni bir ajan basılı bırakılmış bir parmağı kaldırır; reddedilen bir parmak basışı da onu kaldırır ve yeniden dener. Basılı kalmış bir parmak yoksa dispatcher ajanın iptalini reddeder ve bunu durumuyla birlikte loga yazar, bir başlangıçta en çok iki kez; API 34 bunun hiçbirini yazmaz. Google'ın Android 17 sayfaları bunu anmıyor.
- Kimlik bilgisi sorusu, içinde bir kimlik bilgisi görünümü olan biyometrik sorudur ve parmak izi olarak okunuyordu: artık parola olarak okunur.
- 37'yi hedefleyen bir uygulama bu Mac'e `10.0.2.2` üzerinden ya da yerel ağa yalnızca `ACCESS_LOCAL_NETWORK` ile ulaşır: o olmadan fixture'ın indirmesi takılı kaldı, `measure_performance snapshot` ve `capture_network` 0 bayt saydı. Fixture bunu ister ve `adb install -g` verir; 37'yi hedefleyen kendi uygulamanızın da aynı şey için buna ihtiyacı vardır. Böyle bir uygulama için `via: proxy` ile `capture_network` denenmedi.
- `cmd package compile --reset` bir `.dm`'in profilini tutar ve onunla hiçbir şey derlemez; bu yüzden `compile` ile bir açılış ölçümü, `.dm`'in derlediği bir uygulamayı `verify`'da bıraktı. Ölçüm o uygulamayı yeniden `speed-profile`'da derler; uygulamada da sonra `reason=cmdline` yazar.
- Başka bir API aralığı için bir `.dm` kurulumda "The profile is in the wrong format" ile reddedilir; API 34 ise onu kabul edip hiçbir şey derlemiyordu.
- `dumpsys meminfo` native ayırmaları türüne göre listeler, bitmap satırı yalnızca uygulama bir bitmap tuttuğunda vardır: orada satırın olmaması 0 bitmap olarak okunur; böyle bir listesi olmayan bir Android'de ise hiçbir değer okunmaz.
- `locksettings clear`, PIN ayarlı olmayan yerde "has no password" diyerek başarısız olur, tıpkı bir test kendi PIN'ini temizledikten sonra olduğu gibi: o testin temizliği bu yanıtı tamamlanmış sayar.

Bunlardan sonra 45 suite'in 37'sinin her testi, taramada ya da düzeltmesinden sonra yeniden çalıştırılarak geçti; `perf.test.ts` ve `evidence.test.ts` yalnızca ağ testleri için yeniden çalıştı. 8'i, her biri API 34'te de aynı biçimde başarısız olan ya da bu emulator'ın yapımının açıkladığı birer testte başarısız oldu: başka bir build'in native crash sembolleri, NDK r30'un `ndk-stack`'i bunlar için artık uyarmıyor, oysa r28'inki aynı tombstone'da uyarıyor; CPU'sunda çizen emulator'larda `vitals.test.ts`'in açık ekranı, oysa [performans başvurusu](perf.tr.md#ne-nerede-çalışır) Mac'in GPU'sunda çizer; `mirror.hud.test.ts`'in canlı sayıları, çünkü testin Performansı Göster'e tıklaması hiçbir düğmeye ulaşmadı: pencerenin bir telefonun uzun görüntüsünün onu açtığı 780 pt'lik açılış genişliğinde, bir Android cihazın çubuğu, kapsülü görüntünün hızını söylediği anda onu » taşma menüsüne katlar, bir API 36 emulator'ının 2026-11-17'de gösterdiği gibi; açık bir katlanabilirin daha geniş penceresi ise onu tutar; test artık onu Görünüm menüsünün yaptığı gibi açıyor; Wi-Fi açıkken mobil verinin kapatılması, ama API 37 emulator'ı bu Mac'e `10.0.2.2` üzerinden yine de ulaştı; testi her ikisinde de bir ajan kaybeden yüksek kontrastlı metin; `record_session`'ın komut satırından adımları; kayıtlı parmak izi olmayan bir parmak izi sensörü, test sensör olmamasını beklerken `NOT_FOUND` yanıtı verir; ve emulator'ın gRPC ile kendi görüntüsü, çünkü bu emulator portunu adlandıran bir dosya yazmadı. `diagnose.test.ts`, `crashes.test.ts`'ten hemen sonra her ikisinde de başarısız olur, çünkü sistemin crash iletişim kutusu çöken süreci canlı tutar ve önde bir uygulama penceresi kalmaz; tek başına çalıştırıldığında ise geçer. `exits.test.ts`, `timeline.test.ts` ve `perf-compare.test.ts` birer kez başarısız oldu ve yeniden çalıştırılınca geçti.

Google'ın Android 17 için, bütün uygulamalara ve 37'yi hedefleyen uygulamalara yönelik davranış değişikliklerinden şunlar bu aracın yaptığına dokunabilir: yukarıdaki yerel ağ izni; fiziksel bir klavyeyle yazılırken gizlenen parolalar, bir döndürmeden sonra yeniden gösterilmeyen IME ve fiziksel bir klavyeyle yazmanın erişilebilirlik olayları, suite'lerin yazma, döndürme ve parola alanı testleri bunlardan geçti; yansımanın değiştiremediği static final alanlar, ajan bunların hiçbirini değiştirmez; ve burada denenmeyenler: `setContentCaptureEnabled(false)`'un artık içerik yakalamayı engellememesi, bu aracın yaptığı ekran yakalama bu değildir; arka plan sesinin ve bir `IntentSender` ile başlatmaların sıkılaştırılması; çıkışında `MemoryLimiter:AnonSwap` yazan bellek sınırlayıcı; ve büyük ekran yönü için kapsam dışı kalma seçeneğinin kaldırılması. Hiçbir sayfa `am`, `cmd`, `pm`, `run-as`, uygulamanın kendi uid'inden bir FCM broadcast'i, bildirimler, logcat, App Link doğrulaması, uygulama başına diller ya da edge-to-edge için bir değişiklik anmıyor ve her biri için suite'ler geçti.

## Önce kişiye sormak

`device-tests/ask-person.test.ts`, her MCP revizyonunda bir simulator'da stdio üzerinden bir evet, bir hayır, soramayan bir istemci ve seçeneği çalıştırır; fixture'ın verisi hayırda ve hiçbir şeyin soramadığı yerde yerinde kalır. `manage_app install` bir simulator'da kurulu fixture'ın üstüne çalıştırıldı ve fixture'ın tuttuğu bir dosya sonrasında da yerindeydi.

## Push bildirimleri

`device-tests/push.test.ts` ile, MCP sunucusu üzerinden stdio ile çalıştırıldı. Bir API 34 emulator'ında `tapped` fixture'ı açtı, fixture'ın ekranı kendisine verilen iki anahtarı gösterdi; ona gönderilen diğer her tür reddedildi, çünkü fixture'da Firebase Messaging yok; hiç kimse de bir bildirim çizmedi. iOS 27.2'li bir iPhone 17 Pro simulator'ında alanlardan bir alert ve APNs'in kendi payload'undan rozet, ses ve kategori içeren bir alert, anahtarlarıyla fixture'ın koduna ulaştı; `simctl` bir background push'u reddetti: "Notification has no user visible content". Fixture arka plandayken bir alert ve `content-available` içeren bir alert, kodunda bir önceki push'u bıraktı, fixture çalışmıyorken olduğu gibi.

Rich bir push'u değiştirmek uygulamanın Notification Service Extension'ının işidir ve bir simulator `simctl push` için hiçbirini çalıştırmaz. Xcode 11.4'ün sürüm notları "The mutable-content key is not honored" der, Xcode 14'ünkiler de uzak bildirimlerin "support more features (like Notification Service Extensions) than locally simulated notifications using .apns payload files or the simctl push command" olduğunu söyler. iOS 27.2 simulator'ında Xcode 27.1 ile denendi: `pluginkit`'in kurulu olarak listelediği bir extension ile derlenen fixture, `mutable-content` içeren bir push'u kendi kodunda değişmeden aldı ve extension'ın hiçbir süreci başlamadı. Logu nedenini söylüyor: `simctl`, bildirim merkezine kendi yaptığı bir isteği verir (`CoreSimulatorBridge` "Forwarding addRequest"), bu yüzden bir extension'ı çalıştıran apsd push'u hiç görmez.

Bir Live Activity'nin push'u `liveactivitiesd`'ye topic'iyle, yani sonuna `.push-type.liveactivity` eklenmiş uygulama kimliğiyle ulaşır; `simctl push` ise bir uygulamanınkinden başka topic almaz. Aynı simulator'da `dev.appdyno.fixture.push-type.liveactivity` verildiğinde onu bir uygulama sandı ve "Source is not authorized" ile reddedildi; `event: start` payload'unu da fixture'ın kendi kimliğine düz bir bildirim olarak gönderdi. Apple'ın bu push'lar için adını verdiği süreçler olan `liveactivitiesd`, `apsd` ve `chronod` ikisinden de hiçbir şey loglamadı.

### Android'de FCM'in kendi mesajı

MCP sunucusu üzerinden stdio ile, `device-tests/push.test.ts` tarafından, Firebase Messaging 26.0.1 içeren ve seçenekleri uydurma bir uygulama olan `android/push-fixture` kullanılarak çalıştırıldı. adbd'si root olmayan bir API 34 emulator'ında, uygulama öndeyken bir background push, ana ekrandayken bir Live Activity'ninki ve süreci öldürüldükten sonra bir background push verileriyle `onMessageReceived`'e ulaştı; boşluk ve kesme işareti içeren bir değer verildiği gibi geldi; uygulama öndeyken bir alert ve rich bir push başlık, metin ve görselleriyle ona ulaştı; ana ekrandayken bir alert'i SDK'sı çizdi ve hiçbir koda ulaşmadı; bildirim izni geri alındığında yanıt bunu söyledi. Firebase Messaging içermeyen fixture'a dördünün her biri bu nedenle reddedildi ve shell hiçbir şey yayımlamadı. Root'lanmamış, Android 14'lü bir Samsung Galaxy A52'de öndeyken, ana ekrandayken ve öldürüldükten sonra veri push'ları ona aynı şekilde ulaştı. HyperOS 3'lü Xiaomi REDMI 15C'de, 2026-11-17'de, suite'in push fixture durumları geçti: HyperOS bildirim izninin geri alınmasını zorla durdurma sayar, durum da push'undan önce uygulamayı yeniden başlatır. Elle, Firebase Messaging 24.1.0 üzerinde aynı türden bir test uygulamasıyla, o emulator'da root olarak gönderilen broadcast `onMessageReceived`'e ulaştı; shell'in uid'inden gönderilen ise ne orada ne de Samsung'da hiçbir yere ulaştı; `send_push`'un root'u kendisinin kullanmasını yalnızca birim testleri sınıyor, çünkü buradaki hiçbir cihaz adbd'yi kendiliğinden root olarak çalıştırmıyor.

### Apple'ın ve Google'ın sunucuları

FCM isteği, Firebase'in tek bir cihaza giden bir mesaj için belgelediği ve burada kaydedilmiş isteğe karşı, yollar ve bir uygulamanın logcat'inin okunması da sahte bir cihazla test edilir; hiçbir test Google'a ulaşmaz. Bir API 34 emulator'ında, `device-tests/push.test.ts` ile, suite'in kendine ait bir durum klasöründe uydurulmuş bir hesapla, FCM'in aldığı türler yollarıyla listelendi ve her push bu Mac'ten bir şey çıkmadan reddedildi: hiç token yazdırmayan fixture'dan token yok, bir topic adlandıran bir payload, kurulu olmayan bir uygulama. Buradan henüz FCM üzerinden hiçbir push gönderilmedi: bir projenin hesabını bekliyor.

İstek biçimleri her tür için kaydedilmiş isteklere karşı, gönderim de yerel bir HTTP/2 sunucusuna karşı test edilir; hiçbir test Apple'a ulaşmaz. iOS 27.2'li bir iPhone 17 Pro simulator'ında, `device-tests/push.test.ts` ile, suite'in kendine ait bir durum klasöründe uydurulmuş bir anahtarla, APNs'in aldığı türler yollarıyla listelendi ve her push bu Mac'ten bir şey çıkmadan reddedildi: hiç token yazdırmayan fixture'dan token yok, content state'i olmayan bir Live Activity payload'u, fixture'ın bildirmediği VoIP, kurulu olmayan bir uygulama. Buradan henüz APNs üzerinden hiçbir push gönderilmedi ve hiçbir iPhone çalıştırması yapılmadı: bir telefonu ve bir ekibin anahtarını bekliyorlar.

## Bağlantılar

`open_link` `links` ikisinde de çalıştırıldı: simulator'da fixture'ın şeması, emulator'da de şeması, `https://example.com/order*` App Link'i ve o alan adının durumu; kurulumdan hemen sonra `none`, doğrulayıcı denedikten sonra doğrulayıcının kendine ait bir sayı. Bir bağlantının sorusu ve `opened` yanıtı, iOS 27.2'li, az önce silinmiş bir iPhone 17 Pro simulator'ında, bir pencerenin Bağlantılar panelinden çalıştırıldı. Hiçbir başka yolun Ayarlar'ı açmadığı tek uygulamalık bir izin listesi altında bir simulator `App-prefs:root=General` bağlantısını açıyordu: böyle bir bağlantının Ayarlar'ın kendi kimliğine bağlı tutulmasının nedeni budur.

## Kablosuz bağlantılar ve biyometri

`device-tests/settings.test.ts` bir emulator'da mobil veriyi kapattı ve uçak modunu açtı; bu, emulator'ın bu Mac'e giden yolunu kesti, `restore` da onu geri getirdi. Android 16'lı bir Xiaomi'de üç kablosuz bağlantı da etkili oldu ve 234 ile 1.127 ms arasında geri okundu, kayıtlı ağlarına dokunulmadı; anahtar açık okunduktan birkaç saniye sonra Wi-Fi'ına yeniden katıldı. `biometric` bir API 34 emulator'ında çalıştırıldı; kayıt ve fixture'ın sorusunun iki yönde de yanıtlanmasıyla birlikte bütün denetim 17 s sürdü. Bir iPhone'da `devicectl device simulate biometrics`'in yanıtı, yüz kaydı olmayan tek bir iPhone'da görüldü; bir taklidi kabul eden hiçbir telefon da görülmedi.

## Bir simulator'da yapılamayanlar

Bir simulator'ın animasyonları olduğu gibi kalır, çünkü onları yavaşlatmanın bir yolu bulunamadı. UIKit'in `UIAnimationDragCoefficient`'ı `com.apple.UIKit` içinde, global domain'de ya da bir başlatma argümanı olarak 10'a ayarlandığında da iOS 27.2'li bir iPhone 17 Pro simulator'ında fixture'ın 300 ms'lik kayması, hiç ayar yokken olduğu gibi, 0,7 s içinde bitti. Bir iPhone Duo simulator'ı, [Katlanma](#katlanma) bölümünün dediği gibi menteşe olayıyla katlanır, ekranlarıyla değil: iOS 27.1'de dış ekranı `simctl io screenConfig` ile kapatıldığında, yeniden başlatılan Ayarlar iç ekranda hiçbir şey göstermedi.

## Bir iPhone'un kendi koşulları

Kablosuyla bağlı bir iPhone 13 Pro Max'te çalıştırıldı: fixture'ın verisi 4 dosyadan hiçe indi; konumu Allowed'dan "Not asked"a döndü, yeniden sordu ve `answer_alert deny` onu "Denied" yaptı; `network slow` sonrasında `SlowNetworkEdgeBad`, `full` sonrasında hiçbiri geri okundu; `thermal serious` sonrasında `ThermalSerious`, `nominal` sonrasında hiçbiri geri okundu; fixture `tr-TR` gösterdi. One UI'lı bir Samsung'da `network slow` sınırı 29.600'e ayarladı ve `restore` onu sildi, çünkü anahtarın önceden değeri yoktu.

## Yavaş bir ağ

Bir API 34 emulator'ında bu Mac'ten bir megabayt 778 ms sürdü, 100.000'lik bir sınır altında 11,2 s; `restore`'dan sonra sınır kalkmıştı.

## Bir simulator'da ağ

`device-tests/network.simulator.test.ts` bir simulator'da ağ probe'unu sınar: saklanan ve gizlenen başlıklar ve gövdeler, geri okunan bir HAR, her kural türü, throttle ve bir capture ya da oturum bittiğinde geride hiçbir şey kalmaması. 2026-11-16'da bir iOS simulator'ında yazıldı; orada probe'un, mock'lanmış bir yanıtın sonunu gövdesinden önce uygulamaya verebildiğini buldu, bu da düzeltildi. Oradaki fixture'da, yapılandırması başlık ekleyen ve 2 s sonra vazgeçen bir oturum başlıklarını yine gönderdi, probe da onları listeledi, ve yine 2,0 s'de bitti; hiçbir sunucuya güvenmeyen bir delegate probe olmadan başarısız oldu, probe ile yanıtını aldı, çünkü probe bir uygulamanın kendi sertifika denetimine sormaz; bir stream ile yapılan 100 kB'lık bir yükleme de gövdesi saklanmadan bütün olarak ulaştı. 39 isteği olan bir feed okuyucusunun ilk açılışında, hepsinin bir okuması, her host bir kez söylenince 2.313 karakterden 1.319'a indi. 2026-11-17'de suite iOS 26.5'te ve iOS 27.2'de 18'de 18 geçti: [Simulator'larda 1.3.0](#simulatorlarda-130). Simulator smoke'unun durumları arasında yoktur.

## Katlanma

`fold`, API 34'lü 7,6" katlanabilir bir emulator'da çalıştırıldı; cihazın durumu istekten sonra `CLOSED` okundu, `restore`'dan sonra hiçbir şey okunmadı.

Bir iPhone Duo simulator'ında katlanma, simulator'ın kendi menteşe kaydırıcısının gönderdiği menteşe olayıdır; bu olay özel API'dir. 1.3.0 bunun üzerine kurulmadan önce, araçların dışında bir deneme bu olayı 2026-11-15'te Xcode 27.2 (27B52) altında iOS 27.2 (24B91016s) yüklü bir Duo'ya gönderdi: simulator katlandı ve açıldı, `devicectl` hangi ekranı gösterdiğini söyledi, bir uygulama da sahnesi kapalıyken 466 x 678 nokta ile açıkken 951 x 669 arasında taşınırken sürecini korudu. appdyno 1.2.0 açıkken ekranını runner ile okudu, dokunuşları ise iç ekranda hiçbir şeye ulaşmadı.

`device-tests/fold.test.ts` her duruşu fixture'ın kendi penceresine karşı, uygulamanın yeniden başlatılması, `restore` ve oturumun sonu boyunca, katlanabilir bir emulator'da ve bir Duo simulator'ında sınar. Durumları 2026-11-16'da API 35'li bir Pixel 9 Pro Fold emulator'ı ve bir Duo simulator'ı için yazıldı. 2026-11-17'de 6 emulator durumu, Pixel 9 Pro Fold profilli API 35 (`AE3A.240806.043`) bir emulator'da geçti. iOS 27.2 (24B91016s) yüklü bir iPhone Duo simulator'ında, Xcode 27.2 (27B52) altında ve runner'ı ile fixture'ı onunla derlenmiş olarak üç kez çalıştı: bir kez 6 durumu da geçti; bir kez açık iç ekrana bir tap fixture'ın Dialog ekranını açmadı; bir kez de bir kişinin penceresi 30 sn içinde kapağı göstermedi; her durum öteki iki çalıştırmada geçti.

## Diller

Android'de `locale` bir API 30 emulator'ında çalıştırıldı; Ayarlar `tr-TR`'den sonra Türkçe, `restore`'dan sonra İngilizce okundu. Bir simulator'da iOS 27.2'li bir iPhone 17 Pro'da çalıştırıldı; `tr-TR`'de tutulan Settings, simulator'ın kendi `AppleLocale`'i olduğu gibi kalırken Ayarlar diye okundu, `restore`'dan sonra yeniden Settings diye okundu.

## Kilitli bir telefon

API 36'lı ve test için PIN ayarlanmış bir emulator'da, host yükü 220-250'de, `read_screen`, `tap_screen` ve `swipe_screen` `DEVICE_LOCKED` ile reddedildi ve hiçbir dokunuş gitmedi, `device-tests/guards.test.ts` ile. Parolası olmayan bir iPhone'da son dokunuştan 90 s sonraki bir kaydırma ana ekran düğmesine tek basıştan sonra uygulamaya ulaştı, bir başlatma ekranı uyandırdı ve uygulama seçilmemiş bir oturum kilit ekranını kendiliğinden geçti. Denenen telefon `passcodeRequired: false` okur; bu yüzden parolalı bir telefon için ret yalnızca koddan gelir ve çalıştırılmadı.

## Crash'ler

`source: crashes` ve `symbols` ile `read_logs` bir iPhone 13 Pro Max'te çalıştırıldı: sembolleri ayıklanmış bir Release build'in crash'inde önce çıplak bir `Fixture` çerçevesi, sonra dSYM'sinden `Fixture fixtureCrash(_:)` okundu.

## Xcode 27.2

Simulator paketleri, Xcode 26.5'in yanında `DEVELOPER_DIR` ile kullanılan Xcode 27.2 (27B52) ile, iOS 27.2 (24B8117) yüklü bir iPhone 17 simulator'ında, 2026-11-15 ve 16'da, 10 çekirdekte 5-700 ana makine yükünde dosya dosya çalıştırıldı. 40 dosyanın 34'ü çalıştırdığı her testi geçti (ilk turda, bir düzeltmeden sonra ya da daha düşük yükte yeniden çalıştırılınca); dokunma, kaydırma, yazma ve tuşlar hem simulator'ın yardımcılarıyla hem yalnızca çalıştırıcıyla denendi. `hub.test.ts` ve `mirror.hud.test.ts` birer testte kaldı, aynı testler iOS 26.5'te de kalıyor; `gate-why.test.ts` ve `perf-compare.test.ts` sakin bir Mac bekler ve çalıştırılmadı; `crashes.test.ts` bir release derlemesi ister; `simulator-create.test.ts` dışarıda bırakıldı. Xcode 26.5 ile derlenmiş çalıştırıcı ve yardımcılar aynı simulator'ı Xcode 27.2 altında sürdü. 2026-11-17'de bu dosyaların her biri, runner'ı ve fixture'ları Xcode 27.2 ile derlenmiş yeni bir simulator'da yeniden çalıştı ve bu beşi geçti: [Simulator'larda 1.3.0](#simulatorlarda-130).

## iOS 27.2'li bir iPhone

iOS 27.2 (24B119) yüklü bir iPhone 13 Pro Max, kablosuyla, Xcode 26.5'in yanında `DEVELOPER_DIR` ile kullanılan Xcode 27.2 (27B52) ile, 2026-11-16 ve 17'de, 10 çekirdekte 2-120 host yükünde dosya dosya çalıştırıldı. Telefonun parolası yok, geliştiricisine de önceden güvenilmişti. İmzası hiçbir değişken verilmeden kendiliğinden bulundu: ücretli bir takımın telefonu adlandıran wildcard development profili, kimliği login keychain'de. Runner, Xcode'u onu daha önce simulator için derlemiş bir Mac'te, telefon için 22 s'de derlendi. Runner'ın imzalanıp yüklendiği ve başlatıldığı ilk bağlantı, telefonda daha eski bir build'in runner'ı varken, 6,5 s'de yanıt verdi; telefonda hiçbir şey sorulmadı. Fixture 1,5 s'de yüklendi, 3 s'de açıldı.

13 suite, her biri fixture'ın içinde kalan durumlarıyla çalıştı; 61 test geçti, hiçbiri kalmadı: `driving` 14, 119 s; `keys` 3, 36 s; `evidence` 6, 49 s; `flows` 8, 136 s; `scroll` 3, 61 s; `steps` 2, 59 s; `watch` 7, 75 s; `picture-words` 2, 20 s; `list-devices` 1; `app-data` 1, 3 s; `guards` 3, 59 s; `small-tools` 9, 23 s; `diagnose` 2, 5 s. `watch` 104 host yükünde bir testte kaldı, yeniden çalıştırılınca 7'sini de geçti. `press_key`, `command+a` ile bir alanın metnini seçti, `delete` de onu boşalttı. Fixture'dan çıktığı ya da telefonu değiştirdiği için dışarıda bırakılanlar: `driving`'in panosu, text size ve reduce motion ile dark mode'u, ses ile kilidi; `keys`'in kopyala-yapıştır'ı, Control Center'ı, Notification Center'ı ve Spotlight'ı; `evidence`'ın adımları home'a basan videoları ve report'u; `guards`'ın iki kilit ekranı durumu; `small-tools`'un sessize alması ve Siri'si; Settings'i sürdükleri için de `iphone.test.ts`, `iphone-mcp.test.ts` ve `open-settings.test.ts` bütünüyle. Ölçüm yapan suite'ler ve pencere suite'leri o turda çalıştırılmadı.

2026-11-17'de ikinci bir tur, ilkinin dışarıda bıraktıklarını ve bir kişinin yüzünü isteyen `person-prompts.test.ts` dışında telefon alan öteki her suite'i, telefonu bulunduğu gibi bırakarak çalıştırdı: `driving` 3, `keys` 5, `evidence` 1, `guards` 2, `small-tools` 1, `open-settings` 6, `iphone-mcp` 1, `iphone` 22, `measures-iphone` 3, `install-ipa` 1, `live.iphone` 2, `inspector.iphone` 3, `mirror.iphone` 15 ve `mirror.letters` 6 geçti, toplam 71. Üçü bir düzeltmeden sonra geçti: Siri'nin reddi ipucunu, `appdyno mirror`'u kaybetmişti; stdio üzerinden Settings, başka bir suite'in bıraktığı sayfada açılıyordu; trace aracı da bir kayıt ona bağlandıktan sonra Settings'i 240 sn bulamadı, bu artık ne yapılacağıyla reddedilir, durum da önce Settings'i yeniden başlatır. `diagnose`, telefondan kopyalanan crash raporları uygulamanın kendi raporlarıyla sınırlandıktan sonra 2'sini yeniden geçti. Bir durum kaldı: `measures-iphone`'un 5 MB'lık ağ ölçümü; trace aracı, `devicectl` çalışır listelediği hâlde elle imzalanmış bir Debug fixture'ın sürecini 240 sn bulamadı; durum imzalı bir Release fixture için yazılmıştır.

`read_logs` önceki gibi notuyla yanıt verdi: Xcode 27.2'nin `devicectl`'inde log okuyan bir komut yok. Araçların dışındaki bir deneme, fixture'ın satırlarını o çalışırken, yeniden başlatmadan okudu. Telefonun `com.apple.os_trace_relay.shim.remote` servisi, canlı pencerenin kullandığı tünelden ulaşılıp tek bir process id için sorulunca yalnızca o process'in satırlarını, her birini zamanı, seviyesi, kütüphanesi ve subsystem'iyle gönderdi: 150 s'de 3.591 satır, 16 dk 41 s'de 17.083 satır, hiçbiri başka bir process'in değil; uygulamanın process id'si önce ve sonra aynıydı. Yarım dakika kadar satır taşımayan bir akış sona erdi, taşımayı sürdüren ermedi. Henüz hiçbir araç log'u bu yolla okumuyor.

APNs ile push gönderilmedi: bu Mac'te kurulmuş bir anahtar yok, wildcard profil de push yetkisi taşımıyor.

## HyperOS 3'lü bir Xiaomi

Android 16, API 36 ve HyperOS 3.0.301.0 yüklü bir Xiaomi REDMI 15C (25078RA3EY), kablosuyla, "USB debugging (Security settings)" ve "Install via USB" açık, ekran kilidi yok, dili Türkçe; 2026-11-16 ve 17'de, 10 çekirdekte 2-54 host yükünde dosya dosya çalıştırıldı. Agent yükleme istemez, dosya olarak gönderilir: ilk başlatması 8,5 s sürdü.

15 suite, her biri fixture'ın içinde kalan durumlarıyla çalıştı; 130 test geçti, hiçbiri kalmadı: `smoke` 1, 13 s; `steps` 2, 32 s; `scroll` 3, 41 s; `picture-words` 2, 17 s; `flows-ci` 5, 83 s; `flows` 8, 94 s; `surface` 4, 83 s; `views.android` 7, 29 s; `watch` 7, 70 s; `keys` 4, 32 s; `driving` 16, 96 s; `android` 42, 331 s; `small-tools` 7, 22 s; `guards` 2, 15 s; `evidence` 20, 61 s. `views.android` ve `watch` 32-54 host yükünde birer testte kaldı, 4 yükünde yeniden çalıştırılınca her testi geçti. Dokunma, kaydırma, yazma ve tuşlar fixture'a ulaştı. Telefon bir düğmenin `List` yazısını `LİST` yazar; `LIST` içeren bir selector onu buldu. `set_device fold` reddedildi: "this device does not fold". Fixture'dan çıktığı ya da telefonu değiştirdiği için dışarıda bırakılanlar: `driving`'in panosu, kilit ve güç ile sesi, uygulama değiştiricisi, `manage_app` ile yüklemesi, öteki ayarlarıyla dark mode'u, animasyonları ve parmak izi; `keys`'in kopyala-yapıştır'ı, Control Center'ı, bildirimleri ve araması; `android`'in animasyonları, panosu ve iki karanlık ekran durumu; `small-tools`'un sessize alması ve yüksek kontrastı; `guards`'ın kilit ekranı durumu; `evidence`'ın videoları, report'u, proxy'si, durum çubuğunun saati ve başka bir uygulamanın web sayfaları. Öteki suite'ler o turda çalıştırılmadı.

2026-11-17'de ikinci bir tur, ilkinin dışarıda bıraktıklarını ve telefon alan öteki her suite'i çalıştırdı: `driving` 7, `keys` 5, `android` 4, `small-tools` 2, `evidence` 7, `open-settings` 24, `exits` 5, `diagnose` 8, `app-data` 2, `allow-apps` 5, `mcp-stdio` 8, `crashes` 2, `timeline` 6, `push` 10, `install-consent` 5 ve `baseline-profile` 5 geçti, toplam 105; her düzeltme girdikten sonra hiçbiri kalmadı. `allow-apps` telefonun Türkçe etiketlerini okuyordu, artık kimliklerle gider. `timeline`, sistemin "sürekli olarak duruyor" penceresi için tuttuğu çökmüş bir uygulamanın sürecini koruduğunu ve çalışıyor okunduğunu buldu: artık crash olarak okunur. `push`, push fixture'ı yeniden yüklenince 10'da 10 geçti; böyle tutulan bir uygulamaya tapped bir push artık önce onu durdurur. `install-consent` telefonun yükleme sorusunu kendisi yanıtladı, artık soru açılırken kararan bir ekranı da uyandırır. `baseline-profile`, APK'si ve `.dm`'iyle `manage_app install` üzerinden 5'te 5 geçti; appdyno HyperOS'un her yükleme sorusunu kendisi yanıtladı. `guards.test.ts`'in PIN durumu ve `lifecycle.test.ts` yalnızca bir emulator'ındır, burada hiçbir şey çalıştırmadı.

Bu telefonun gösterdikleri:

- Fixture'ın, telefonda kimsenin yanıtlamadığı bir `adb install`'u 90 s sonra reddedilmiş döndü, `INSTALL_FAILED_USER_RESTRICTED`; bir kişinin yanıtladığı 6 s sürdü. Başka bir Mac'in debug anahtarıyla imzalı bir fixture'ın önce kaldırılması gerekti: `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.
- Telefon yeni bir user rotation'a kendi döndürme kilidiyle yanıt verir ve onu 3 s'ye kadar sonra yazar. Geri konan bir dönüş, `set_device restore` ile, bir flow'un sonunda ya da agent UI automation'ı bırakırken, önce user rotation'ı sonra otomatik döndürmeyi yazıyordu; telefonun kendi yazması arkadan geliyordu: otomatik döndürme kapalı kalıyordu. İlki artık kilidi, istendiği gibi okunana kadar yeniden yazıyor; agent da onu üç saniye boyunca her saniye yeniden yazıyor. Her birinden sonra telefon otomatik döndürmeyi bulunduğu gibi açık okudu; kendi ikinci anahtarı `accelerometer_rotation_inner` da 5 s içinde ardından geldi.
- Düzeltilmedi: `android.test.ts`'in agent'ı öldüren ya da UI automation'ı başka bir process'e veren durumlarından sonra, hiç dönüş yapılmamışken, telefonda açık olan otomatik döndürme kapalı okundu ve öyle kaldı. Elle 1 yazılan `accelerometer_rotation` tuttu; `accelerometer_rotation_inner` sonradan 0 bulundu, o da 1 yazıldı. Beş durumdan hangisinin yaptığı henüz bilinmiyor. İkinci turda anahtarlar her suite'ten sonra okundu: `small-tools.test.ts`'ten sonra 0 okunan `accelerometer_rotation_inner` dışında bulunduğu gibiydi.

## 1.3.0'da açık kalanlar

Bu çalıştırmaların kalan ya da açıklanamamış olarak bıraktıkları, her biri görüldüğü gibi:

- **iOS 27.2'de XCTest'in metrikleri.** Launch metriği, istenen 5 açılıştan 0, 2 ya da 4'ünü, her biri yaklaşık 3,65 sn, 4 çalıştırmanın 4'ünde kaydetti; sonuç paketi geçti diyordu. iOS 26.5'te 6 çalıştırmanın 5'inde yaklaşık 1,17 sn'lik 5 açılış kaydetti. Hitches çalıştırması 4'ün 3'ünde "Test crashed with signal kill before establishing connection" ile bitti.
- **iOS 27.2'de Face ID sheet'i.** `ios.test.ts`'in durumu 4 çalıştırmanın 2'sinde kaldı: taramada sheet 10 sn içinde görülmedi; tek başına çalıştırıldığında uygulamanın üstünde durana bakış onu `remote-content` olarak reddetti ve onu okuyacak açık bir runner yoktu. iOS 26.5'te geçti.
- **iPhone Duo simulator'ında katlanma.** 3 çalıştırmanın 2'si, her seferinde başka bir durumda, birer durumda kaldı: [Katlanma](#katlanma).
- **Bu Mac'te Xcode 26.5'in trace aracı.** `ios-perf.test.ts`'in CPU profili ve trace sorgusu iOS 26.5'te 3 çalıştırmanın 3'ünde zaman aşımına uğradı: Xcode 26.5'in `xctrace`'i Time Profiler ile de Allocations ile de hiçbir kayıt başlatmadı, Xcode 27.2'ninki ise aynı süreci 12 sn'de kaydetti; iki durum iOS 27.2'de geçti. Xcode 26.5'in bir `xctrace record`'u, `DTServiceHub`'ıyla, 2026-11-15'ten beri o zamandan beri silinmiş bir simulator için çalışır kalmıştı; bu süreçler bu çalıştırmalardan sonra sonlandırıldı ve iki durum Xcode 26.5 altında henüz yeniden çalışmadı.
- **iOS 26.5'te Settings.** `open-settings.test.ts`'in bir gizlilik sayfası 5 çalıştırmada 3 kez, her seferinde başka bir sayfa, Privacy & Security'nin kendisinde açıldı; iOS 27.2'deki bir çalıştırmada hiç açılmadı. Oturmuş Motion & Fitness sayfası başlığını katlanmış bir sütunda, `text "Motion & Fitness"` satırı olmadan okur; bu yüzden o durum yalnızca erken bir okumayla geçer.
- **Bir simulator'ın dönüşü.** `set_device` `restore`, bir oturumun sonu ve bir test dosyası, not edilecek bir döndürme kilidi olmayan bir simulator'ın hiçbir dönüşünü geri koymaz: dönüş bir sonraki suite'e ya da agent'a kalır.
- [Emulator'larda 1.3.0](#emulatorlarda-130) bölümündeki **dört emulator durumu**.
- **iPhone'da fixture'ın ağ ölçümü** ve agent'ını sonlandıran durumlardan sonra **Xiaomi'de otomatik döndürme**: [iOS 27.2'li bir iPhone](#ios-272li-bir-iphone) ve [HyperOS 3'lü bir Xiaomi](#hyperos-3lü-bir-xiaomi).
