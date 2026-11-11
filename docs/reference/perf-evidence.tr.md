# Ölçümler nasıl doğrulandı

[English](perf-evidence.md)

[Performans ölçümü](perf.tr.md) sayfasındaki her ölçümün bilinen bir maliyete karşı ne ölçtüğü, hangi cihazda, hangi gün ve hangi yük altında; yol boyunca neyin denenip bırakıldığı. Buradaki bir sayı okunduğu Mac'e göredir; aksi söylenmedikçe 15 çekirdekli bir M5 Pro. **Fixture**, bu projenin kendi test uygulamasıdır (`dev.appdyno.fixture`) ve istendiğinde bilinen bir maliyet ekler; **host yükü**, Mac'in 1 dakikalık yük ortalamasıdır.

## Hücre hücre ne denendi

Xcode 27.1, kabloda iOS 27.0.1, simülatörde iOS 26.5, 2026-11-03. Host yükü, ona bağlı olanın yanında.

**Açılış neden yavaştı, simülatör.** `--launch` ile App Launch kaydeder (host yükü 30'da 287 s) ve `life-cycle-period`'unda 0 satır vardır, yani onu boşaltan şey bağlanmak değildi. Onu okuyan, evre evre probe ve `simctl launch --wait-for-debugger`'ın ilk komutundan önce tuttuğu, kayıt başladığında `SIGCONT` ile bırakılan bir sürece bağlanan bir Time Profiler'dır (yük 14'te 16 s).

**Açılış neden yavaştı, iPhone.** `--launch` ile App Launch. Ayarlar 4 s içinde "Permission to debug com.apple.Preferences was denied ... signed with 'get-task-allow'" yanıtını verir ve ölçüm önce sorar, bu yüzden bir ret hiçbir açılışa mal olmaz.

**Kareler, donmuş kareler, duraklamalar, iPhone.** Bir kaydırmada ana thread'in 1 s'lik duraklaması tek bir Animation Hitches kaydında 50 ms'lik bir takılma ve 1,02 s'lik bir donma olarak görünür: yolda hiçbir kare yoktu, bu yüzden hiçbir şey gecikmedi. Orada donmuş kare, 700 ms ya da daha uzun bir takılma ya da donmadır; aynı anın ikisi bir kez sayılır. Sürekli düşük bir hız takılma değildir: her karede 40 ms harcayan bir liste, 0'a karşı %0 ile %4 arası takılan okundu, turda 400'e karşı 150 kareyle. Bu yüzden orada `frames.p95_ms`, `displayed-surfaces-interval` tablosundan bir karenin ekrandaki süresidir; 700 ms ya da daha uzun kalanı, yani kaydırmalar arasında duran ekranı ya da donmuş bir kareyi dışarıda bırakır.

**Sızıntılar, iPhone.** Leaks şablonu, bağlanarak. Tablosu `data/table` altında değil, `tracks/track/details/detail` altındadır ve sızan her nesne için bir satırı vardır. Heap'e ilk bakışı 10. saniyede gelir: 5 s'lik bir kayıt yapılan 3 retain cycle'dan 0'ını okur, 12 s'lik bir kayıt hepsini, bu yüzden 15 s kaydeder. Ayarlar "Unable to acquire required task port" yanıtını verir. Daha önceki bir deneme host yükü 400 ve üstünde hiç başlamadı; yük 7-24'te 18 s sürer.

**Ağ, iPhone.**

| biçim                                             | ne yaptı                                                                                                                                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network şablonu, durdurma ya da süre sınırı       | sonunda `xctrace`'i çökertir, `NetworkConnectionStatsModeling`, trace yok                                                                                                                                                                           |
| `--instrument "Network Connections"`, süre sınırı | aynısı, çıkış 133                                                                                                                                                                                                                                   |
| `--instrument "HTTP Traffic"`, süre sınırı        | kaydeder; HAR satırlarında `response.content.size`. Dışarıda bırakıldı: yalnızca URL Loading System'i kapsar ve Apple şifreli trafiği trace'te şifresiz sakladığını söyler                                                                          |
| Activity Monitor'ün tabloları                     | disk baytları, ağ sütunu yok                                                                                                                                                                                                                        |
| `--instrument "Power Profiler"`, bağlanarak       | **çalışıyor**: sürece göre `wifi-received` ve `cellular-received`, 5 s'lik dönemlerle: 5.000.000'luk bir indirme için 5.322.769 bayt (+%6,5) ve 10.432 gönderilen; istek doğrudan bu Mac'e gidiyor, yolunda proxy yok. `get-task-allow` gerektirmez |

`rvictl` ve `tcpdump` denenmedi: `/dev/bpf0` yalnızca root içindir.

**Enerji, iPhone.** Süreç başına tablo USB ya da şarj yüzünden değil, `--all-processes` yüzünden boştu: bağlanarak, aynı enstrüman kabloda ve şarj olurken (`DeviceChargingState`'in satırı vardır ve `SystemPowerLevel`, Apple'ın o durumda okuduğunu söylediği gibi saatte %0,0 okur) onu doldurur. `cpu-impact` boştayken 0, meşgul bir çekirdekte 19 okudu. Şablonun tamamı `--all-processes` ile başarısız olur ("The Location Energy Model instrument doesn't support profiling All Processes") ve bağlanıldığında durdurmada çöker, çıkış 133, bu yüzden yalnızca enstrüman kullanılır. Yalnızca bir Instruments puanı, yani joule yok. Cihazdaki Performance Trace denenmedi: bir insanın elini ister ve iOS 27'nin sürüm notları o widget'ın bu trace'leri üretemediğini listeler (184729556).

**Enerji, emülatör.** `dumpsys battery unplug`, 9 s meşgul bir çekirdek: `Computed drain: 0`, uygulama için satır yok ve `UID 1000: cpu=0 (1s 906ms)`. Güç profili tamamen sıfırdır, bu yüzden burada model kullanılır.

**Enerji, Android telefon.** Yüksek bir düzeyde ya da bir şarjdan sonra prizden çekmek, son şarjdan bu yana olan sayımı sıfırlar. 100 düzeyindeki bir emülatörde `Time on battery` bir sonraki çekişte 8 s'den 1 s'ye döndü; önce `dumpsys batterystats enable no-auto-reset` çalıştırıldığında 13,3 s, 14,5 s, 18,7 s diye ilerledi. Bu yüzden önce koruma gelir ve "Enabled" yanıtını vermeyen bir build prizden çekilmez, model kullanılır. Xiaomi'de, 100 düzeyinde ve doluyken, araç üzerinden üç enerji okuması sayımın sürmesine engel olmadı: 24,6 s, 31,4 s, 38,5 s, 45,9 s. `--usage` ve `--charged <pkg>` Xiaomi'de aynı okudu (2,84 ve 2,83 mAh); `--usage` daha kısa olanıdır.

**Trace aracı ve çalışan bir süreç.** Bir telefonda `--attach` zaman zaman çalışan bir süreç için "Cannot find process for provided pid" yanıtını verir: aynı pid 100 s bulunmaz, sonra bulunur, hangi yolla adlandırılırsa adlandırılsın. Bağlanma gerektiren şey 3 dakika boyunca her 5 s'de yeniden bakar.

**Trace aracı ve kendi trace'leri.** Bir sürece bağlanan bir kayıttan sonra araç, süreç aynı pid altında çalışırken, her şablonda, yaklaşık 3 dakika boyunca onun için `Cannot find process` der; burada 189 ve 196 s. Bağlanan ikinci bir ölçüm bunu 240 s'ye kadar bekler ve bir TIMEOUT bunu söyler. Xcode 27.1'in `xctrace export`'u bir trace'i yüklerken ara sıra ölür: kendi `TrackElaboratorQueue`'su üzerindeki bir sıralamadan gelen `NSInvalidArgumentException`, o sırada serbest bırakılmış bir adreste ne duruyorsa onu adlandırır (`XRAnalysisCoreQueryTicket`, `OS_dispatch_group`). Hiçbir sorgu bundan kaçınamaz: bir trace'in tablo listesini okurken de öldü. Bir Activity Monitor trace'inde `activity-monitor-process-live`'ın 242 okumasından 3'ü öldü, ilki başka hiçbir şey çalışmazken; dosyanın bir sonraki okuması her seferinde çalıştı. Bir sinyalle ölen okuma 3 okumaya kadar yeniden yapılır: bununla, böyle 2 ölüm yaşanan 200 okumanın 200'ü de geri geldi.

## Bir Baseline Profile

Profilli ve profilsiz açılışlar sırayla ölçülür. Önce birinin hepsini, sonra ötekinin hepsini ölçmek Mac'in kaymasını profilin etkisi sanar: bu şekilde her birinden 8 açılış hafif bir ekranda profilsiz 181 ms, profille 249 ms ölçüldü; 150 Compose kontrollü bir ekran ise sırayla ölçüldüğünde profilli her açılışı profilsiz her açılıştan kısa ölçtü. Bu yüzden bir değişikliğe [kapının](perf.tr.md#kapı) sıra testi ve tabanıyla karar verilir; çalıştırmaların birbirinden nasıl uzaklaştığı için bir terim yoktur, bunu sırayla ölçmek zaten karşılar.

`cmd package compile --reset`, broadcast'in yazdığı bir profili siler: 34.371 kural 0'a indi ve ardından bir `speed-profile` derlemesi Success yanıtını verip `verify`'da kaldı. Bu yüzden profil her turdan önce yeniden girer; ne ProfileInstaller'ı ne de `.dm`'si olan bir uygulama hiçbir şey derlenmeden ölçülmek yerine reddedilir. Bir `.dm`'den gelen profil sıfırlamadan sağ çıkar. Android 17'nin sıfırlaması onu tutar ve onunla hiçbir şey derlemez, bu yüzden `.dm`'nin derlediği bir uygulama her ölçümden sonra yeniden `speed-profile`'da derlenir ve ardından `reason=cmdline` okur. Uygulama, bir kurulumun bıraktığı gibi biter; kullanımda topladığı bir profil de bununla gider.

`device-tests/baseline-profile.test.ts` ile, API 34'lü bir emülatörde, host yükü 6-9, fixture'ın release build'i; ilk karesi 150 Compose kontrolüdür ve Compose'un kütüphanelerinin getirdiği kuralları tutar:

| kurulan             | var   | cihazda                                                   | profilsiz | profille | karar      |
| ------------------- | ----- | --------------------------------------------------------- | --------- | -------- | ---------- |
| APK                 | evet  | `status=verify reason=install`, uygulanmamış              | 254 ms    | 148 ms   | %43, değer |
| `.dm`'siyle         | evet  | `status=speed-profile reason=install-dm`, uygulanmış      | 248 ms    | 170 ms   | %33, değer |
| başkasının `.dm`'si | evet  | `status=verify reason=install-dm`, hiçbir şey derlenmemiş |           |          |            |
| `com.android.shell` | hayır | `status=verify reason=prebuilt`                           |           |          | APK'da yok |

2026-11-08'de API 37'li bir emülatörde aynı test geçti; başka bir aralığın `.dm`'si kurulumda reddedildi. Bir emülatörün süreleri bu Mac'e göredir ve bir telefonun ne kazandığı ölçülmedi: ProfileInstaller denenen tek telefonu reddetti. İki sayı `launch-baseline-profile` senaryosu altında `launch.without_profile_ms` ve `launch.with_profile_ms` olarak saklanır.

## Kapı

**Neden bu yöntem.** Bir çalıştırmanın örnekleri onun yükünü ve ısısını paylaşır, bu yüzden değişmemiş bir uygulamanın iki çalıştırması "anlamlı" biçimde farklıdır. Değişmemiş çalıştırmaların 72
sıralı çiftinde, tek başına bir sıra testi ve tek başına medyanlarda %10'luk bir fark şu kadar alarm verirdi:

| cihaz, temiz çalıştırmalar                          | çiftler | yalnızca sıra testi | yalnızca medyanların %10'u | kapının kararları, 6 çalıştırma |
| --------------------------------------------------- | ------- | ------------------- | -------------------------- | ------------------------------- |
| Android emülatörü, yük 9-16'da 6 çalıştırma         | 30      | 10                  | 24                         | 0                               |
| iOS simülatörü, yük 9-13'te 5 çalıştırma            | 20      | 2                   | 0                          | 0                               |
| iPhone, herhangi bir host yükünde 9 çalıştırma      | 72      | 10                  | 9                          | 0                               |
| iOS simülatörü, daha önceki 9 çalıştırma, yük 10-15 | 72      | 28                  | 25                         | 0                               |

Değişmemiş uygulamanın çalıştırma medyanları: emülatör 371-667 ms, simülatör 1.661-1.705 ms, iPhone 554-626 ms. Bir emülatörde aynı açılış,
15 çekirdekte yük 11 ile 16 arasında, dakikalar arayla 350 ms ve 700 ms okudu, yük 41'deki bir baseline çalıştırması da 1.661 ms okudu; bu yüzden çekirdek başına host yükü
0,8'in üstünde olan bir çalıştırma gürültülü işaretlenir ve baseline'ın dışında bırakılır. Bir telefonun Mac'te ölçülen sayısı da öyledir (bir iPhone'un açılışı, okuduğu ilk ekrana kadar), telefonun kendisinin bildirdiği değil.

Neden aralıkları yerine çalıştırma medyanlarının 4 standart sapması, `scripts/perf-floor-sim.mjs`'ten (kendiliğinden %6 oynayan bir çalıştırma, açılış başına %5
gürültü, 6 açılış, 400 deneme): yanlış alarmlar aralık için 3 baseline çalıştırmasıyla %3,0 ve 5'le %2,3, 4 sd için %0,8 ve %0,5; +%40'ı
%89 ve %91'e karşı %100 ve %99 yakaladı. %10'luk oynamada 3 çalıştırmayla hiçbir taban güvenli değildir (4 sd yine %5,8), bu yüzden yüklü bir host'ta daha çok çalıştırma kullanın ya da
daha sessiz bir host. Bunlar simüle edilmiş oranlardır; aşağıdaki cihaz çalıştırmalarının gösterdiği, her birinde 6 çalıştırmada yanlış alarm olmadığıdır, bir oran değil.

Neden p 0,01 ile 0,05 arası `noisy`, aynı betikten, kapının kendisiyle, 400 deneme: yavaş açılışı olmayan açılışlar önce ve sonra aynı okudu, hiçbir çalıştırma `noisy` değil. Bir simülatörünkiler gibi her on açılıştan birinin 1,5 ile 3 kat uzun sürdüğü yerde, değişmemiş bir çalıştırma eskisi gibi `regression` okudu, 3 baseline çalıştırmasıyla %2,0 ve 5'le %0,5, `noisy` ise %0,3 ve hiç; `ok` olarak zamanın %24,0'ında ve %16,5'inde geçen %40 daha yavaş bir çalıştırma artık %9,0 ve %1,5 daha fazla durur. Çalıştırma başına 5 örnekli sayımlarda, 0,5'lik bir tabanda, değişmemiş bir sayım en çok %1 daha fazla `noisy` olarak durur, hiçbir zaman daha fazla `regression` olarak değil. Bant olmadan, tabanı aşan doğrulanmamış her kaymayı durdurmak bu sayımların %5'ine kadarını durdurdu.

Neden bir sayımın tabanı 0,5'tir: aynı betikten, kapının kendisiyle, Poisson yasasına uyan sayımlarda, 3 baseline çalıştırması, 400 deneme. 1'lik bir tabanda sıfırdan bir artış her seferinde `ok` okudu, yani her çalıştırmada bir çökme geçti. 1'in altında asla `ok` okumaz: çalıştırma başına bir örnekle `few-samples`, çıkış 1, 5'le `regression`. Bunun, çalıştırma başına bir örnekli değişmemiş bir sayıma maliyeti daha çok durmadır, hepsi de `few-samples`: çalıştırma başına 0,1 oranında %0 ile %6, 0,5'te %4 ile %12, 1'de %4 ile %7, 2'de %5 ile %10, 3'ten yukarı ise değişiklik yok. 0,25, 0,5 ve 0,75 tabanları denemeler içinde aynı okur: tam sayımlarda bir oynama en az yarımdır.

**Kabul testleri** (`device-tests/perf-compare.test.ts`; sayılarını, çalıştığı makinede `.ci/perf-gate.txt` dosyasına yazar), çalıştırma başına 6 açılış,
3 çalıştırmalı bir baseline, 6 değişmemiş çalıştırma, ardından fixture'ın başlangıcı bilinen bir miktar yavaşlatılarak:

| cihaz             | baseline medyanı | değişmemiş çalıştırmalar     | yanlış alarmlar | başlangıca eklenen | karar                        |
| ----------------- | ---------------- | ---------------------------- | --------------- | ------------------ | ---------------------------- |
| Android emülatörü | 491 ms           | 366-764 ms, taban 509 ms     | 6'da 0          | 800 ms             | regression, +553 ms, çıkış 1 |
| iOS simülatörü    | 1.673 ms         | 1.659-1.787 ms, taban 251 ms | 6'da 0          | 1.000 ms           | regression, +983 ms, çıkış 1 |
| iPhone 13 Pro Max | 563 ms           | 553-620 ms, taban 84 ms      | 6'da 0          | 400 ms             | regression, +471 ms, çıkış 1 |

2026-11-03'te iPhone'un kapısı bir kez geçti; bir başka seferde, Mac'te başka işler varken host yükü 10-38'de, değişmemiş bir çalıştırmayı değişiklik saydı: 540,5'e karşı 623 ms, 81'lik bir tabanın üstünde 83,5'lik bir kayma. Üçüncü bir seferde 5 değişmemiş çalıştırmanın 5'i ok çıktı, sonra host yükü 100'ün üstündeyken bir saatlik sınırına ulaştı. Yani 6'da 0, o çalıştırmaların gösterdiğidir, bir oran değil. Taban olduğu gibi bırakıldı.

Bir Xiaomi'de kapı karar vermedi: cihaz yükü her seferinde 14-16 okudu, 8 sınırının üstünde (`packages/perf/src/record.ts` içindeki `DEVICE_LOAD`), çalıştırması da baseline olmadan `new` yanıtını verdi. Boştayken, tek bir görev çalışırken 14,31 ve `procs_blocked` 0 okudu: yük, kesintisiz uykudaki 14 çekirdek thread'iydi (`wdtk-0`'dan `wdtk-7`'ye, `hang_detect`, `ccci_poll` ve diğerleri); Linux bunları CPU kullanmasalar da sayar ve orada `/proc/pressure/cpu` shell'e kapalıdır. Bu sayıyı yükten çıkarmak yetmedi: 2026-11-05'te aynı telefon bir çalıştırmanın sonunda 22,6'lık bir yük okudu, böyle 14 thread'in 8,6 ötesinde; 800 ms'lik bir duraklama da değişiklik sayılmadı. Kendi haline bırakıldığında, yükü 24-26'dayken CPU'sunun %4-7'sinin çalıştığını okudu. Bu yüzden bir kayıt, bir çalıştırma biterken tüm çekirdeklerin 2 s içindeki çalışma payını `/proc/stat`'tan tutar: %80'in üstü `high-device-load`'dur ve yük yalnızca bu okunamadığında karar verir. %80, boştayken %6 ile çalışırken %99 arasında bir yargıdır ve gerçek çalıştırmalar %4-50 okur. Bununla aynı duraklama, Mac yük 218'deyken, +645 ms ile değişiklik sayıldı. 2026-11-04'te, host yükü 250-370'te çalıştırıldı: 900 ms'lik bir baseline, 135 ms'lik bir tabana karşı 837-928 ms'lik 6 değişmemiş çalıştırma ve yanlış alarm yok, eklenen 800 ms ise gerileme sayıldı, +723,5 ms, çıkış 1. Bir Android telefonun açılışları bu testte Mac'i beklemez, çünkü `am start -W`'nin bildirdiği telefonunkidir. Bir iPhone'unkiler bekler: süresi runner ilk ekranı okuyana kadar sürer ve sakin bir Mac'te 550 ms, host yükü 100-600'de 1,3-3 s okudu. 2026-11-04'te kısaltılmış kapısı yük 57-125'te altı değişmemiş çalıştırmadan birini gerileme saydı, 1.015 ms'lik bir tabanın 83 ms ötesinde; yük 50-370'te ise eklenen 400 ms'yi 370 ms'lik bir tabanın altında kaçırdı: o yükte iki yönde de hiçbir şey söylemez.

Android 14'lü bir Samsung SM-A525F diğer sayıyı gizler: `/proc/loadavg` görevler çalışırken `0.00 0.00 0.00` okur, bu yüzden yükü sakin bir cihaz gibi değil `?` olarak görünür ve işi CPU basıncındaki sınır yapar. Xiaomi'de kapalı olan `/proc/pressure/cpu`, bu çalıştırmalar boyunca 40'lık bir sınıra karşı 2,3 ile 6,1 arası okudu. 2026-11-04'te `device-tests/journey.test.ts` ile, host yükü 46-293, bir adıma eklenen 700 ms `regression journey.04_tap_id_load.ms: 1695 ms against 1054, +676 ms, p 0.0002` okudu, değişmemiş bir çalıştırma da 158 ms'lik bir tabanın altında +83 ms ile `ok`. Isıl durum baştan sona 0 okudu. İki telefonda da dökümünün onuncu satırındadır ve o güne kadar yalnızca beşi okunuyordu, bu yüzden hiçbir telefon henüz `hot-device` sayılmamıştı.

Eklenen bir değişiklik, o cihazın çalıştırmalarının kendiliğinden yaptığını aşmak zorundadır, bu yüzden yüklü bir simülatörde daha küçüğü değişiklik sayılmaz:
yanında tabanıyla `ok` olarak bildirilir. Bir emülatörde çok hızlı bir açılışın başındaki bir uyku yalnızca kısmen görünür: eklenen 400 ms
yaklaşık 230 ms ekledi, çünkü sistemin kendi başlangıç işi onunla yan yana çalışır.

## Saklanan trace'ler

`xctrace`'in bıraktığı kalmaz: her kayıt kullanıcının geçici klasörüne 0,7 GB'a kadar bir `instruments*.ktrace` yazar ve orada bırakır; `TMPDIR` de kabul etmez, çünkü kendine ait bir klasör verilen bir kayıt yine her zamankine yazdı. Bu yüzden bir kayıt, sonucunun ardından, ne zaman yapıldığına ve aracının neyi tuttuğuna bakarak yaptığını siler; bunu araçtan uzun yaşayan `DTServiceHub` bıraktıktan sonra yapar: yük 60'ta 4-12 s, bir kez de 150 s'nin ötesinde. O `DTServiceHub` aracın çocuğudur ve launchd onu araçtan sonra tutar, burada bir bitişten sonra dakikalarca, bir öldürmeden sonra 15 dakika, 58'ini de günlerce: kayıt, araç bitince onu aracın çocuğuyken sahip olduğu pid ile bitirir. Herhangi bir sürecin açık tuttuğu kalır. Başka bir kayıt ya da Instruments çalışırken yalnızca bu çalıştırmanın tuttuğu gider. Açık kalan ya da appdyno'nun kendisiyle birlikte öldürülen bir çalıştırma durum klasöründe bir satır bırakır ve bir sonraki kayıt onu tamamlar. `device-tests/trace-temp.test.ts` ile, Xcode 27.1 ile bu Mac'in kayıtlarında, yük 10-100'de: bir kayıt, `xctrace`'i `SIGKILL` ile öldürülen bir kayıt ve hiç appdyno kalmamış bir kayıt, her biri bir sonraki kayıtta silinmişti ve ilkinin trace'i yine okundu.

Daha önceki bir sürüm bir bağlamın kendi çalıştırmalarını okuyup durum klasöründen siliyordu; böylece çalıştırması olmayan bir bağlam her trace'i serbest görüyordu ve birim testleri onu bu Mac'in gerçek klasöründe çalıştırdı. Onu yalnızca sınır durdurdu. Bu yüzden bir birim testinin artık kendine ait bir durum klasörü vardır ve `packages/appdyno/test/no-real-state.setup.ts` her worker'daki her dosya çağrısını izler: `~/Library/Caches/appdyno` üzerindeki bir çağrı hata fırlatır ve hata yutulsa bile çalıştırmayı sonunda başarısız kılar. İki yönden de kanıtlandı: temiz bir çalıştırma 0 ile çıkar, yutulan bir okuma çağrıyı adlandırarak 1 ile çıkar.

## Yavaş bir kare neden yavaştı

Fixture'da her kareye bilinen 100 ms verilerek, `device-tests/frame-cause.test.ts` ile, Xiaomi'de, Android 16, host yükü 19-22 (telefonun kendi trace'i):

| her karedeki bilinen maliyet                   | adlandırılan                            | okunan                    |
| ---------------------------------------------- | --------------------------------------- | ------------------------- |
| başka bir thread'in 100 ms tuttuğu bir monitör | bir monitör kilidi, tutan ve metodu     | kare başına 91,6 ms, %96  |
| 100 ms süren bir sürece senkron bir çağrı      | o sürece binder çağrıları               | kare başına 102,3 ms, %97 |
| 100 ms boyunca bellek ayırmak                  | çöp toplayıcı                           | kare başına 93,9 ms, %84  |
| 100 ms'lik bir döngü                           | ana thread'de çalışma                   | kare başına 101 ms, %99   |
| 40 ms'lik bir uyku                             | tutan hiçbir şey adlandırılmadan uykuda | kare başına 40,4 ms, %94  |
| hiçbiri                                        | hiçbir şey: kaçırılan kare yok          |                           |

Binder durumunun ilk sürümü 100 ms'yi bir framework çağrısında geçirdi ve yanıt ana thread'de çalışmayı adlandırdı: 89 ms istemcinin kendisinindi, 14 ms binder çağrısının. Bu yüzden uygulamanın sürecinde yavaş olan bir framework çağrısı çalışma olarak adlandırılır, ki öyledir.

## Bir donma neden donmaydı ve hangi fonksiyon değişti

`device-tests/measures-iphone.test.ts` ile, iPhone'da, iOS 27.2: 500 ms'lik bir uyku engellenmiş okundu, 513,6 ms, CPU'da %2,3; 500 ms'lik bir döngü meşgul okundu, 505,2 ms, %100, `busyMainThread()` içinde.

`xctrace symbolicate --dsym`, o telefonun trace'i ve içindeki build'in tam kendisinin dSYM'si için, UUID'si UUID'sine uyarken, paket, klasörü ya da DWARF dosyası verildiğinde "No dSYMs were found or relevant" yanıtını verdi. Simülatörde yalnızca bir birim testinde çalıştı.

`device-tests/function-diff.test.ts` ile, Xiaomi'de, host yükü 13: aynı işin iki çalıştırması hiçbir şey adlandırmadı ve bir fonksiyona saniyede konan 300 ms, farkın ilki olarak `+296 knownCost` okundu.

## Neden kötüleşti

Bilerek konana karşı, `device-tests/gate-why.test.ts` ile, 2026-11-04'te, her biri 5 yinelemeli 3 çalıştırmalık bir baseline (bir başlangıç için 6 açılış) ve bir referansla; API 34'lü bir emülatörde ve iOS 26.5'li bir iPhone 17 simülatöründe, ikisi de test için oluşturuldu, 15 çekirdekte host yükü 6-10. Maliyet bir adımda ya da başlangıçta 800 ms'dir; aynı fixture build'i onu bir dosyadan ya da ortamdan okur:

| cihaz     | konan                                   | kapı                                                 | yanıt                                                             |
| --------- | --------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| emülatör  | hiçbir şey                              | gerileme yok, çıkış 0                                | hiçbir şeye bakılmadı                                             |
| emülatör  | `knownCost` içinde çalışan ana thread   | +616 ms, p 0,0002, çıkış 1                           | `CpuActivity.knownCost`, adımda +710 ms CPU, 0'dan 710'a          |
| emülatör  | bir dokunuşta uyuyan ana thread         | +616 ms, p 0,0002, çıkış 1                           | fonksiyon yok, kaçırılan kare yok: hiçbir neden bulunamadı        |
| emülatör  | `Application.onCreate` içinde bir uyku  | +815,5 ms, p 0,00005, çıkış 1                        | `bind_application` evresi, +810,5 ms, 8,8'den 819,3'e             |
| simülatör | hiçbir şey                              | gerileme yok, çıkış 0                                | hiçbir şeye bakılmadı                                             |
| simülatör | `knownCost()` içinde çalışan ana thread | +318 ms, p 0,0002, tabanının hemen ötesinde, çıkış 1 | `knownCost()`, adımda +800 ms CPU, 0'dan 800'e                    |
| simülatör | bir dokunuşta uyuyan ana thread         | +327 ms, p 0,0002, tabanının hemen ötesinde, çıkış 1 | fonksiyon yok: hiçbir neden bulunamadı ve bir probe nedeni görmez |
| simülatör | uygulamanın `init`'inde bir uyku        | +792 ms, p 0,00005, çıkış 1, host üzerinden ölçüldü  | `main` evresi, +805,6 ms, 13,7'den 819,3'e                        |

Bir adımın süresi konan 800 ms'den daha az yükseldi, simülatörde 318 ms, profil ise neredeyse hepsini okudu: ikisinin neden farklı olduğuna bakılmadı.

Gerçek telefonlarda, 2026-11-05'te, aynı testle; iOS 27.2'li bir iPhone'da Release fixture, Android 16'lı bir Xiaomi 25078RA3EY'de debug fixture. Baseline'ları 3 çalıştırmaydı, iPhone'da trace'li tek bir başlangıçtan 5. Mac, üzerinde başka işler varken iPhone için yük 13-60'ta, Xiaomi için 13-355'teydi:

| cihaz  | konan                                   | kapı                                        | yanıt                                                                                |
| ------ | --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| iPhone | hiçbir şey                              | gerileme yok, çıkış 0                       | hiçbir şeye bakılmadı                                                                |
| iPhone | `knownCost()` içinde çalışan ana thread | +578 ms, p 0,0002, çıkış 1                  | `knownCost()`, +791 ms CPU, 0'dan 791'e; 809,5 ms'lik bir donma, meşgul, onun içinde |
| iPhone | bir dokunuşta uyuyan ana thread         | +642 ms, p 0,0002, çıkış 1                  | fonksiyon yok; 835,6 ms'lik bir donma, engellenmiş, CPU'da %3,9, `main` içinde       |
| iPhone | uygulamanın `init`'inde bir uyku        | `main` evresi, +805,2 ms, p 0,0077, çıkış 1 | `main` evresi, +804 ms, 11,9'dan 815,9'a                                             |
| Xiaomi | hiçbir şey                              | gerileme yok, çıkış 0, Mac yük 355'te       | hiçbir şeye bakılmadı                                                                |
| Xiaomi | `knownCost` içinde çalışan ana thread   | +645 ms, p 0,0002, çıkış 1, Mac yük 218'de  | `CpuActivity.knownCost`, +521 ms CPU, 0'dan 521'e, değişikliğin %81'i                |
| Xiaomi | bir dokunuşta uyuyan ana thread         | +646 ms, p 0,0002, çıkış 1                  | fonksiyon yok: hiçbir neden bulunamadı                                               |
| Xiaomi | `Application.onCreate` içinde bir uyku  | +884,5 ms, p 0,0003, çıkış 1                | `bind_application` evresi, +762,1 ms, 130,3'ten 892,4'e, değişikliğin %86'sı         |

| cihaz  | konan                                   | kapı                                                                       | yanıt                                                                                                                               |
| ------ | --------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Xiaomi | bir listenin her karesi 40 ms daha uzun | karelerin %28'i takılan, 0'a karşı; p95 8'e karşı 89 ms, p 0,0002, çıkış 1 | `HeavyListActivity.heavyFrame`, saniyede +857,3 ms CPU, 0'dan 857,3'e; 138 yavaş kare ana thread'de çalışırken, kare başına 42,3 ms |
| Xiaomi | ana thread dışında çalışan bir çekirdek | `cpu.percent` 0'a karşı 48,1, p 0,0077, çıkış 1, Mac yük 180'de            | `CpuActivity.knownCost`, saniyede +490,3 ms CPU, 0'dan 490,3'e                                                                      |
| iPhone | bir listenin her karesi 40 ms daha uzun | `frames.p95_ms` 37,5'e karşı 75 ms, p 0,0002, çıkış 1                      | `FramesScreen.Animator.tick(_:)`, saniyede +836,3 ms CPU, 0'dan 836,3'e                                                             |
| iPhone | ana thread dışında çalışan bir çekirdek | `cpu.percent` 0'a karşı 51, p 0,0077, çıkış 1                              | `knownCpuCost(_:)`, saniyede +354,3 ms CPU, 0'dan 354,3'e                                                                           |

Bir iPhone'da sayı Activity Monitor'ün kendi `cpu-percent`'idir. Her saniyenin %12,5, %25, %50 ve %75'inde tutulan bir çekirdek 12-16, 24-28, 47-52 ve 71-76 okudu. `cpu-total`'ı bir satırın sonunda gelir ve ilk satır kısadır, bu yüzden satırların başlangıçlarına göre hesaplandığında aynı çekirdek 20-27, 42-52 ve 82-93 okudu. Profilin o çekirdekteki payı düşüktür, gerçek 500'ün 354 ms'si; bu açıklanmadı. Bir CPU sayısı her biri tek örnekli beş anlık görüntü alır. Uygulama ilkinden önce durulmuş olmalıdır: kendi başlangıcındaki bir örnek, sonrasındaki 0'a karşı %46,7 okudu; böyle tek bir çalıştırma da kapının çalıştırmadan çalıştırmaya sınırını 48'lik bir değişikliğin ötesine genişletir; bu, kapının baseline olmayan bir baseline konusunda haklı olmasıdır. Bir telefonun ekranı da beş anlık görüntünün sürdüğü zamanda kararır ve karanlık bir ekranın arkasındaki uygulama aynı uygulama değildir, bu yüzden test onu her seferinde bir tuşa basarak uyandırır.

Bir iPhone'da bir kaydırma 5 tur için yaklaşık 10 dakika sürer. Her tur liste kayarken yeni satırlara geçer, bu yüzden 60 satırlık bir liste ilk turunda biter ve geri kalanı liste geri getirildikten sonra çalışır. Üzerinde açık bir yansıtmayla saatlerce trace'ten sonra sıcak okuyan (thermal 2) bir telefon `hot-device` ile reddedilir: böyle bir seferde ağır liste %0,5'e karşı %32,5 takılan okudu ve haklı olarak değişiklik sayılmadı.

[`perf-gate.yml`](../examples/perf-gate.yml) kendi `run:` bloklarıyla, sırayla, bu Mac'te ve iOS 27.2'li bir iPhone 17 simülatöründe, yük 7 ile 13 arasında, `gh` taklit edilerek ve `actions/*` adımları atlanarak çalıştırıldı: baseline'a üç çalıştırma, yalnızca head'in çalıştırmasına konan 800 ms; kapı job'ı +797 ms ile başarısız kıldı ve yorum yine de yazılıp `gh`'ye verildi. Maliyet bakışta değil ölçülen çalıştırmada olduğu için yanıt, değişikliğin yeniden görünmediğini söyledi ve hiçbir şey adlandırmadı; buna verilecek dürüst yanıt budur. Yeni açılmış bir simülatördeki daha önceki bir deneme base'de durdu, 8 çalıştırmanın 8'i yük yüzünden reddedildi ve yine de yorumunu yazdı: "1 of 1 scenario not called". Bunun job'a eklediği yük beklemesi job içinde değil, kendi başına çalıştı. **Çalıştırılmadı:** bir GitHub runner'ında ve bir Intel runner'ında Android job'ı.

## Bir uygulama neden başladı

Bir çalıştırma, bu telefonda ve bu anahtar için okuduğu en yeni başlangıcın damgasını tutar; bir başlangıç o değilse yenidir, böylece hiçbiri iki kez saklanmaz ve hiçbir saatin bir başkasıyla uyuşması gerekmez: bir Xiaomi bir başlangıcı uykuda duran saatle, bir servisin başlatılmasını önyüklemenin saatiyle damgalar, o zamana kadar aralarında 29 saat vardır, bu yüzden ikisi arasındaki bir boşluk bir evre değildir. Sistem orada 16 başlangıç tuttu. Dökümün 2 numaralı indeksi `Application.onCreate`'in başladığı andır: `onCreate` içine konan bilinen 500 ms, Xiaomi'de `oncreate_to_first_frame`'i 386,9'dan 874,8 ms'ye çıkardı, +488 ms, host yükü 5-108, `device-tests/start-info.test.ts` ile. API 36'lı bir emülatörde, host yükü 170-340'ta, aynı uyku kısmen göründü, orada bir uykunun göründüğü gibi. Bir launcher başlangıcı `LAUNCHER`, kendi sürecindeki bir servis `SERVICE` okudu. Durdurulmuş bir uygulamaya giden bir broadcast emülatörde `BROADCAST` okudu; HyperOS o broadcast'i tamamlar ve hiçbir şey başlatmaz, bu yüzden bir Xiaomi'de böyle bir kayıt yoktur.

## Bir yolculuk

Bilinen bir maliyete karşı, `device-tests/journey.test.ts` ile, Xiaomi'de, Android 16, 2026-11-04, 15 çekirdekte host yükü 27-33: 5 yinelemeli 3 çalıştırmalık bir baseline, hepsi `ok` olan değişmemiş bir çalıştırma, sonra bir adıma eklenen 700 ms (`files/delayed_ms`): `regression journey.04_tap_id_load.ms: 1663 ms against 952, +709 ms, p 0.0002`, çıkış 1; başka hiçbir adım değişiklik sayılmadı. Mac üzerinden geçen (`stop`, `launch`, `assert`, bütün) o yükte baseline'ın dışında bırakıldı ve `new` okudu; telefonun kendisinin ölçtüğü adım ise yine de değişiklik sayıldı. Bir adımda tutulan 50 MB o adımın belleğinde +50,1 MB okundu; 40 ms'lik çizimleri olan bir adım kareleri p95 81 ms, en kötü 91 ms okudu, hafif bir adım için 10 ve 11'e karşı. iPhone'da, iOS 27.2: değişmemiş bir çalıştırma 1.819'a karşı 1.776 ms ile `ok` okudu ve adıma eklenen 700 ms yalnızca o adımda `regression journey.03_tap_id_open_delayed.ms: 2498 ms against 1819, +713 ms, p 0.0002`, çıkış 1 okudu.

## Tek bir zaman çizelgesi

**Ne çalıştırıldı.** Host yükü 31 ile 37 arasında ve yine 4'te bir Android 14 emülatöründe, `device-tests/timeline.test.ts`: 1 s'lik duraklamalı bir listenin yolculuğu 1005,7 ile 1010,5 ms'lik bir kare okudu ve video 1016,4 ile 1017,6 ms durdu; o karenin başlangıcının 1,6 ms yakınından sonunun 7,4 ile 13,4 ms sonrasına kadar. 800 ms'lik üç çizim duraklaması 807 ile 815 ms okudu, 1,8 ms ve 9 ile 18 ms içinde. Videonun damgaları üç kayıt boyunca, kare kare, bir oynatıcının okuduğuyla 0,1 ms'ye kadar eşleşti. Bir simülatörün videosunun kendi zamanı yoktur: her 100 ms'de değişen bir ekranda bilinen bir anda öldürülen bir uygulamaya karşı, yük 4 ile 7 arasında altı çalıştırma ilk karesini `start` yanıt vermeden 86 ile 279 ms önceye koydu, bu yüzden o andan 150 ms önce, 150 payla durur. Kimsenin ölçmediği bir kaydedici bunu sayfada söyler.

Telefonlarda, aynı testle: Android 16'lı bir Xiaomi 1 s'lik bir duraklamayı 1011,9 ms'lik bir kare olarak okudu, videosu 1018,1 ms durdu, 8,2 ve 14,4 ms içinde; Android 14'lü bir Samsung A52 1034,6 ve 1023,9 ms okudu, 20,3 ve 9,6 ms içinde. Host yükü 40 ile 50 arasındaki bir emülatör 1064,3 ms'lik bir kare okudu, 18,2 ve 36,1 ms içinde; sınırın 40 olmasının nedeni budur. Bir iPhone 13 Pro Max'in kareleri daha kötü yerleşir: 500 ms'lik üç duraklama 513 ile 516 ms okudu, her biri kendi dokunuşunun, yani 331 ile 427 ms'lik bir çağrının içinde başlayarak. Yayınının videosunun hiç sabit bir başlangıcı yoktur: uygulamayı çökerten bir dokunuşa karşı, host yükü 5 ile 33 arasında dört çalıştırma ilk karesini `start` yanıt vermeden 398 ms öncesinden 840 ms sonrasına kadar koydu, bu yüzden 220 ms sonra, 620 payla durur. HEVC'si Chrome'da sayfanın içinden oynar ve sarılır.

### Uçuş kaydedicisi

**Neye mal olur.** Android 16'lı bir Xiaomi'de, host yükü 13 ile 29 arasında, saniyede on kez değişen bir ekranda, sırayla açık ve kapalı 30 s'lik sekiz dönem boyunca, telefonun tüm CPU'sunu %10,4'ten %19,9'a çıkardı, belleğinin 158 MB daha azını boş bıraktı ve bu Mac'te bu araç için bir çekirdeğin %0,3'ünü, adb için %0,1 daha fazlasını aldı. Her saniye bakıldığında aynı çalıştırma %11,2 ile %28,5 okudu; bu kadar seyrek bakmasının nedeni budur. Her parça tek başına, o 1 s'lik bakışta okunarak: video yaklaşık 5 puan, `pidof` ve log yaklaşık 3, `gfxinfo` 1,6, Perfetto'nun halkası ve `meminfo` neredeyse hiç. Bunlar 5 s'de 9,5 puanın yaklaşık 6'sını eder; kalanı bir parçaya bağlanamadı. Bir Android 14 emülatörü yazılımla kodlar, bu yüzden bir telefon hakkında az şey söyler ve değeri host'una bağlıdır: host yükü 2 ile 7 arasında her saniye bakarak %3,3 ile %10,6, yük 19 ile 48 arasında her 5 s'de bakarak %14,2 ile %49 okudu, hiçbir sayfa kaydedilmeden. Bir iPhone burada halka ve video tutmaz ve tüm CPU'sunun okuması yoktur, bu yüzden maliyeti ölçülmedi. O hızla değişen ekranda tuttuğu 0,2 MB'tı.

**Ne çalıştırıldı.** Host yükü 3 ile 9 arasında bir Android 14 emülatöründe, kaydediciye ne olduğuna dair hiçbir şey söylenmeden `device-tests/timeline.test.ts`: fixture'ın çökme düğmesine bir dokunuş, kareler, video ve 27 log satırındaki `FATAL EXCEPTION: main` ile `a crash: APP CRASH(EXCEPTION)` sakladı; bir listedeki 1 s'lik duraklama `a stall of 1010 ms` sakladı; bir ana thread'in 1,5 s'lik bekletilmesi `a stall of its main thread` sakladı. 5 s'lik bakışta, host yükü 9 ile 17 arasında üçü de yine. Bir iOS 27.2 simülatöründe bir çökme `a crash: EXC_BREAKPOINT SIGTRAP` sakladı. Android 16'lı bir Xiaomi her saniye bakarak gerçek bir çökme, gerçek bir duraklama ve böyle bir bekletme sakladı. 5 s'lik bakışta, host yükü 10 ile 40 arasında, şunları sakladı: videosuyla `a crash: APP CRASH(EXCEPTION)`; 3 çalıştırmanın 3'ünde gerçek bir 1 s'lik duraklama, her biri 900 ms'nin üstünde bir kareyle `a frozen frame` olarak; 1,5 s'lik bir bekletme, loguna göre 1499 ms, `a stall of its main thread` olarak. Orada bir `record`, her biri altısının medyanı olarak, durgun bir ekranda 667 ms'de, hareketli birinde 650'de başladı, yani ilk kare için bekleyebileceği 2 s harcanmadı. Android 14'lü bir Samsung A52 gerçek bir çökme sakladı. 5 s'lik bakışta, host yükü 5 ile 6 arasında, 3 çalıştırmanın 3'ünde gerçek bir 1 s'lik duraklamayı `a stall of 1058 ms` ile `1278 ms` arasında sakladı; duraklama, kaydetme halkanın bir turundan sonra gelsin diye 12. saniyeye konunca da `a frozen frame`'i sakladı: videosu ve 444 karesiyle 22 s'lik bir aralık, en kötüsü 1037,5 ms. Ondan önce, host yükü 9 ile 83 arasında, 6 çalıştırmanın 2'sinde hiçbir şey saklamadı: bakış duraklamayı gördü ve kaydetme son parçasıyla, yani tek kodlayıcısının reddettiği parçayla, birlikte kayboldu. Bir iPhone 13 Pro Max gerçek bir çökme sakladı ve orada video ve kare tutmaz: aynı anda yalnızca bir yayını olabilir ve bir trace'in halkası yoktur, bu yüzden sayfa o satırların neden boş olduğunu söyler.

## Dashboard

Dashboard'un saklanan her çalıştırmadaki maliyeti, her biri 5 türlü 1.000 çalıştırmanın 7 yeniden yazımının medyanı, 15 çekirdekte host yükü 44-47 (bir ölçüm saniyeler sürer):

| anahtara göre çalıştırmalar | yeniden yazım | sayfa    |
| --------------------------- | ------------- | -------- |
| 1 anahtarda 1.000           | 5 ms          | 84 KB    |
| 40 anahtarın her birinde 25 | 101 ms        | 2.365 KB |
| 200 anahtarın her birinde 5 | 207 ms        | 3.547 KB |

## Play'in tanımlarına karşı

Bilinen maliyetlere karşı, `device-tests/vitals.test.ts` ile, Xiaomi'de, Android 16, 2026-11-04, host yükü 27-66 (bunlar telefonun kendi sayımlarıdır):

| bilinen maliyet                                                                            | okunan                                                      | söylenen                                                                                          |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 40 ms'lik çizimli 600 kare                                                                 | 16 ms'nin üstünde %92,6, onu başlatan dokunuşun kareleriyle | yavaş kareler olarak sayılırdı                                                                    |
| hafif çizimli 300 kare                                                                     | %0                                                          | sayılmazdı                                                                                        |
| 300'de bir 800 ms'lik kare                                                                 | 604 kare                                                    | donmuş kareler için söylenecek kadar kare yok                                                     |
| 4.000'de bir 800 ms'lik kare                                                               | 7.994'te 4, %0,05                                           | donmuş olarak sayılmazdı                                                                          |
| 1.500'de altı 800 ms'lik kare                                                              | 3.004'te 24, %0,8                                           | donmuş olarak sayılırdı                                                                           |
| yavaş bir başlangıç, `Application.onCreate` içinde 5,2 s                                   | 6.369 ms                                                    | yavaş bir soğuk başlangıç olarak sayılırdı ve o günün sonraki hızlı başlangıcında da hâlâ sayılır |
| sıcak bir başlangıç                                                                        | 110 ms                                                      | sayılmazdı ve iki sayfanın sınırlarını söyler                                                     |
| sistemin ANR'sinin ötesinde takılı tutulan bir ana thread'e dokunuş, uygulama toparlanıyor | dropbox'ta `Input dispatching timed out`, çıkış yok         | `userAnrs` +1, sayılırdı                                                                          |

Bu telefonun özeti her kareyi iki kez sayar (çizilen 4.000 için 7.994 kare) ve bir duraklama sonraki kareyi de bekletir, bu yüzden bir duraklama 700 ms ya da daha uzun 4 kare olarak okunur: %0,05'lik pay, çizilenin %0,025'idir. İki yanda da ikiye katlanınca tutar; Play'in kendi sayımının bir duraklamayı 2 kare sayıp saymadığı buradan denetlenemedi. Takılan kare sayısı ise her kareyi bir kez sayar; bu yüzden `perf_scroll` onu kare satırlarının payı olarak alır: özetin %42,86 dediği yerde 203'te 174.

Her biri tetiklendi ve geri okundu, `device-tests/exits.test.ts` ile, API 34'lü bir emülatörde, host yükü 8-13:

| neden olan                                         | okunan                                   |
| -------------------------------------------------- | ---------------------------------------- |
| `exitProcess(3)`                                   | `EXIT_SELF status 3`                     |
| `kill -9`                                          | `SIGNALED status 9`                      |
| arka planda `am kill`                              | `USER REQUESTED KILL BACKGROUND`         |
| `am force-stop`                                    | `USER REQUESTED FORCE STOP`              |
| çalışırken bir iznin `pm revoke` ile geri alınması | `PERMISSION CHANGE`                      |
| ana thread'de bir istisna                          | `APP CRASH(EXCEPTION)`                   |
| yeni bir kurulum                                   | kendi çalıştırmasından `PACKAGE UPDATED` |

Android 16'lı bir Xiaomi'de aynıları `SIGNALED status 9`, `APP CRASH(EXCEPTION)`, `EXIT_SELF status 3` ve `am kill` için başka bir şey olmadan `USER REQUESTED` okudu. Orada bir bağlantı durdurulmuş bir uygulamada hiçbir şey açmadı, bu yüzden bir çalıştırma önce onu başlatır. Öldüğü andaki bellek, sistemin tuttuğu yerde verilir: çıkışların çoğu `pss=0.00` okur ve bunlardan yalnızca yeni bir kurulumun bir sayısı vardı. Düşük bellek öldürmesi ve Android 17'nin bellek sınırlayıcısı tetiklenmedi: bu emülatörde hiçbir şey istenince birini oluşturmaz.

Tetiklenmiş bir ANR, `device-tests/vitals.test.ts` ile: sistemin sınırının ötesinde takılı bir ana thread'e bir dokunuş. API 34'lü bir emülatörde, host yükü 8-13, hiçbir iletişim kutusu yanıtlanmadı ve uygulama geri geldi, bu yüzden hiçbir süreç bitmedi ve exit-info'da hiçbir şey yoktur; dropbox'ın `data_app_anr`'si ise `Subject: Input dispatching timed out` tuttu. `crashes` onu o satırla bildirir ve `exits.user_anrs` bir arttı.

Bilinen maliyetlere karşı, `device-tests/surface.test.ts` ile, 60 Hz'te API 34'lü bir emülatörde, host yükü 10-12:

| çizim aralığı | okunan             | p50, p95         | sonuncusundan 50 ms ya da daha sonra | söylenen   |
| ------------- | ------------------ | ---------------- | ------------------------------------ | ---------- |
| 30 ms         | saniyede 33,5 kare | 33,3 ms, 33,3 ms | %0                                   | sayılmazdı |
| 40 ms         | saniyede 25 kare   | 33,3 ms, 50 ms   | %39,7                                | sayılırdı  |
| 60 ms         | saniyede 16,7 kare | 66,7 ms, 66,7 ms | %99,2                                | sayılırdı  |

60 Hz'te Android 16'lı bir Xiaomi'de, host yükü 24-59, aynı üçü saniyede 33,3, 25 ve 16,8 kare, %0,8, %41,3 ve %98,2 yavaş okudu. Orada `--list`, adı içinde olacak şekilde `RequestedLayerState{ad16944 SurfaceView[...](BLAST)#111504 parentId=...` yazdırır ve `/proc/uptime` bir telefonun uyuduğu zamanı sayar, bir sunumun saati ise saymaz (o telefonda aralarında 12 saat vardı); bu yüzden ikinci bir okuma karelerin hâlâ gelip gelmediğini söyler. Bir `TextureView` pencerenin içine çizilir ve kendine ait bir katmanı yoktur; uygulamanın pencerelerinin okuması yapılmaz: bir Flutter uygulamasının katmanı görülmedi, çünkü bu Mac'te Flutter SDK'sı yok.

Bilinen maliyetler, `device-tests/memory-play.test.ts` ile, 2026-11-04'te. Xiaomi'de, host yükü 93-96: 50 MB Java heap 50,5 MB, 50 MB native bellek 50,4 MB ve 50 MB'lık bir bitmap bitmap'lerde 50,1 MB ve anon bellekte 50,3 MB yükseldi; ana ekrana gitmek onu süreç durumu 2'den 15'e, 142,1 MB'tan 142,2 MB'a taşıdı. API 34'lü bir emülatörde, host yükü 39-93: aynı şekilde 50,3, 50,1 ve 50,4 MB. Orada `dumpsys meminfo` hiçbir bitmap listelemez, bu yüzden böyle bir sayısı yoktur ve yanıt 0 okumak yerine bunu söyler; 2.478 MB RAM'i de 3.200 MB'tan başlayan Play tablosunun altındadır, bu yüzden yanıt onu karşılaştıracak bir sınır olmadığını söyler. `service` ya da `cached` süreç durumu ayrıştırıcının testlerinden gelir: hiçbir cihaz çalıştırması böyle bir durum okumadı.

## Doğruluk

`device-tests/perf.test.ts` her ölçümü maliyeti bilinen bir fixture ekranına karşı denetler: çizimi yaklaşık 1 ms
ya da 40 ms süren 2 s'lik bir animasyon (kareler ve frame timeline), tutulan 50 MB Java heap (bellek,
%15 içinde), meşgul bir çekirdek (CPU, %80-125) ve sistemin kendi "Displayed" log
satırına karşı soğuk açılışlar (50 ms içinde).

## iOS

iOS 27.2'li bir iPhone 17 Pro simülatöründe, 15 çekirdekte 4 ile 8 arası host yükünde, 5 s 13,1 ile 13,8 s sürdü: aracın başlaması 1,6 ile 2,0 s, sınırı geçtikten sonra durması 3,4 ile 4,2 s, örnekleri dışa aktarması 1,8 ile 2,0 s. Bir kayıt ancak önceki kayıtların geçici klasörde bıraktıkları temizlendikten sonra başlarken 19,7 ile 25,9 s sürüyordu, çünkü bu temizlik bütün klasörü listeler: o Mac'te 1,5 milyon ad, listeleme başına 4,5 s, geride kalan her çalıştırma için bir tane; o çalıştırmalarda iki, hiçbiri kalmayan yerde hiç. O temizlik artık kaydın yanında sürer ve kayıt başladıktan sonra doğan hiçbir şeyi almaz.

`device-tests/ios-perf.test.ts` simülatör ölçümlerini fixture'da denetler: tutulan 50 MB (bellek,
%15 içinde), meşgul bir thread (CPU, %80-125 ve bir trace'ten profilin en üstteki uygulama fonksiyonu), sızıntı özetiyle
bir bellek grafiği, ılıktan yavaş soğuk açılışlar. `device-tests/iphone.test.ts` belleği, CPU'yu, bir profili, donmaları
ve Ayarlar'ın bir açılışını okur; bunların maliyeti bilinen bir denetimi, telefon için imzalanmış bir uygulama ister.

## Süre nereye gidiyor

Her çağrı parçalarına ayrıldı, aynı cihazlarda, sunucunun logundan ve aynı işlemlerin tek bir süreçte, her cihaz gidiş-dönüşü, yardımcı çağrısı ve alt süreç ölçülerek yapılan bir çalıştırmasından:

- Android: bir çağrının neredeyse tamamı ajanın işlemidir, dokunuş ve ardından ekranın durgun kalmasını bekleyen durulma. Sunucu emülatörde yaklaşık 10 ms ekler. Bir telefonda her işlemden sonra, uygulamanın işlem sırasında ölüp ölmediğini söyleyen bir `adb shell pidof` ekler: Samsung'da 44 ms. Bir kaydırmanın 300 ms'lik hareketini göndermek yaklaşık 600 ms sürer, çünkü her hareket uygulamanın onu almasını bekler; liste sonra durulma boyunca kayarak yavaşlar.
- iOS simülatörü: yardımcı ekranı 14-20 ms'de okur ve dokunuşları gönderir. Metin runner üzerinden, XCTest ile gider. Yeni bir sunucu ilk okumasında yardımcısını başlatıyordu, ilk okumanın yaklaşık 400 ms'si, ilk dokunuşunda da girdi yardımcısını: ikisi de artık cihaz adlandırılır adlandırılmaz başlar, [aşağıda](#bir-simülatörün-yardımcıları-ilk-çağrıdan-önce-başlatılır). `logs`, `simctl get_app_container`'dan (130-200 ms) sonra `log show`'dur (1,0-1,5 s).
- iPhone: her okuma runner'ınkidir, 170-300 ms. `screen` iki kez okur: uygulamayı, sonra uygulamanın hiçbir okumasının göstermediği bir Face ID ya da parola sayfası için ana ekran uygulamasını. Bir kaydırmanın listesi durulmanın 2,8 s'si boyunca kayarak yavaşlar.

Cihazın kendisine ait olmayan en pahalı üçü:

1. Bir metin girişi, odaklanmış alanı bir anlık görüntüyle arıyordu ve henüz odağı olmayan bir alanın anlık görüntüsü birinin belirmesini bekler: dokunuştan önce ve ondan sonra yine. Düzeltildi: önce alanın var olup olmadığını sorar (bu hemen yanıtlanır) ve eskisi gibi yoklar.
2. Bir iPhone'da bir `screenshot`, uygulamanın üstündeki bir sayfa için ana ekran uygulamasının ağacını da okuyordu: betiğin her çalıştırmasında yazmadan sonra 4,7 s'sinin 4,5 s'si, aynı telefondaki başka sıralarda 250-380 ms; farkı neyin yarattığı bulunamadı. `screenshot` için düzeltildi, çünkü böyle bir sayfa onun resmindedir: uygulamanın kendi denetimini korur ve ötesine bakmaz. `screen`, `launch_app` ve hiçbir şeyi değiştirmeyen bir işlem hâlâ bakar, bir iPhone'un `screen`'inin yaklaşık 200 ms'si: yalnızca sayfalar için bir sorgu daha ucuz olurdu ve yapılmadı, çünkü onu kanıtlayacak bir sayfa bu telefonda açılamadı.
3. `list_devices`, `simctl list`'i, sonra `devicectl list devices`'ı, sonra bağlı her iPhone'un kilidi için `devicectl`'i art arda çalıştırıyordu: hangi cihaz yönetilirse yönetilsin bu Mac'te 460-600 ms. Düzeltildi: her sürücünün engelleri o sürücü listelediğinde okunur ve simülatörlerle iPhone'lar iki ayrı sürücüdür, bu yüzden bir iPhone'un okumaları `simctl list`'in yanında başlar, bir Android telefonunkiler de artık onu beklemez. Kilit telefona sorar, bu yüzden yalnızca o listenin daha önce geçtiği bir takılışta telefonun listesiyle yan yana sorulur; bu, takılış için usbmuxd'nin numarasıyla diskte tutulur, çünkü bir oturumun ilk listesi kendi başına bir sunucudur. Yeni bir takılışta ya da başka herhangi bir yanıttan veya başarısız bir okumadan sonra kilit, eskisi gibi listeyi bekler. Yanıt her zaman şimdi okunan listedir, çünkü Developer Mode telefonda kablosu takılıyken de çıkarılmışken de kapatılır. `simctl` ve `devicectl` de `xcrun` üzerinden değil, geliştirici klasöründeki kendi yollarıyla çalışır; o araç her birini çağrı başına 3,8-4,9 ms arıyordu. Geriye kalan kilittir, `devicectl device info lockState`: 190-220 ms, yanında `simctl list` (85-115) ve telefonun listesi (155-185).

Düzeltme, sırayla önce ve sonra, her çalıştırmanın geri kalanı aynı:

| seçiciyle bir alana `type_text`  | önce (`49e073c8`) | sonra (`ab96deed`) | host yükü, önce; sonra |
| -------------------------------- | ----------------- | ------------------ | ---------------------- |
| iOS simülatörü, medyan / en kötü | 3.236 / 3.700     | 1.220 / 1.454      | 9,5-10,2; 8,4-9,9      |
| iPhone, medyan / en kötü         | 4.334 / 4.605     | 2.287 / 2.466      | 5,0-8,2; 5,1-6,5       |

Aynı çalıştırmalarda iPhone'un `screenshot`'ı, önce `49e073c8`'de ve sonra `b9c2bbf0`'da: 183 / 227'ye karşı 4.766 / 4.817. Simülatörde runner'ın kendi `focusMs`'i, dokunuştan alanın odağına, yük 30-150'de 2.904-3.680'den 760-1.374'e indi. Sırayla önce ve sonra çalıştırılan Android cihazlar ve diğer çağrılar yayılımları içinde aynıdır: düzeltme yalnızca iOS runner'ınındır.

Cihazları listelemek, önce `7d7e05d9`'da ve sonra `2f2ff0d8`'de, sırayla, 2026-11-08'de; USB'de bir iPhone 13 Pro Max, açık dört simülatör ve USB'de iki Android telefonla, bunlardan biri Wi-Fi ile iki kez daha listelenerek (9 satır). `list_devices`, bellek içi bir MCP istemcisi üzerinden sunucunun kendi süresidir: bir ilk çağrıdan sonra tek bir sunucuda 15'in medyanları, ilk çağrı yeni bir sunucunundur ve yanlarında verilir, iPhone'un daha önce geçtiği bir takılışta; daha önce görülmemiş bir takılışta ise saklanan takılış 7 yeni sunucunun her birinden önce silindi. iPhone olmadan Apple sürücüsünün telefonları dışarıda bırakıldı ve önce ile sonra sırayla çalıştı, 21'in medyanları. Hub'ın listesi tek bir süreçte `hubDevices`, `appdyno devices` ise her seferinde yeni bir süreç, ikisi de 15'in medyanları:

| ms, medyan (aralık)                            | önce          | sonra         | host yükü, önce; sonra |
| ---------------------------------------------- | ------------- | ------------- | ---------------------- |
| `list_devices`                                 | 456 (436-482) | 216 (200-223) | 6,7-7,3; 6,5-6,7       |
| `list_devices`, yine                           | 453 (442-503) | 208 (194-221) | 6,1-6,4; 5,8-5,9       |
| `list_devices`, yeni bir sunucunun ilk çağrısı | 455, 458      | 213, 215      | 6,1-7,3; 5,8-6,7       |
| aynısı, daha önce görülmemiş bir takılışta     | 455, 458      | 355 (353-430) | 6,1-7,3; 5,8-6,3       |
| `list_devices`, iPhone olmadan aynısı          | 260           | 140           | 5,4-5,6                |
| hub'ın listesi                                 | 104, 106      | 100, 103      | 6,1-6,7; 5,8-6,5       |
| `appdyno devices`                              | 185, 191      | 184, 189      | 5,9-6,7; 6,2-6,5       |

Yanıtlar önce ve sonra, satır satır aynıdır. Hub'ın listesi ve `appdyno devices` hiçbir cihaza onu neyin engellediğini sormaz, bu yüzden çoğu `simctl list`'tir; `xcrun`'ın aramasının kalkması onlardan 5,6 ve 2,5 ms düşürdü, 21'in eşli medyanları. `appdyno devices`'ın yaklaşık 90 ms'si, `appdyno --version`'ın aldığı gibi, node'un komutu başlatmasının kendisidir.

Denenip bırakılanlar:

- Bir iPhone'un `devicectl` listesini takılışı sürdükçe tutmak ve yalnızca kilidini sormak: yük 6,3-6,7'de, ikisi birden için 199'a karşı 191 ms. Developer Mode telefonda kablosu takılıyken de çıkarılmışken de kapatılır ve burada hiçbir şey Mac'in listesinin bunu ne zaman söylediğini kanıtlamadı, bu yüzden liste her seferinde okunur.
- Telefonun UDID'sinde `devicectl list devices --filter`: 160'a karşı 163 ms. `simctl list devices booted`: bütün listeden 1,2 ms daha az, 21'in eşli medyanı. İkisi de değmez.
- Bu Mac'e güvendiği hiç görülmemiş bir telefonun listesiyle yan yana sorulan kilit: ona güvenmeyebilecek bir telefona sorardı, bu yüzden yeni bir takılışta kilit yine bekler.
- Her işlemden sonraki `adb shell pidof` yerine, hemen yanıt veren Android ajanına sorulan uygulama süreci: Samsung'da 43,9'a karşı 36,8 ms ve emülatörde 9,8'e karşı 8,6, yük 56-64'te sırayla her biri 15'in medyanları. Protokolde bir metoda değmez.
- Bir metin girişinin dokunuşu, XCTest'inki yerine, bir `act` dokunuşu gibi olay sentezleyicisiyle: yük 30-85'te alanın odağı 760-1.374'e karşı 915 ms'de. Bir kazanç görülmedi.
  Yalnızca dokunuştan sonraki bir dokunuş: bir ekran getiren `read: none`'lı bir dokunuş onu kayarak girerken bırakır, itilen bir ekranın ağacı kaymasının başından itibaren bittiği yeri okur ve kayma sırasındaki bir dokunuş kaybolur. Bir simülatörde Form'a `read: none` ile yapılan bir `tap`'in hemen ardından Back'e yapılan bir `tap` "no change seen" yanıtını verdi. iOS'ta durulmasını atlayan bir dokunuştan sonraki bir dokunuş artık önce ekrana bakar ve o dokunuş ekranı değiştirdiyse ondan 650 ms sonrasına kadar bekler; bir simülatörün dokunuşu, ekranı değiştiren durulmuş bir dokunuştan sonra bunu zaten yapıyordu. Durulmuş bir dokunuştan ya da hiçbir şeyi değiştirmeyen bir dokunuştan sonraki dokunuş hiçbir şey ödemez. Yük 28-75'teki bir simülatörde, boş alana `read: none` ile 10 dokunuş önce her biri 80-137 ms, sonra 79-80 sürdü; Form'a bir dokunuş ve hemen ardından Back'e bir dokunuş, ikisi de `read: none`, çift olarak önce 297-340 ms, sonra 1.384 sürdü; bu beklemedir. Ondan önceki o 16 çiftte hiçbir dokunuş kaybolmadı; betiğin çalıştırmalarında biri kayboldu, yük 77-144'te.

### Bir simülatörün yardımcıları, ilk çağrıdan önce başlatılır

Bir sunucu simülatörünü adlandırıyordu (`--device`, `use_device` ya da onu açan ilk çağrı) ve bir çağrı ihtiyaç duyana kadar hiçbir şey başlatmıyordu: okuma yardımcısı ilk okumanın yaklaşık 400 ms'sini, girdi yardımcısı ilk dokunuşun yaklaşık 200'ünü alıyordu, çünkü simülatöre ilk mesajı, yardımcı ayaktayken bile, bir sonrakinden 120 ms daha uzun sürüyordu. İkisi de artık cihaz adlandırılır adlandırılmaz arka planda başlar ve girdi yardımcısına hiçbir uygulamanın görmediği bir ping gönderilir. Hiçbir şey bunu beklemez ve hiçbir şey onun yüzünden reddedilmez; sunucunun yönetmesine izin verilmeyen bir cihaza dokunulmaz. iOS 27.2'li bir iPhone 17 Pro simülatöründe, önce `52726c2e`'de ve sonra sırayla, ms olarak medyanlar:

| ms, medyan                                                  | önce | sonra | host yükü, önce; sonra |
| ----------------------------------------------------------- | ---- | ----- | ---------------------- |
| `screen`, bir sunucunun ilki, hız tablosunda (5 çalıştırma) | 555  | 347   | 6,3-7,6; 5,9-8,4       |
| `screen`, bir sunucunun ilki, istemci listesinden 1 s sonra | 505  | 98    | 6,5-6,6; 5,4-5,6       |
| `screen`, bir sunucunun ilki, istemci hemen (7 çalıştırma)  | 488  | 490   | 6,9-7,1; 5,6-6,1       |
| ilk dokunuş, `read: none`, istemci hemen (7 çalıştırma)     | 263  | 65-71 | 6,9-7,1; 5,6-6,1       |
| ilk dokunuş, `read: none`, istemci listesinden 1 s sonra    | 261  | 70    | 6,5-6,6; 5,4-5,6       |

Hız tablosunun ilk okuması, başlatmanın yanında çalıştığı `list_devices`'tan sonra gelir. Listeyi aldığı anda çağıran bir istemci okuma yardımcısını yine bekler. 21 ilk dokunuştan biri sonrasında 1.010 ms sürdü, öncesinde hiçbiri; 14 tanesinde daha yeniden görülmedi. Hız tablosunun her yanıtı aynıydı, sözleriyle kanıtlandı.

Aynı çalıştırmalarda, tablonun son çağrısı olan koordinatla `tap`, yalnızca dokunuş, önce 273, sonra 268'di. `553a94dd`'de 63'tü (en kötü 264) ve farkı hiçbir commit yaratmadı: aynı simülatörde sırayla derlenip çalıştırıldığında `553a94dd` 62 (en kötü 270), `52726c2e` 66 (en kötü 282) verdi, yük 6,3-8,3'te. Dokunuş, hemen önceki Back dokunuşunun başlattığı 650 ms'lik kaymanın geri kalanını bekler. Back, klavyenin kapanmasıyla birlikte gelir; bu, 12 yeniden oynatmanın 8'inde kendi durulmasını 247-304 ms yaptı, bu yüzden dokunuş o zaman 212-312 ms bekledi. Diğer 4'ünde durulma 611-712 ms sürdü, kaymadan hiçbir şey kalmamıştı ve dokunuş 61-64 ms sürdü. Uygulamanın kendi animasyon beklemesi her seferinde 2-4 ms'ydi.

### Bir simülatörün `logs`'u

`logs`, predicate'teki adı için her seferinde simülatörden uygulamanın klasörünü istiyor, sonra onun içinde `log show` çalıştırıyordu. Parçaları, yük 6,6-7,1'de 7'nin medyanları: `get_app_container` 100 ms; `simctl spawn … log help`, yani spawn ve `log` aracının başlaması, 220; hiçbir şeyle eşleşmeyen 5 s üzerinde `log show` 773, 5 s üzerinde uygulamanın satırları 783 ve 5 dakika üzerinde 809. Çoğu, ne sorulursa sorulsun, `log show`'un başlamasıdır. Klasör artık her simülatör ve uygulama için, o durdukça saklanır, çünkü yeniden kurulum uygulamayı yeni bir klasöre koyar ve eskisini siler. `log show`'a eskisiyle aynı şey sorulur, bu yüzden yanıt aynıdır. Bir oturumun sonraki `logs`'ları, 3 sunucunun her birinde 8 çağrı, önce `e5554ec5`'te ve sonra sırayla:

| ms, medyan (aralık)              | önce           | sonra          | host yükü, önce; sonra |
| -------------------------------- | -------------- | -------------- | ---------------------- |
| `logs`, bir oturumun ilki        | 901 (896-1089) | 917 (897-1046) | 7,6-8,2; 7,2-7,9       |
| `logs`, aynı oturumda daha sonra | 892 (880-997)  | 785 (768-799)  | 7,6-8,2; 7,2-7,9       |

Denenip bırakılanlar:

- Daha dar bir predicate, görüntü yolu yerine sürecin adı: 783-809'a karşı 793-803. Maliyet filtre değil, `log show`'un başlamasıdır.
- Oturum için tutulan ve tuttuğundan yanıt veren bir `log stream`: yanıtı `log show`'unki değildir. Fixture'ın yeniden başlatılması, bağlantılar ve bir push'tan oluşan aynı 8 s boyunca 296'ya karşı 1.545 satır tuttu: log deposunun tutmadığı debug satırları, bu yüzden `log show`'da hiç olmadılar. Aynı mesaj her biri tarafından 7 ms arayla damgalandı. Sürecin ilk anından gelen satırlar yalnızca `log show`'daydı.

### Bir runner'ın okuması, yalnızca kullandığını isteyerek

Bir runner'ın okuması, uygulamanın XCTest ile alınan bütün anlık görüntüsünü, XCTest'in varsayılan olarak istediği her özniteliği alıyordu. Yanıtın oluşturulduğu ağaç bunlardan 10'unu okur: identifier, frame, value, label, type, enabled, selected, placeholder, focus ve klavyenin focus'u. Runner artık yalnızca bunları, XCTest'in kendi özel anlık görüntü isteğiyle ister; bu istek onları 12 erişilebilirlik özniteliğine eşler. Bu XCTest'te bir parça eksikse ya da istek başarısız olursa eskisi gibi genel anlık görüntüyü alır ve logu hangisini kullandığını söyler. iOS 27.2'li bir iPhone 17 Pro simülatöründe, her biri 15 kez `tree.get`, ms olarak medyanlar, parantez içinde runner'ın kendi süresi, sırayla önce ve sonra:

| ms, medyan (runner'ın kendi süresi)   | önce          | sonra   | host yükü, önce; sonra |
| ------------------------------------- | ------------- | ------- | ---------------------- |
| fixture'ın ilk ekranı, 32 öğe         | 38-39 (26)    | 34 (22) | 6,2-8,1; 5,8-5,9       |
| Ayarlar, 167 öğe                      | 71-73 (59-60) | 56 (44) | 6,2-8,1; 5,8-5,9       |
| ana ekran uygulaması, üstünde fixture | 54-55 (41-42) | 43 (31) | 6,2-8,1; 5,8-5,9       |
| ana ekran uygulaması, üstünde Ayarlar | 54-55 (42-43) | 44 (33) | 6,2-8,1; 5,8-5,9       |

Her ağaç, durum çubuğunun saati dışında, bütünüyle öncekiyle aynıydı. Bir derinlik sınırı denenmedi: yanıt ağacın tamamıdır.

iOS 27.2'li bir iPhone 13 Pro Max'te, USB üzerinden, runner'ın bir build'i anlık görüntüsünü her okumada seçti, böylece bütün anlık görüntü, anahtarlı olan ve üçüncü bir tane (aşağıda) 15 turun her birinde sırayla çalıştı. İki çalıştırmanın ms olarak medyanları, parantez içinde runner'ın kendi süresi, host yükü 9,8 ve 7,0:

| ms, medyan (runner'ın kendi süresi)                            | bütün             | anahtarlı         | type, label ve value |
| -------------------------------------------------------------- | ----------------- | ----------------- | -------------------- |
| fixture'ın ilk ekranı, 20 öğe                                  | 159-161 (146-148) | 130-134 (119-121) |                      |
| Ayarlar, 189 öğe                                               | 348-350 (335)     | 307-310 (293-294) |                      |
| ana ekran uygulaması, üstünde fixture, 76 öğe                  | 182-184 (169-170) | 150 (136)         | 140-141 (126-128)    |
| ana ekran uygulaması, üstünde Ayarlar, 77 öğe                  | 181-184 (169)     | 150 (136)         | 136-140 (124-127)    |
| ana ekran, 77 öğe                                              | 181-183 (168-170) | 150-151 (137)     | 139-140 (126-127)    |
| ana ekran uygulaması, fixture'ın üstünde bir konum izni sorusu | 232-237 (218-223) | 175-176 (161-163) | 166-168 (152-155)    |

Anahtarlı ağaçlar, saat dışında, düğüm düğüm bütün olanlarla aynıydı. Commit'in kendi build'i, sonra telefonda, anahtarlı isteği logladı.

Bir işlem hiçbir şeyi değiştirmediğinde, uygulamanın üstündeki bir sayfanın sözcükleri için ana ekran uygulaması ikinci kez okunur. Ondan yalnızca, o sözcüklerin hepsini oluşturan type, label ve value'yu istemek, konum sorusununki dahil her durumda aynı sözcükleri verdi ve gidiş-dönüşün 7-14 ms'sini, o okumanın %4-9'unu kazandırdı. O üçüncü anlık görüntü yapılmadı, çünkü bu kadar az şey için protokol üzerinden kendine ait bir istek gerektirirdi.

Yalnızca sayfalar için bir sorgu da yapılmadı. Bir iOS 27.2 simülatöründe, fixture'ın üstündeki bir Face ID sayfası, uygulama değiştiricinin uygulama kartının içinde, hiçbirinin identifier'ı olmayan 37 Other düzeyinin altında bir StaticText "Face ID"dir: bir sorgunun onu bulabileceği hiçbir şey yok. Bir izin sorusu bir alert'tir ve uygulamanın okuması onu zaten kendi sorgusuyla alır. Telefonun parolası ve Face ID'si yok, bu yüzden üzerinde böyle bir sayfa açılamadı.

## Daha önceki ölçümler

2026-11-03 ile 2026-11-06 arasında, Ayarlar senaryosuyla, [Hız](perf.tr.md#hız) tablosundan önce ölçüldü: çağrıları, senaryoları ve build'leri ondan farklıdır, bu yüzden bir sayıyı yalnızca kendi tablosu içinde karşılaştırın.

### iPhone 13 Pro Max, iOS 27.0.1

iPhone 13 Pro Max, iOS 27.0.1, kütüphane üzerinden Ayarlar senaryosu: okuma 240, dokun ve gör 1.523, geri 1.682,
ekran görüntüsü 140, uygulama önde 240, öne gelene kadar soğuk açılış 279 ms (ilk ekranı okunana kadar 819), bir runner'ın başlaması
3-5 s. Eski yanıt yok, 4 denetimde hiçbir şey kıpırdamadı. Bir ölçüm 8-13 s'ye mal olur, neredeyse tamamı trace aracının başlaması ve durması.

### iOS simülatörü, iOS 26.5

Ayarlar senaryosuyla bir iPhone 17 Pro simülatöründe, iOS 26.5, başka build'lerin çalıştığı bir Mac'te ölçüldü
(yük tabloda). 10-15 turun medyanı, ms olarak.

| okuma | dokun ve gör | geri dön ve gör | ekran görüntüsü | uygulama önde, ekranıyla | uygulama arkada, ekransız |
| ----- | ------------ | --------------- | --------------- | ------------------------ | ------------------------- |
| 54-56 | 894-916      | 733-776         | 84-88           | 292-359                  | 179-183                   |

Üç çalıştırma, host yükü 4-14. Oradaki okuma, uygulama hâlâ meşgulken bir geri dönüşün ardından gelir: boştayken 31-32 ms sürdü, 25 ms'si
167 öğe için yardımcıda. Hiçbir çalıştırmada eski yanıt yok.

1,5 s sonraki bir okumaya karşı yanıtlar: 20 yanıtta kıpırdayan, eksik ya da fazla hiçbir şey yoktu (`device-tests/ios.test.ts` bu denetimi
tutar). Bir uygulamayı açmak onun öne gelmesini bekler ve ekranla birlikte, `packages/ops` içinde bir işlemin durulması gibi,
yerleşim 200 ms boyunca aynı kalana dek bakar.

Her değişikliğin yaptığı, senaryonun geri kalanı sabit tutularak:

| değişiklik                                                                                                            | önce                             | sonra                   | koşullar                                                                |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| doğrudan girdi, durulma host'ta                                                                                       | dokunuş 1.206; geri 1.340        | dokunuş 905; geri 760   | yük 5-12; dokunuşun kendisi 52-58 ms                                    |
| doğrudan okuma                                                                                                        | 74-75                            | boştayken 31-32         | yük 7-11, 167 öğe                                                       |
| durulma, adlandırılabileni herhangi bir sırada karşılaştırır                                                          | geri 1.220                       | geri 500-750            | yük 18-36; yüzen bir arama çubuğu düzey değiştirir                      |
| bir şey tepki verdikten sonra 200 ms'ye karşı 150 ms                                                                  | dokunuş 984-1.357                | dokunuş 944-959         | yük 8-21; ikisinde de 16 yanıtta hiçbir şey kıpırdamadı                 |
| yeniden başlatmadan `launch`, çalışan uygulama                                                                        | 2.592-5.735                      | 273-292                 | yük 7-320                                                               |
| ilk başlangıç: silinmiş simülatör, açıldı (19 s), runner kurulu değil                                                 |                                  | 2,7 s; kuruluyken 1,9 s | yük 7; yük 319'da 37 s görüldü. Nereye geldiğini stderr'de söyler       |
| runner olmadan ilk açılış, uygulama yardımcıyla yan yana başlatıldı                                                   | ilk açılış 12.507 (6.303-13.424) | 2.391 (2.052-2.918)     | her biri üç çalıştırma, sırayla, yük 5-11; her yanıtta bir ekran        |
| uygulamanın animasyon raporu yardımcıya soruldu, ekranı değiştiren bir dokunuştan sonra 650 ms bekletilen bir dokunuş | dokunuş 987; geri 600            | dokunuş 976; geri 484   | aynı çalıştırmalar; hiçbir şey kıpırdamadı, eski yanıt yok              |
| yerinde kendi adında bir kontrol duran bir satır bir kez söylenir                                                     | okuma 1.120 karakter             | 587                     | aynı çalıştırmalar                                                      |
| yanıtın görüntüsü 800 px'te, kalite 60                                                                                | 86.782 karakter base64           | 44.808                  | aynı çalıştırmalar; Ayarlar'ın ve fixture'ın en küçük metni yine okunur |

Ayarlar'ın bir ilk açılışında sürenin nereye gittiği, yük 18-27'de beş çalıştırma: `simctl launch` ve yardımcının merhabası, yan yana, 250-750 ms;
uygulamanın birincil olana kadar kendi başlangıcı, açık ara en büyüğü, 1.520-3.440 ms'de biter; bir okuma 70-400; `launch_app`'in beklediği
200 ms'lik durgunluk; bir okuma 40-115. Bir ilk açılışın artık ödemediğini, yalnızca runner'ın yaptığı ilk şey öder: ilk
görüntü yukarıdaki çalıştırmalarda 3.012-3.317 ms sürdü, sonrakiler için 85'e karşı.

Denenip bırakılanlar:

- XCTest'in `XCTDisableAttributeKeyPathAnalysis`, `DisableScreenshots`, `DisableDiagnosticScreenRecordings` ayarları, hepsi
  runner'da ayarlı: okuma 75'e karşı 74, dokunuş 1.222-1.255'e karşı 1.206-1.211, geri 1.352-1.355'e karşı 1.338-1.349 (yük 9-11);
  telefonda okuma 233'e karşı 231, dokunuş 1.644'e karşı 1.583.
- Bir şey tepki verdikten sonra 120 ms'lik bir pencere: yanıtlar, bir push'un bir an bıraktığı bir arama çubuğunu taşıdı.
- Durulma sinyali olarak uygulamanın erişilebilirlik raporları: `RunLoopIsIdle` ve `AnimationsNonActive` 3 ms içinde yanıt verir,
  bir push sırasında, eski sayfası gitmeden 700 ms önce. Bir dokunuşun kanıtı olarak `TouchEventsCompleted` çalışır.
- Simülatörün içinden `LSApplicationWorkspace`: uygulama 800 ms sonra önde, oysa
  `simctl launch` ile yaklaşık 180.
- Runner'ın isteğinde bir derinlik sınırı denenmedi: doğrudan okuma 60 düzey ister ve runner artık yalnızca yardımcının
  reddettiğini yanıtlar.

### Android emülatörü, Android 14

Bir Pixel 6 emülatöründe Ayarlar senaryosu, Android 14, üç çalıştırmanın her birinde on tur, sırayla önce ve sonra, yük 5-10.

| ölçüm                         | önce   | sonra  |
| ----------------------------- | ------ | ------ |
| ilk açılış, ajan ayakta değil | 1.739  | 1.441  |
| okuma, karakter               | 700    | 700    |
| bir görüntü, base64 karakteri | 39.546 | 21.972 |

Hiçbir çalıştırmada hiçbir şey kıpırdamadı ve hiçbir yanıt eski değildi; bir ilk açılışın yanıtı ekranı tutar. Ajanı başlatmak ve
`am start -W` yük 8-9'da her biri yaklaşık 500 ms, ilk okuma da uygulama hâlâ açılırken yaklaşık 450 sürer: ilk açılış
uygulamayı ajanla yan yana başlatarak azaldı. Başka bir aracın UI otomasyonu üzerinde bunu yapmaz; orada oturum reddedilebilir
ve cihaza dokunmamış olmalıdır.

## Yansıtma

Bir pencerenin kendi maliyeti, boştaki bir iPhone 17 Pro simülatöründe her ekranın dışında tutularak, sessiz bir Mac'te (yük 3 ile 10 arası), 22 s'lik beş ve 60 s'lik bir çalıştırma boyunca: ilk resmi 338 ms'de (269 ile 437 arası), hiçbir şey kıpırdamazken bir çekirdeğin %0,01'i ve durulduktan sonra 106 MB, ilk saniyesinde 121 MB.

`packages/appdyno/scripts/mirror-bench.mjs <device>`, penceresiz: Android'de fixture'ın kareler ekranı, bir simülatörde Ayarlar boyunca bir fiske. Hepsi cama değil Mac'e varış değerleridir: bir pencere yaklaşık bir ekran tıkı ekler. Her dokunuştan önce iki durgun saniye bekler, böylece sonraki kare dokunuşun kendisinindir. 2026-11-04'te, başka işlerin yapıldığı aynı Mac'te, 15 çekirdekli bir M5 Pro'da, her birinin yanında host yüküyle ölçüldü. Her biri tek bir çalıştırmadır; bir sayı bu yükteki bu Mac'e göredir.

| cihaz, resim                                             | hareket ederken kare/s (hedef)                | yakalamadan varışa p50, p95, ms (hedef) | dokunuştan ilk değişen kareye p50, ms (hedef) | çözme ya da kopyalama p95, ms (hedef) | durgun ekran: viewer CPU, RSS | host yükü |
| -------------------------------------------------------- | --------------------------------------------- | --------------------------------------- | --------------------------------------------- | ------------------------------------- | ----------------------------- | --------- |
| Xiaomi 25078RA3EY, Android 16, H.264, 720x1600           | 60, en iyi 60 (59)                            | 31,2, 34,6 (35, 50)                     | **92,2, kaçırıldı** (80)                      | 0,9 (8)                               | %0,3, 106 MB                  | 11-28     |
| Samsung SM-A525F, Android 14, H.264, `auto` ile 576x1280 | 81, en iyi 84 (59)                            | 23,6, 26,3 (35, 50)                     | **107, kaçırıldı** (80)                       | 0,7 (8)                               | %0,2, 104 MB                  | 14-49     |
| Ekranının 1080x2400'ünde aynısı, `--quality high`        | 89, en iyi 91 (59)                            | **69,3, 73,4, kaçırıldı** (35, 50)      | **217, kaçırıldı** (80)                       | 1 (8)                                 | %0,3, 69 MB                   | 16-25     |
| Android 14 emülatörü, gRPC `MMAP`, 1080x2400             | 43, en iyi 54 (40,3: konuğun 44,8'inin %90'ı) | bu yolla ölçülmedi                      | 41,4 (120)                                    | 0,6 (8)                               | %0, 40 MB                     | 24-31     |
| iPhone 17 Pro simülatörü, iOS 27.0, yüzey, 1206x2622     | 91, en iyi 114 (58)                           | kodlama yok                             | 55 (80)                                       | çözme yok; kare aralığı 18,8 (20)     | %0, 24 MB                     | 25-31     |

Telefonun dokunuşu hedefinin yaklaşık bir ekran tıkı üstünde kalır: dokunuş başına iki gidiş-dönüşlü UI otomasyonu yoluyla 98 ms, şimdiki haliyle 86 ile 91 ms, bunun 7 ms'si ajana bir gidiş-dönüş. Simülatörün dokunuşları iki boyda gelir, bir listede yukarı yaklaşık 70 ms, geri aşağı yaklaşık 20 ms. Kare hızı bir fiskenin başında panelinin 120 Hz'idir ve liste kayarak yavaşladıkça düşer; yalnızca 30 ya da daha fazla kareli saniyeler sayılır. Viewer'ın gerçek bir penceresi, penceresizken 24'e karşı yaklaşık 86 MB tutar.

Başka işler altında yükten başka hiçbir şey değişmez: telefonda yük 325 ile 369 arasında, 51 kare/s, yakalamadan varışa 33,8, 48,4 ms, dokunuş 103 ms, çözme 9,6 ms.

Wi-Fi ile, aynı telefonun kabloyla haline karşı: bir Samsung SM-A525F, Android 14, H.264, kablosu takılı ve Wi-Fi seri numarasıyla yönetilerek, iki yolda da `--max-size 1280`, sırayla her biri üç çalıştırma, birer buçuk dakika arayla, yük 3 ile 6 arasında, telefona bir ping'in ortalama 31 ile 86 ms sürdüğü bir ağda:

| yol   | ilk resim, ms | dokunuştan ilk değişen kareye p50, ms | hareket ederken kare/s | yakalamadan varışa p50, p95, ms    |
| ----- | ------------- | ------------------------------------- | ---------------------- | ---------------------------------- |
| kablo | 260, 256, 260 | 106, 103, 110                         | 75, 74, 75             | 25, 28; 25, 29; 25, 28             |
| Wi-Fi | 357, 411, 357 | **187, 208, 197**                     | 82, 82, 72             | 29, **81**; 27, **74**; 32, **88** |

Üçüncü çift telefonda tek bir ajanla, ilk ikisi boşta bekleyen ikinci bir ajanla çalıştı. `auto` her giriş yolu için bir boyut tutar: Wi-Fi ile 720x1600'e oturdu, orada dokunuş 212 ve 201 ms, yakalamadan varışa p95 100 ve 85 ms okudu. Üç çalıştırmanın ikisinde kare/s'nin Wi-Fi ile neden daha yüksek okuduğuna bakılmadı. Son commit'teki dördüncü bir çift, yük 4'te, kabloyla 258 ms, 109 ms ve 75 kare/s, Wi-Fi ile 1615 ms, 168 ms ve 85 kare/s okudu: ilk resmi kendinden önceki üçüne benzemiyor ve açıklanmadı.

Bir iPhone 13 Pro Max, iOS 27.2, HEVC, kablosu takılı, `--wifi` ile ya da onsuz, iki yolda da `auto`, sırayla her biri beş çalıştırma, yük 4 ile 14 arasında, telefona bir ping'in ortalama 12 ile 86 ms sürdüğü bir ağda:

| yol   | ilk resim, ms                | dokunuştan ilk değişen kareye p50, ms | 10 fiskeden görülen | hareket ederken kare/s | bir çalıştırmadaki görüntü donmaları |
| ----- | ---------------------------- | ------------------------------------- | ------------------- | ---------------------- | ------------------------------------ |
| kablo | 559, 508, 510, 510, 463      | 98, 97, 98, 93, 93                    | 7, 7, 7, 7, 7       | 60, 60, 60, 60, 60     | 1, 4, 0, 0, 1                        |
| Wi-Fi | 1677, 2545, 1577, 1529, 1840 | 128, **470**, **270**, 121, **164**   | 10, 2, 3, 10, 5     | 59, 56, 58, **44**, 56 | 17, 17, 14, 13, 18                   |

Buradaki dokunuş, fixture'ın listesi boyunca bir fiskedir. 5 s içinde hiçbir kare getirmeyen bir fiske sayılmaz, bu yüzden az fiskeden çıkan bir p50 az örneğe dayanır. Kabloyla görülmeyen fiskeler her çalıştırmanın ilk 3'üydü, Wi-Fi ile ise herhangi biri. İkisi de açıklanmadı ve o fiskelerin telefona ulaşıp ulaşmadığına bakılmadı. `auto` kabloyla 1284x2778'de 4:4:4 mod 7'yi, Wi-Fi ile 1296x2816'da 4:2:0 mod 5'i aldı. Wi-Fi ile bir görüntü donması 834 ms'ye kadar sürdü ve bir çalıştırmadaki donmalar toplam 2,3 ile 6,0 s tuttu; kabloyla her biri yaklaşık 1,1 s sürdü. Telefonun kablosu her çalıştırmada, Wi-Fi ile olanlarda da takılıydı: kablosu çıkarılmış bir telefon ölçülmedi.

Bir telefonun kareler için hedefi 59'dur, ekranı daha yavaşsa her 60'ın 59'u, `dumpsys display`'den okunur: `auto` bir dokunuş için bunun ötesindekinden vazgeçer. Samsung'da yakalamadan varışa resmin piksellerini izler ve dokunuş yük 160'ta 215 ms, yük 21'de 217 okudu, yani bu yük değil boyuttur ve [`auto` onu ölçer](mirror.tr.md#bir-telefonun-görüntüsünün-boyutu). İlk yayını 1920 satır yoluyla 1080x2400'den 576x1280'e oturdu, sonraki orada başladı, ilk resim 360 ile 932 ms'de. Dokunuş her boyutta hedefin dışında kalır: çalıştırmalar boyunca 1280 satırda 95 ile 107 ms, 1024'te 94.

`--soak 30` ile, sürekli hareket eden bir resmin otuz dakikası; viewer'ın belleği bir dakika sonra ve sonda:

| cihaz                                | RSS, MB          | tanımlayıcılar | son 30 s'deki kareler | sondaki yük |
| ------------------------------------ | ---------------- | -------------- | --------------------- | ----------- |
| Xiaomi 25078RA3EY, Android 16, H.264 | 21,8'den 17,6'ya | 45, 45         | 734                   | 251         |
| Samsung SM-A525F, Android 14, H.264  | 21'den 15,1'e    | 45, 45         | 991                   | 19          |
| Android 14 emülatörü, gRPC `MMAP`    | 49,2'den 49,3'e  | 45, 45         | 399                   | 86          |
| iPhone 17 Pro simülatörü, iOS 27.0   | 26,4'ten 15,5'e  | 45, 45         | 606                   | 42          |

Bir iPhone 13 Pro Max, iOS 27.2, mod 7, gürültülü bir ekranda, 60 kare/s'de 167 Mbit/s, viewer'ın belleği ve yayının saydıklarıyla:

| dakika, yük                 | RSS, MB         | kaybolan paketler     | tutulan resimler           | görüntü donmaları             | durdurma       |
| --------------------------- | --------------- | --------------------- | -------------------------- | ----------------------------- | -------------- |
| 15, yük 6 ile 8             | 20,9'dan 17,3'e | 16.027.627'den 1.504  | 54.715'ten 129             | 1 kez, 1,1 s, ilk dakikasında | telefon söyler |
| 30, yük 361'den 8'e düşerek | 17,3'ten 15,8'e | 32.038.280'den 80.398 | yaklaşık 108.000'den 9.425 | henüz sayılmadı               | telefon söyler |

Sessiz çalıştırmanın bütün kaybı yayının ilk saniyesindedir. O gürültüde ilk anahtar kare, sabit hızın iki katı, yaklaşık 330 Mbit/s'lik bir patlama olarak gelir: en yoğun 100 ms'sindeki 3.457 paketin 1.506'sı kayboldu ve ilk bütün resim, başlangıçtan 1,56 s sonra, yük 27'de, bir sonraki anahtar kareydi. Durgun bir ekran ilk resmini yük 18 ile 20 arasında 459 ms'de gösterir.

Bir iPhone'un canlı sayıları instruments servisinden gelir, saniyede bir örnek; aynı 13 Pro Max'te, tutulan bir yayın altında, yük yaklaşık 370'teyken: 36 KB/s, okumak için bir Mac çekirdeğinin %0,6 ile %1,5'i ve onlar çalışırken `DTServiceHub`'ın kendisi için bir telefon çekirdeğinin yaklaşık %6'sı. Kareler uygulamayı değil ekranı sayar: gürültü ekranında 59 ile 60, bir yayın altındaki durgun bir ekranda 19 ile 20, karanlık bir telefonda 0.

Bir simülatörün dönüşleri, ekranını okuyan yardımcı tarafından saniyede dört kez okunur; yardımcı çalışmıyorsa bir yansıtma onu başlatır: yük 94'te durgun bir ekranda bir çekirdeğin %0,3'ü ve 98 MB yerleşik bellek.
