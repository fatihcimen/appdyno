# Yansıtma

[English](mirror.md)

`appdyno mirror` her cihaz için bir native pencere açar; pencere fare, trackpad ve klavyeyle yönetilir, bu sırada bir ajan
da aynı cihazı yönetebilir. Pencere küçük bir Objective-C programıdır ve simülatör yardımcıları gibi ilk kullanımda `clang` ile
derlenir: Command Line Tools yeterlidir. Kontrol düzlemi Node'dur: yayınları başlatır ve durdurur,
girdiyi taşır, neyin yanlış olduğunu söyler ve yeniden bağlanır. Bize ait bir sunucu, daemon ya da dinleyici yoktur.

```sh
appdyno mirror                     # bu cihazın penceresini açar ve çalışmayı sürdürür
appdyno mirror --all [--watch]     # her cihaz ve geldikçe yenileri; en çok --max, varsayılan 8
appdyno mirror open --detach       # bu komuttan uzun yaşayan bir pencere
appdyno mirror --device A --device B --pair   # yan yana iki cihaz, bir dokunuş ikisine de gider
appdyno mirror close | status | stats
  --quality auto|high|standard  --codec h264|hevc  --no-input  --headless  --seconds N  --takeover
  --record file.mp4  --focus
```

`mirror` aracında `open`, `close`, `status` ve `stats` vardır. MCP üzerinden hiçbir kare geçmez: bir ajanın `screenshot`
ve `record` araçları vardır. `hand_off`, bir ajanın yapamadığını bir kişiden ister.

## Onu ne besler

| cihaz     | nasıl                                                                                               | bilinmesi gerekenler                                                                                                                                                                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| simülatör | CoreSimulator'ın kendi yüzeyi, kodlama yok: her kare sunumunda geri çağrılan framebuffer'ın kendisi | durgun bir ekranın hiçbir maliyeti yoktur. Çalışma anında yüklenen özel API; başarısız olan şey bunu söyler                                                                                                                                                                                               |
| telefon   | ajanın yayını, kendine ait bir bağlantıda: Node'dan hiçbir şey geçmez                               | varsayılan olarak H.264, siz isterseniz HEVC. Android 10 ve üstü. Güvenli bir pencere, `screencap`'te olduğu gibi siyahtır (Android 16'da görüldü)                                                                                                                                                        |
| iPhone    | iOS 27'nin ekran servisi, bu sürecin kendi tüneli üzerinden, USB ile; telefonda hiçbir şey yok      | belgelenmemiştir ve değişebilir. Telefonun kendi boyutunda 4:4:4, ekranının hızına kadar. Durgun bir ekran göndermeyi sürdürür, saniyede yaklaşık 20 kare; bu yüzden penceresi diğerleri gibi bedava değildir. Açık tutulan bir yayın, hiçbir şey dokunmadan bir telefonun ekranını 30 dakika yanık tuttu |
| emülatör  | emülatörün kendi gRPC portu, ekranı paylaşılan bir dosyada; misafir sistemde hiçbir şey yok         | port emülatörün kendi portudur, bizim değil. Portu olmayan yerde kodlamayı misafir sistem yapar; bu saniyelerce gecikme getirir ve bunu söyler                                                                                                                                                            |

Emülatörün karesi, tam kendi boyutundaki bir dosyada RGBA'dır, en üst satır önce (proto'nun yorumu aşağıdan yukarı der,
`screencap` ile karşılaştırılan bir kare öyle olmadığını söyler). Boyut verilmeden ya da daha büyük bir dosyaya istendiğinde her kareye yanıt verir ve
hiçbir şey yazmaz. Dönen bir misafir sistem aynı biçimdeki bir karede yana yatık çizer; bu yüzden görüntü, yeni bir oturum açılmadan
viewer'da dik çevrilir. Bir simülatör de yüzeyinde aynısını yapar, geri çağrı olmadan: okuma yardımcısı öndeki uygulamanın nasıl çizildiğini saniyede dört kez söyler; böylece dönmeyen bir uygulama döndürülmüş bir cihazda dik kalır ve bir dokunuş inerken geri döndürülür. `simulator` ile başlatılan bir emülatör, `APPDYNO_EMULATOR_ARGS` yanında `-grpc <free port> -grpc-use-token` alır (bunlar
`-grpc` içermiyorsa). Port, adb'ninki adb'ye ait olduğu gibi, emülatöre aittir. Görüntünün dosyası `0600` izniyle durum
klasöründedir ve oturumla birlikte gider.

## Durumları

`connecting`, `live`, `waiting {need}`, `reconnecting {attempt}`, `stopped {why}`. Neyi beklediği tek bir tablodadır,
`packages/core/src/mirror/need.ts` içindeki `NEEDS`; bunu pencerenin uyarı bandı, `mirror status` ve bir ret kullanır, her biri
kendi sözleri ve çözümüyle. Bir bekleme her saniye yeniden sorar ve engel kalkınca kendiliğinden sürer.

| ne olur                             | ne yapar                                                                                                                           | neyle test edildi                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| yayın sırasında cihaz gider         | son görüntü soluklaşır, uyarı bandı, `waiting not-connected`; geri gelince: yeniden canlı                                          | yayını altında öldürülen bir emülatör; kablo için elle denendi |
| simülatör kapatılır                 | `waiting simulator-off`; başlatılınca: yeniden canlı                                                                               | penceresi altında kapatılan bir simülatör                      |
| ekran kapalı                        | `waiting asleep`; bir kişi uyandırınca yeniden açık                                                                                | emülatörler ve Xiaomi                                          |
| kodlayıcı başarısız olur            | 500 ms arayla 3 kez yeniden başlatma; daha küçük boyut; diğer codec; yazılım; ardından nedeniyle birlikte `stopped`                | ajan birim testi; emülatörlerde ve Xiaomi'de `failFirst`       |
| çözücü başarısız olur               | bir anahtar kare istenir ve görüntü tutulur; art arda üç kez olursa yeni bir yayın; ardından `stopped`                             | viewer öz testi; oturum birim testi                            |
| viewer ölür                         | hemen, aynı yakınlaştırmayla yeniden başlatılır; bir dakikada iki kez olursa, söylediğiyle birlikte `stopped`                      | her türde SIGKILL; oturum birim testi                          |
| üst süreç ölür                      | viewer'ın stdin'i biter, böylece viewer da biter; ajan bunu görür ve ekranı ve codec'i bırakır                                     | `appdyno mirror` için SIGKILL, ardından `dumpsys`              |
| ajan durur                          | `reconnecting` ve ajan, her sürücünün kullandığı yoldan başlar                                                                     | emülatörlerde ve Xiaomi'de `shutdown`                          |
| Mac uyur, uyanır                    | yayın biter ve uyanınca geri gelir                                                                                                 | oturum birim testi; elle denendi                               |
| pencere örtülür                     | kareler okunur, çözülmez ve çizilmez; bir anahtar kareyle geri gelir                                                               | viewer öz testi                                                |
| döndürme, katlama                   | yeni oturum olmadan yeni bir boyut: ajanın kodlayıcısı yeniden başlar, bir emülatörün görüntüsü dik çevrilir, bir simülatörünki de | emülatörler; bir simülatörünki bir suite ile, dokunuşlar dahil |
| bir cihazda ikinci pencere          | ilki öne gelir ve ret onu kimin tuttuğunu söyler                                                                                   | üst süreç birim testi; Xiaomi'de iki çalıştırma                |
| birkaç cihaz                        | her birine bir viewer, `--max`; biri başarısız olunca diğerleri sürer                                                              | üst süreç birim testi; biri öldürülen üç cihaz                 |
| derleyici yok, pencere sunucusu yok | hiçbir şey açılmadan, ihtiyacıyla birlikte `stopped`                                                                               | oturum birim testi                                             |

## Bir iPhone

Bir telefonun servisleriyle konuşan her şey `packages/driver-apple/src/phone-stream/` içindedir ve tek bir giriş yolu vardır: o
klasörü silin, geri kalanı derlenir ve testlerini geçer, bir iPhone runner'ını korur ve yansıtması
`no-phone-stream` olarak reddedilir. Başka hiçbir şeyin onun içine uzanmadığını bir test doğrular.

Kendi tünelini kurar: `usbmuxd`, bu Mac'in eşleştirme kaydıyla lockdown, `CoreDeviceProxy`, ardından IPv6, TCP ve UDP, bu
sürecin bir thread'inde. Apple'ın kendi tünelinin keşif portuna asla bağlanmaz; o port tek bir istemci kabul eder ve
`remoted`'u ondan düşürürdü; bunu da bir test doğrular. Eşleştirme kaydı okunur ve hiç yazılmaz; kabloyla eşleştirme
hiç istenmez ve her ret, bir kişinin yapması gerekeni söyleyerek durur. Bunların hiçbiri için bu Mac'te soket açılmaz; böylece
README'nin dinleyiciler hakkındaki satırı geçerliliğini korur.

`--wifi` ile aynı tünel ağda TCP ve TLS üzerinden çalışır. Oraya ulaştıran `wifi.ts`'dir: burada soket açan tek
dosya odur, o da yalnızca bir telefona açar: `dns-sd` telefonun duyurduğunu bulur ve telefon, tünel için bir anahtar
oluşturulmadan önce, eşleştirmede verdiği anahtarla kendini kanıtlar. Hiçbir şey dinlemez. O eşleştirme `appdyno pair`'in işidir:
telefonda bir kişinin onayı, durum klasörünün `wifi-pairing/` içinde kendine ait bir kimlik, `0600`. Bir kez yapılır,
kabloda: ağda bir telefon `allowsPairSetup: false` der ve hiçbir udid söylemez; kablonun tüneli içinde ise
eşleştirme kabul eden bir servis sunar, böylece bu da keşif portunun yakınına bile gelmez. Eşleştirme kaydı o
tüneli, diğer her tüneli açtığı gibi açar ve ağ üzerinden bir pencerede hiçbir rol oynamaz; bunu da bir test doğrular.

Yayın önce uzak masaüstü profilini ister, yapılandırmaya göre 20 ile 60 Mbit/s, 4:4:4 olarak; bir telefon onu reddederse ya da
`--quality standard` isterse daha düşük olanı, 4:2:0 olarak alır. Görüntüler viewer'a `0600` izinli adlandırılmış bir pipe ile gider; pipe,
iki uç da onu tuttuğu anda diskten kaldırılır. Paketlerdeki bir boşluk, bir anahtar görüntü gelene kadar görüntüyü tutar: donma olur, asla
bozuk görüntü olmaz. En çok üç görüntü bekler; ötesinde biri atılır ve bu da görüntüyü bir anahtar görüntüye kadar tutar.
`mirror stats`, yayın başladığından beri `lostPackets`, `latePackets`, `heldPictures` ve `droppedPictures` değerlerini verir.

Bir yayının teklifi, telefondan, varsayılan bir saatlik süre yerine, bizden 30 s boyunca rapor gelmezse yayını bitirmesini ister: doğrudan
öldürülen bir süreç telefonun yayınını 28 ile 30 s arasında açık bıraktı, tek çalıştırmada, göstergesini de onunla birlikte. Başlattığımız yayınlar hatırlanır,
böylece bir başlatma geride kalmış olanı durdurur; başka bir istemcininki `taken-over` olarak okunur ve asla durdurulmaz.

Yan düğmesiyle karartılan bir telefon yayınını saniyede bir görüntüyle sürdürür ve yansıtma, telefon böyle kaldıkça `waiting asleep`
der: yeni bir yayın ekranı yakar ve bir kişinin yaptığını geri alırdı. Görüntülerle birlikte geri gelir. Karanlık bir
telefonda `home`'a bir basış kilit ekranını yakar, ikincisi parolası olmayan bir telefonu açar. Ona basan tek şey pencereye bir tıklama ya da penceredeki Yeniden Dene'dir, yalnızca karanlık bir telefonda. Karanlık bir ekrandan sonra girdi yeniden açılır, çünkü ondan önceki bir bağlantıyla gönderilen bir parmak hiçbir yere gitmez; bir telefona gönderilen
bir kaydırma kilit ekranını açmaz.

Dönen bir telefon, uygulama yan yatmış halde aynı biçimde bir görüntü göndermeyi sürdürür. SpringBoard öndeki uygulamanın nasıl çizildiğini saniyede dört kez, kendine ait bir lockdown servisi üzerinden söyler; böylece pencere görüntüyü dik çevirir ve bir dokunuş inerken geri döndürülür.

## Pencere

Cihaz, sistemin araç çubuğunun altında, hub'ın paletinden boyanmış bir zeminde durur. Sistemin camının kendine ait bir rengi yoktur, bu yüzden bir pencere arkasında duran kadar zengindir. Görüntünün üstüne hiçbir şey konmaz ve hiçbir şey onu renklendirmez: renk onun çevresinde yaşar. Oradaki tek bir kapsül, cihazın içinde bulunduğu her şeyi söyler: `Live · Picture 60 fps · USB`, `Reconnecting`, onu neyin beklettiği, alt kenarında bir çubukla `Measuring launch 3 of 6` ya da bir yapay zekâ istemcisinin yönettiği. Ona tıklamak yayının sayılarını gösterir. Bir durum asla yalnızca bir renk değildir: her birinin bir simgesi ve sözleri vardır. Oradaki hız, görüntünün bu Mac'e ulaştığı hızdır: Performans bölmesindeki **Uygulamanın kare hızı** uygulamanın çizdiğidir, ikisinin tutması gerekmez, çünkü duran bir uygulama bir kez çizilir, yayın da değişeni gönderir.

Pencere çoğu zaman bir kişinin yazdığı pencerenin arkasındadır, bu yüzden söyledikleri orada da gücünü koruyacak biçimde yapılmıştır. AppKit, anahtar (key) olmayan bir pencerenin çubuğundaki sistem renklerini ve her görüntüyü soldurur: kendi başlığını 2:1'e kadar. Bu yüzden çubuktaki ad bize ait bir etikettir, renkler düz renklere çözülür ve simgeleri bize ait bir görünüm çizer. Gerçek pencerenin pikselleri koyu ve açık olarak, bir simülatörde, hub'ın her yerinde, kullanımdaymış gibi ve diğerlerinin arkasındaymış gibi çizilmiş halleriyle okundu: her iki biçimde 854 sözcük ve simgeden her sözcük 4,5:1 ya da üstünde, her simge 3:1'de; Reduce Transparency, Increase Contrast ve Differentiate Without Color açıkken de, Liquid Glass ayarının iki ucunda da öyle. Arkada tutulan bir pencere anahtar yapılamaz; bu yüzden kullanımdaki hal, pencerenin öyle çizilmiş halidir ve gerçek bir anahtar pencere okunmadı.

Sözleri, Mac'in diline göre Türkçe ya da İngilizcedir ve tek bir tablodan, `mac/Viewer/WordsTable.m` dosyasından gelir. Anahtar İngilizcedir, bu yüzden üst sürecin bir komut satırı için gönderdiğinin ikinci bir ada ihtiyacı yoktur: bir etiket kendisine verileni tabloda arar; tablonun içermediği, örneğin bir aracın kendi hatası, İngilizce kalır.

Çerçeve, modele göre küçük bir tablodan kodla çizilir: köşeleri, adası ya da çentiği, düğmeleri. Hiçbir parçası hazır bir görsel değildir ve her boyut için bir kez çizilir; bu yüzden durgun bir pencerede çerçevenin hiçbir maliyeti yoktur. Bir simülatörün görüntüsü kendi adasını taşır, bu yüzden çerçeve adayı yalnızca görüntüde ada olmayan yerde ekler. **Cihaz Çerçevesini Göster** (⌥⌘F) onu kaldırır ve ayar kalıcıdır. Zemin, paletten karıştırılmış ve katman tarafından gerilmiş küçük bir görüntüdür, bulanıklaştırma geçişi yoktur ve renkleri gösterilen yerle birlikte döner. Bir cihazın renkleri zemine yalnızca ton olarak ulaşır; iki cihaz yan yana durduğunda her biri kendi tarafında; en çok 2 s'de bir ve bir ekran durunca bir kez daha okunur. macOS 26'nın altında kenar çubuğu ve Denetçi sistemin eski malzemesidir ve zemin onların arkasından görünmez. Reduce Transparency düz bir zemin ve dolu kartlar, Increase Contrast daha güçlü çizgiler ve sözler, Differentiate Without Color da her durum için bir biçim verir.

Yalnızca bir durumu değiştiren şey hareket eder ve 300 ms içinde durulur: bir yerin zemini geçiş yapar, bir adım tek bir halkayla geçer, bir çalıştırma işaretiyle yerine oturur, bir sonuç listesine gelir ve kapsül bir durum için geçiş yapar. Bir kişinin tekrarladığı şey, bir satır, bir sekme ya da bir düğme, hemen olur ve bir okuma solmadan değişir. İki şey açıkladıkları için daha uzun sürer: yapılacak adımdaki halkalar ve onun resmindeki vuruşlar, her biri üç kez, sonra dururlar. Dönen bir gösterge yalnızca bir çalıştırma sürerken döner. Durgun bir pencerede hiçbir şey hareket etmez ve Reduce Motion açıkken hareket bir kesmeye dönüşür.

Çerçevedeki düğmeler çalışır: bir tıklama onlara basar, yan düğmeyi basılı tutmak Siri'dir. Bir pencere boyutunu ve yerini cihaz başına korur. Herhangi bir boyutta olabilir: cihaz var olan alanı alır, yakınlaştırma da pencereyi ona sığacak biçimde ayarlar.

Pencere en çok basılanları gösterir; geri kalanı **Diğer Denetimler** içinde ve menü çubuğunda bir tık uzaklıktadır. İkisi de tek bir tablodan gelir, böylece hiçbir denetim birinde olup diğerinde eksik kalmaz. Bir cihazda olmayanı pencere göstermez: Android'de Geri ve Hızlı Ayarlar vardır, Siri yoktur.

| denetim                                                    | kısayol         | cihazda                                                                                                                           |
| ---------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Ana Ekran, Kilitle, Sesi Aç, Sesi Kıs                      | ⇧⌘H, ⌘L, ⌘↑, ⌘↓ | kendi düğmeleri                                                                                                                   |
| Geri                                                       | ⌘[              | yalnızca Android                                                                                                                  |
| Uygulama Değiştirici                                       | ⇧⌘A             | iOS: iki kez Ana Ekran. Android: kendi tuşu                                                                                       |
| Siri                                                       | ⇧⌘K             | iOS: yan düğme basılı tutulur                                                                                                     |
| Denetim Merkezi, Hızlı Ayarlar, Bildirimler, Spotlight     | ⌃⌘C, ⌃⌘N, ⌃⌘F   | bir parmağın sürüklemesi                                                                                                          |
| Sola Döndür, Sağa Döndür                                   | ⌘←, ⌘→          | cihazın kendi yönü: ilk döndürme ajanı başlatır, bir simülatörün önce onu derlemesi gerekebilir                                   |
| Ekran Görüntüsünü Kaydet, Ekranı Kopyala                   | ⌘S, ⌘C          | cihazın kendi kayıpsız görüntüsü, Masaüstüne ve panoya ya da yalnızca panoya. Cihazın ajansız bir yolu olduğu yerde ajan gerekmez |
| Ekranı Kaydet                                              | ⌥⌘R             | Filmler'e: bir yayının kendi kareleri ya da görüntüsü yayın olmayan yerde cihazın kaydedicisi                                     |
| Akışı Kaydet                                               | ⌥⌘T             | bir kişinin yaptığı, bir akış olarak: bkz. [Bir akış kaydetmek](#bir-akış-kaydetmek)                                              |
| Bağlantı Aç…                                               | ⌘O              | aşağıdaki Bağlantılar paneli                                                                                                      |
| Bildirim Gönder…                                           | ⇧⌘P             | aşağıdaki Bildirim paneli                                                                                                         |
| Sığacak Kadar Büyüt, Gerçek Boyut, Yakınlaştır, Uzaklaştır | ⌘9, ⌘0, ⌘=, ⌘-  | Gerçek Boyut, bir cihaz noktasını bir Mac noktasına eşler                                                                         |
| Yeniden Bağlan                                             | ⇧⌘R             | yeni bir yayın                                                                                                                    |

Denetçi (⌥⌘I) sistemin kendi denetçisidir, 320 nokta genişliğinde ve kenardan kenaradır; pencere 1.100 noktanın altına daralınca kendiliğinden çekilir, kenar çubuğu da 860'ın altında; pencere yeniden genişleyince ikisi de geri gelir. Bölmeleri üst kenarında kendi satırlarında simgeler olarak durur; her biri imlecin altında ve ekran okuyucuya adıyla söylenir, seçilenin adı da altlarında kendi satırında durur. Hub'da açık, kendi penceresinde kapalı durur; o pencere de Denetçi'ye yer açmak için büyür. **Performans** ekranın nasıl olduğunu tek cümleyle söyler, sonra kare hızını, CPU'yu ve belleği her birinin bir dakikasıyla, ölçümleri ve **Sonuçlar**'ı gösterir: bu cihazda öndeki uygulama için daha önce ölçülenler; her biri kapının yöntemiyle, kapının referans olarak tutacağı şeye karşı değerlendirilir: aynı türde build'in kendisinden önceki temiz çalıştırmaları. `Regression +553 ms` ya da `Could not judge: 3 of 5 samples` diye okunur. Bir pencereden alınan bir çalıştırmada kodlayıcı cihazda çalışmaktadır, bu yüzden hiçbir referansa girmez; daha kötü okunan böyle bir çalıştırma `Could not judge: measured with a mirror running` der; bir gerileme, pencere açık olmayan çalıştırmalarda bulunur. Yalnızca dosya okur, bu yüzden bunun için bir telefona dokunulmaz. **Akışlar**, bir kişinin yaptığını kaydeder ve imlecin altında ne olduğunu söyler. **Uygulamalar** listeler, açar, kapatır ve kaldırır; sonuncusunu, onunla birlikte neyin gittiğini söyleyen bir sayfadan sonra yapar. iOS'ta liste sistemin uygulamalarını içerir, çünkü yeni bir simülatörde başkası yoktur; Android'de yalnızca kurulmuş olanları. **Etkinlik**, bir ajanın yaptığını iş parçaları halinde anlatır, `Worked for 40 s · 23 calls`, açılınca `Tapped Sign in`.

**Loglar**, öndeki uygulamanın logunu geldikçe gösterir: `logs` aracının okuduğu satırları, aynı gizlemeyle; bir satırdaki belirteç, parola ya da anahtar gizlenir. Uygulamayı Performans gibi izler, öndekini her 5 sn'de bir sorar ve başka bir uygulama için baştan başlar; kişinin kendi uygulaması olmayan ya da sunucunun uygulama listesinde bulunmayan bir uygulama adıyla söylenir ve hiçbir şey okunmaz. Ayrıntılı'dan Hatalar'a bir düzeyi, bir araması, durduğu yerden okumayı sürdüren Duraklat ve Sürdür'ü, bir seçimin dokunduğu satırların tamamını alan Kopyala'sı ve görünümü boşaltıp cihazın logunu asla silmeyen Temizle'si vardır. Yanındaki **Çökmeler**, uygulamanın son 5 raporunu `crashes` aracının verdiği gibi listeler; her biri ilk satırlarına ve raporun tamamının bu Mac'teki yoluna açılır. Log yalnızca panel görünürken ve duraklatılmamışken 2 sn'de bir okunur, arkada çalışır bir şey bırakılmaz: bir iPhone'da çalışan uygulamanın bu Mac'in okuyabileceği bir logu yoktur, panel bunu neyin okunabildiğiyle birlikte söyler.

**Ağ**, uygulamanın isteklerini `network` aracının verdiği gibi, o aracın cihaz için tuttuğu yakalamayla gösterir; böylece bir ajanın başlattığı yakalama burada, burada başlatılan da ajana görünür ve ikisi de aynı biçimde gizlenir: yöntem, adres, durum, süre ve boyut, seçilenin de tamamı. Yalnızca bu cihazın sahip olduğu yolları sunar: simülatörde uygulamayı yeniden başlatan, bu yüzden kayıt ya da ölçüm sürerken reddedilen sonda; Android'de baytlar ve derlemenin kaydettiği yerlerde Android 14'ten itibaren paketler; ikisi de adres olmadan sayar. Proxy yalnızca cihaz zaten birinden geçiyorsa sunulur ve listesi, onu Proxyman çalıştırıyorsa okunur: hiçbir pencere, hiçbir cihazda proxy ayarlamaz. Hiçbir yolun istekleri listelemediği yerde, bir iPhone'da ya da proxy'si olmayan bir Android'de, panel kişinin neye ihtiyacı olduğunu söyler. Sondanın listesi panel görünürken 3 sn'de bir, diğerleri Yeniden Oku ile okunur. Burada başlatılan bir yakalama pencere kapanınca durur.

**Erişilebilirlik**, `audit` aracının gösterilen ekranda bulduklarını türlerine göre, her türü sayarak gösterir. Bu, imlecin altındaki öğenin kontrastını söyleyen denetimin ta kendisidir, panel görünürken her türüyle: tek denetim, asla iki. Ekran panel görünürken okunur ve bir saniye aynı kaldığında denetlenir, çünkü bir denetim cihazın sırasını saniyelerce tutar; yeni bir ekran yeniden denetlenir, **Yeniden Denetle** de gösterileni denetler. Kayıt sürerken hiçbir denetim çalışmaz, çünkü bir tıklama o zaman kendi yaptığı ekranla adlandırılırdı; panel bunu söyler. Seçilen bir sorun, imlecin altındaki öğe gibi cihazın görüntüsünde işaretlenir. iOS 27.2 yüklü bir iPhone 17 Pro simülatöründe ve API 34 bir emülatörde, arkada tutulan hub'dan, 4 ile 10 arası yüklerde, her görünüm ve dilde çalıştırıldı: fixture'ın logu geldi, çökmesi raporları arasında durdu, yaptığı bir istek simülatörde belirteci gizlenmiş olarak, emülatörde bayt olarak durdu, erişilebilirlik ekranının sorunları da türlerine göre durdu, biri görüntüde işaretlendi.

**Bağlantılar**, bir bağlantıyı cihazda, bir ajanın çağırdığı araç olan `open_link` ile, aynı politika altında açar: bir web bağlantısı, bir evrensel bağlantı ya da App Link veya bir uygulamanın kendi şeması. Dosya menüsünde ve Diğer Denetimler içinde bulunan **Bağlantı Aç…** (⌘O), onu alanı hazır halde gösterir ve Return gönderir. İkinci bir alan, bağlantının açılacağı uygulamayı belirtir; cihaz öndeki uygulamanın bir kişinin kendi uygulaması olduğunu söylüyorsa onunla doldurulur ve sunucunun uygulama listesine karşı denetlenir: bir iPhone bir bağlantıyı yalnızca adı verilmiş bir uygulamada açar, başka yerlerde boş bir alan seçimi sisteme bırakır. Yanıtı iş ilerledikçe gelir ve bir ret tam olarak, hub'ın sözleri varsa yapılacak şey de bir kişinin sözleriyle, İngilizce ve Türkçe gösterilir: aracın bir ajana verdiği, bir çağrıyı değiştirip yeniden yapmasını söyleyen bir ipucu gösterilmez. Açılan bağlantılar o cihaz için saklanır, son sekizi, en yenisi önce; altlarında, uygulama alanındaki uygulamanın açtığı bağlantılar, `open_link` `links`'in listelediği gibi, her birinin türü ve bir alan adının durumuyla durur. Seçilen biri alana yerleşir; bir filtrenin `*` kısmı bir kişinin doldurması için bırakılır. Bir kişinin gönderdiği bağlantı hiçbir ajanın değildir: kapsül bir yapay zekâ istemcisinin yönettiğini söylemez ve Etkinlik onu listelemez. İlki, bir ajanın ilk çağrısı gibi, cihazda bir oturum açar. Bir simülatör, bir uygulamanın şeması onu ilk kez açmadan önce sorar ve yanıt bunu söyler, çünkü bir kişi pencerede yanıtlayana kadar hiçbir şey açılmamıştır. Arkada tutulan bir pencereden, iOS 27.2'li bir iPhone 17 Pro simülatöründe ve bir API 34 emülatöründe, 7 ile 57 arası yüklerde çalıştırıldı: `appdyno-fixture://open/form` fixture'ı formunda açtı ve `javascript:alert(1)` reddedildi, hiçbir şey açılmadı. Aynısı iOS 27.2'li bir iPhone 13 Pro Max'te (fixture uygulama alanında adıyla verildi) ve USB üzerinden Android 14'lü bir Samsung Galaxy A52'de, 6 ile 11 arası yüklerde.

**Bildirim**, bir ajanın çağırdığı araç olan `push` ile bir uygulamaya push gönderir. Dosya menüsünde ve Diğer Denetimler içinde bulunan **Bildirim Gönder…** (⇧⌘P) onu gösterir ve her seferinde op'a bu cihazın neleri aldığını sorar. Op'un listelediği her tür sunulur; cihazın almadığı bir tür nedeniyle birlikte durur ve seçilemez. Alanlar, op'un listelediği gibi türü izler; **Yük** de op'un o tür için kendi şablonundan başlar ve alanların yerine gönderilir. Uygulama, cihazın bir kişinin kendi uygulaması olduğunu söylediği öndeki uygulamadır ya da yazılan uygulamadır; türler de o uygulamanınkilerdir ve bir kişi birini yazmayı bitirince yeniden sorulur, çünkü bir Android uygulamasının build'i başka bir yol izleyebilir. Bir alanda Return gönderir ve yanıt bir bağlantınınki gibi gelir, bir ret tam olarak. Bir kişi APNs ya da FCM'yi `appdyno push setup` ile kurduktan sonra, onun üzerinden giden bir rota uygulamanın yazdırmadığı bir token alır: rotanın altında, yazılırken görünmeyen, rotaların kullandığı token türlerini seçilen türün token türü başta olmak üzere sunan bir alan, paneldeki uygulama için yalnızca bu oturum boyunca bir token saklar, panelin söylediği gibi; bunu bir ajanın çağırdığı hiçbir araç üzerinden yapmaz ve hiçbir şey onu geri söylemez, loglamaz ya da bir yere yazmaz; o türden bir push sonra onunla gider. Arkada tutulan bir pencereden, iOS 27.2'li bir iPhone 17 Pro simülatöründe 5 ile 12 arası yüklerde, uydurma APNs kimlik bilgileriyle ve push Apple'ın yerine teste gönderilerek çalıştırıldı: alan bu bilgilerle göründü, onlarsız yok oldu ve zengin bir push yazılan token ile gitti. Arkada tutulan bir pencereden 40 ile 52 arası yüklerde çalıştırıldı: iOS 27.2'li, yeni silinmiş bir iPhone 17 Pro simülatöründe başlığı ve bir veri anahtarı olan bir uyarı, bir kişi pencerede uygulamanın bildirimlerine izin verdikten sonra fixture'ın koduna ulaştı; bir API 34 emülatöründe ve Samsung'da dokunulan bir push, fixture'ı iki veri anahtarı extras olarak verilmiş halde açtı ve fixture bunları gösterdi. iPhone'da panel her türü iPhone'un kendi nedeniyle listeledi ve bu yüzden gönderilecek hiçbirini sunmadı.

**Cihaz**, bir ajanın çağırdığı araç olan `device_setting` ile cihazın koşullarını ayarlar: karanlık mod, metin boyutu, dil, hareketi azaltma, kontrastı artırma, saydamlığı azaltma, animasyonlar, ağın hızı, Wi-Fi, mobil veri, uçak modu, bir proxy, pil düzeyi, ısıl durum ve katlama; `set_location`'ın ayarladığı gibi bir konum; cihaz alıyorsa Face ID ya da parmak izi, gelen bir arama ve bir kısa mesaj; kendi sözü olmayan bir mesaj pencerenin dilinde `Sent from the window` der. Her denetim, bölme her gösterildiğinde yeniden sorulan, cihazın okuduğu değeri gösterir; bu cihazın yapamadığı şey, bir kişinin okuyacağı sözlerle kısa bir nedenle, örneğin `This device does not fold.`, devre dışı durur; bir ajana sürücünün nedeni söylenir; pencerenin sözü olmayan bir neden sürücünün verdiği gibi gösterilir. Bir telefonda Wi-Fi, uçak modu, mobil veri ve proxy de devre dışı durur, çünkü her biri hub'ın ona Wi-Fi ya da Wi-Fi üzerinden adb ile giden bağlantısını kesebilir. Bir değişiklik, bir ajanın değişikliklerinin girdiği tek kayda girer ve burada değiştirilen şeyi bir nokta gösterir. **Tümünü Geri Al**, `device_setting` `restore`'un geri aldığını geri alır; çalışan bir ajanın değiştirdiğini o ajana bırakır. Pencerenin değiştirdiği, cihazı pencereden ayrıldığında, pencere kapanınca ya da hub'da başka bir cihaz seçilince geri alınır ve hub ancak bundan sonra biter. Arkada tutulan bir pencereden, bir API 34 emülatöründe 5 ile 10 arası yüklerde çalıştırıldı: bölmenin ayarladığı karanlık mod ve 1.3 metin boyutu emülatörde öyle okundu; bir konum, bir arama ve bitişi ve bir kısa mesaj ona ulaştı; koyu ve açık görünümde, İngilizce ve Türkçe, hub penceresi kapandıktan 2,4 ile 2,9 sn sonra bitti ve ikisi de önceki gibi okundu. iOS 27.2'li bir iPhone 17 Pro simülatöründe 7 ile 33 arası yüklerde aynı ikisi ayarlandı ve öyle okundu; telsizler, ağın hızı, pil, ısıl durum, katlama, animasyonlar, bir arama ve bir kısa mesaj simülatörün kendi nedenleriyle devre dışı durdu; bir konum ayarlanıp temizlendi ve hub penceresi kapandıktan 0,5 ile 1 sn sonra bitti, ikisi de önceki gibi okundu.

Bir ajan yönetirken ekranın çevresinde mor bir halka döner, kapsül bunu söyler, istemci kim olduğunu söylüyorsa onun adını verir, her dokunuşun indiği yerde de bir nokta solar. Bir kişiye yöneltilen bir istek halkayı turuncuya çevirir.

Bir cihazla görüntüsü arasında duran şey, sonraki adımıyla birlikte sözlerle söylenir. Uykudaysa ya da kilitliyse, soluklaşmış görüntünün üstünde yapılacak şeyi ve **Yeniden Dene**'yi gösteren bir kart durur; düğmesinin yanına bir tıklama yine cihaza gider. Karanlık bir ekranda ikisi de ekranı yakar, çünkü bunu isteyen kişi ekranı geri istiyordur. İlk görüntüsünden önce takılıp kalan bir cihazın soluklaştıracak görüntüsü yoktur, bu yüzden alan bunu aynı sözlerle söyler. Kablosu çıkarılan bir telefon **Sizi Bekleyenler** altında `Unplugged` olarak seçili kalır ve kendiliğinden geri gelir; başka bir cihazla değiştirilmez. Yalnızca şarj eden bir kablo hiç telefon yokmuş gibi görünür, çünkü bu Mac'e ikisini ayırt ettirecek hiçbir şey ulaşmaz; bu yüzden bir kişinin okuduğu metin bunu da söyler.

Hareket değişen şey içindir: kenar çubuğunda gelen ya da giden bir cihaz, 200 ms; hemen beliren bir çerçeveye solarak gelen ilk kare, 200 ms; halka, 240 ms; bir nokta, 300 ms; bir ölçüm çubuğunun bir adımı, 150 ms; bir gerileme için küçük bir yay. Durgunken hiçbir şey hareket etmez ve Reduce Motion açıkken her biri düz bir kesmedir. VoiceOver gelen ya da giden bir cihazı ve bulunan bir gerilemeyi duyurur.

## Canlı sayılar

**Performansı Göster** (⌥⌘P), cihazın yanında her ölçüm için bir kart açar: kare hızı, takılma, donmuş kareler, CPU, bellek ve ağ; her biri son dakikasını bir çizgi olarak, durumunu da bir rengin yanı sıra sözlerle ve bir simgeyle gösterir. Açılana kadar hiçbir şey okunmaz, kapandıktan sonra da hiçbir şey. Sayılar, altlarında adı yazan öndeki uygulamanındır ve `perf_*`'ın yansıtılan bir cihazı işaretlediği gibi, yayın açıkken okunmuş olarak işaretlenir.

Bir cihaz her saniye kendi ölçümlerinin okuduğunu, `perf_*`'ın kullandığı aynı okuyucularla verir; belleğini ise her beş saniyede bir, çünkü en ağırı odur. Bir okuma yalnızca bakar: bir kişinin kapattığı ekran kapalı kalır. Veremediği şey nedeniyle birlikte bir tiredir, asla 0 değil. Bir cihazın kare saymadığı yerde kare hızı pencerenin kendisinin gösterdiğidir ve durgun bir ekran Durgun der. Bir kare hızının doğru bir değeri yoktur, çünkü bir ekran ne çizmesi gerekiyorsa onu çizer: yalnızca karelerinin ne kadarının geç geldiğine göre değerlendirilir; geç karelerin sayılmadığı yerde karar olmadan durur.

| cihaz             | kare hızı  | takılma, donma               | CPU, bellek, ağ |
| ----------------- | ---------- | ---------------------------- | --------------- |
| simülatör         | pencerenin | yalnızca kare ölçeri altında | okunur          |
| Android emülatörü | cihazın    | okunur                       | okunur          |
| Android telefon   | cihazın    | okunur                       | okunur          |
| iPhone            | ekranın    | hayır                        | CPU ve bellek   |

Bir iPhone'un kare hızı ekranınınkidir; tek başına bir yansıtma onu 20 civarında tutar ve bu, sayının yanında yazar. Runner'ı yalnızca kendisine verilen uygulama hakkında bilgi verebilir, bu yüzden bir pencere bunu bir kişinin uygulamalarının her biri için sorar ve onları izlemek için her beş saniyede bir yeniden sorar: aynı uygulama önde kaldıkça tek çağrı.

Bir simülatörün bunların hiçbiri için runner'a ihtiyacı yoktur: öndeki uygulamayı okuma yardımcısıyla okur ve ana ekran da herhangi bir uygulama gibi ölçülür. Ajanı olmadan önde ne olduğunu söyleyemeyen bir cihaz, kartlar açılınca ajanı başlatır ve kartlar ajan ayağa kalkana kadar bunu söyler.

Denetçi'deki **Performans**, aynı okumaları gösterildiği süre boyunca on dakikaya kadar tutar ve öndeki uygulamanın gerçek bir ölçümünü alır. **Açılışı Ölç** `perf_launch`, **Kaydırmayı Ölç** de `perf_scroll`'dur; bir ajanın çağırdığı gibi, varsayılanlarıyla: uygulama yeniden başlar ve çalıştırma diğer hepsiyle birlikte, yayın açıkken okunmuş olarak işaretlenip saklanır. **Gösterge Panelini Aç**, saklanan tüm çalıştırmaların sayfasını yazar ve açar. Bir ölçüm sürerken okumalar durur, çünkü ölçümün saydığını sıfırlarlardı. Bir ölçüm cihazı bir ajanın oturumu gibi tutar ve cihazı başka bir şey tutarken adıyla reddedilir. Sisteme ait olan, örneğin bir ana ekran, ölçülmez.

## Bir akış kaydetmek

**Akışı Kaydet** (⌥⌘T), bir kişinin pencerede yaptığını bir akış olarak, yani `flow run`'ın yeniden oynattığı dosya olarak yazar. **Akışlar** paneli cihazın yanında açılır ve her adımı yazıldıkça listeler. İkinci bir basış kaydı durdurur ve Masaüstüne `<device> <date>.flow` olarak kaydeder; pencereyi kapatmak da bir film için olduğu gibi aynısını yapar.

Bir kişinin ne demek istediğini, yerle değil öğeyle yazar. Her tıklama, `flow start`'ın kuralıyla, bir aracın o tıklamanın indiği ekranda kullanacağı seçiciyle adlandırılır; böylece bir cihazda yapılan bir akış, seçicinin tuttuğu her yerde aynı uygulamanın başka bir cihazında çalışır.

| pencerede                                    | dosyada                                                                                                                                                                                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bir tıklama                                  | `tap id=submit`                                                                                                                                                                                                                                                       |
| çift tıklama                                 | `double_tap id=submit`                                                                                                                                                                                                                                                |
| basılı tutma, sağ tıklama                    | `long_press id=submit`; olağan 0,8 s değilse `durationMs` ile                                                                                                                                                                                                         |
| sürükleme, tekerlek, iki parmak              | `swipe up`; hedef yalnızca ekranın ortasından yapılan bir kaydırmanın başka bir şeyi hareket ettireceği yerde eklenir. Bir tekerleğin çentikleri tek bir kaydırmadır. Bir sonraki tıklanana ulaşan kaydırmalar `scroll_to` olur, bu da her ekran boyutunda geçerlidir |
| yazma, yapıştırma                            | `type "Ada"`; alan boşsa `replace` ile, çünkü kastedilen alanın bunu söylemesidir; Return ile bittiyse `submit` ile. Delete bir harfi geri alır                                                                                                                       |
| bir parola alanına yazma                     | `type "${PASSWORD_INPUT}"` ve `secret PASSWORD_INPUT`: metin ne dosyaya ne de diskteki kayda ulaşır                                                                                                                                                                   |
| hiçbir okumanın alan göstermediği yere yazma | `type "${TYPED}"` ve pencere bunu söyler: böyle bir alan bir parola alanı olabilir                                                                                                                                                                                    |
| cihazın kendi klavyesine tıklamalar          | dokunuş yok: alanın son metninin bir `type`'ı, alandan okunarak; parola alanında ise adı                                                                                                                                                                              |
| Ana Ekran, Geri, bir düğme, bir tuş          | `press_key home`; basılı tutulan bir tuş `count` olur                                                                                                                                                                                                                 |
| Uygulamalar panelinde Aç ve Kapat            | `launch`, `stop`                                                                                                                                                                                                                                                      |

Önde bir kişinin kendi uygulaması varsa akış `launch` ile başlar; bu, uygulamayı öne getirir ve hiçbir şeyi yeniden başlatmaz, böylece başka bir cihazın oraya varmanın bir yolu olur. Bir kayıt uygulamanın bulunduğu yerde başlar: uygulamanın derinlerindeki bir ekrandaysa yeniden oynatma da orada başlamalıdır.

Bir kayıt söylemeden hiçbir şeyi atlamaz. Adımı olmayan şey (bir kıstırma, bir döndürme, Hızlı Ayarlar, hiçbir eksen boyunca olmayan ya da bir uzun basıştan sonraki sürükleme, Page Up ve benzerleri, kaldırılan bir uygulama) o anda pencerede söylenir ve `unrecorded` olarak yazılır; bu, bir yeniden oynatmayı onsuz sürdürmek yerine orada durdurur. Hiçbir şeyin adlandırmadığı bir yer ya da kenardan gelen bir parmak koordinat olarak yazılır, geçerli olduğu ekran boyutuyla `!coordinates` olarak işaretlenir ve pencere bunu söyler. İkisi de nedenleriyle panelin listesinde durur. Bir ölçüm uygulamayı yeniden başlatır, bu yüzden bir kayıt sürerken adıyla reddedilir.

**Bir tıklamanın kastettiği ekran.** Kendisinden önceki ekrandır ve bir tıklama bilindiğinde etkisi başlamıştır. Bu yüzden bir kayıt sürerken ya da panel açıkken ekran, dokunuşların yanında sürekli okunur: bir dokunuş, buradaki herhangi bir şey onu duymadan önce cihaza yola çıkmıştır; parmak basılıyken ya da sonraki 100 ms boyunca hiçbir okuma başlamaz ve bir okuma zamanın en çok yarısını alır. Bir tıklama son girdiden bu yana en yeni okumayı, yoksa sürmekte olanı alır. İmleci üzerinde tutmak cihaza hiçbir şey sormaz. İkisi de kullanımda değilken, yayın kapalıyken ya da bir ölçüm sürerken hiçbir şey okunmaz. Böyle bir okuma bir bakıştır: bir araç için `tree`'nin yaptığı gibi, karanlık bir ekranı uyandırmaz ve kilit açmaz.

Bir tıklamadan değiştirdiği ilk görüntüye kadar, her iki durumda 15 tıklama, her biri durgun bir ekrandan, arkada tutulan bir pencere üzerinden. Simülatörde tıklama bir listenin ilk Add'ine, Android'de ise bench'inki gibi fixture'ın frames düğmesine yapılır; bu düğme her kareyi 2 s boyunca çizer. Kaydı olmayan bir pencere Android'de UI otomasyonu tutmaz ve bunlar onsuz başlar. Bir iPhone'da tıklamanın yerine listede bir fiske kullanılır, çünkü küçük bir değişiklik yayınının sürekli gönderdikleri içinde kaybolur.

| cihaz                | kayıt yok, p50, ms | kayıt, p50, ms | Mac'in yükü |
| -------------------- | ------------------ | -------------- | ----------- |
| simülatör, iOS 27.2  | 102,3              | 109,8          | 4           |
| emülatör, Android 14 | 33,2               | 35,1           | 3           |
| Xiaomi, Android 16   | 68,2               | 67,1           | 3           |
| iPhone 13 Pro Max    | 110,7              | 109,0          | 10          |

**İmlecin altında.** Akışlar paneli açıkken cihazın üzerindeki imleç, altındaki öğeyi görüntü üzerinde işaretleyerek gösterir: rolünü, sözlerini, ref'ini ve id'sini, oraya bir tıklamanın ne yazacağını ve `audit`'in kontrastı hakkında ne dediğini; bu, ekran başına bir kez okunur. Bir denetim imlecin durmasını bekler, bir simülatörün runner'ını başlatabilir ve panel, bitene kadar okuduğunu söyler. Bir kayıt sırasında hiçbir denetim çalışmaz, çünkü bir denetimin arkasında bekleyen bir okuma, adlandıracağı tıklamadan sonra gelirdi; panel bunu söyler. Cihazdaki bir tıklamanın ne yapacağı orada seçilir: cihaza **Dokunur**, öğenin seçicisini **Kopyalar** ya da kayda bir doğrulama ekleyen ve hiçbir şeye dokunmayan **Doğrular**: `assert id=result check=text equals="Sent: Ada"` ya da öğeyi sözleri adlandırıyorsa `assert text="Bilgiler"`.

Kayıt, `flow`'un tuttuğu kayıttır, cihaz başına bir dosya. Bu yüzden bir ajandan ya da komut satırından gelen `flow start` bir kişinin tıklamalarını da alır, bir pencerenin kaydı da bir ajanın çağrılarını alır; her biri geldiği sırayla. Bir akışın `stop` ve `save`'i ikisinde de çalışır.

## Hub

`appdyno hub` tek bir penceredir: bu Mac'in ulaşabildiği her cihaz bir kenar çubuğunda, önce telefonlar, sonra çalışanlar, kapalı olanlar katlanmış halde; seçilen cihaz da yanında canlıdır ve orada denetlenir. Bir simülatörle bir Android emülatörü arasında başka birini seçmek, yaklaşık 250 yükte 0,4 ile 0,8 s sürdü. Yalnızca pencerede duran yayın yapar ve bir telefon yalnızca bir kişi onu seçtiğinde başlar: zaten çalışan bir simülatör ya da emülatör hemen görünebilir ve hiçbir seçim bir açılıştan diğerine saklanmaz. Araç çubuğu sistemin kendi araç çubuğudur; kendi penceresindekiyle aynı denetimleri taşır ve yalnızca o cihazda olanları. Denetçi bir tık uzaklıktadır, önce Performans. Arama katlanmış olanları da kapsar. Hub sanal olanları başlatır ve durdurur, bu Mac'te kurulu olandan yeni bir simülatör ya da emülatör oluşturur. Gösterilecek bir şey olmayan yerde sıradaki adımı söyler.

Cihazların altındaki **Yapay Zekâ İstemcileri**, `appdyno install`'ın bildiği her MCP istemcisini gerçek durumuyla listeler. Bağlı sözünü yalnızca gerçek bir çağrı kazandırır: sunucu her istemcinin adını, sürümünü, giriş yolunu ve son çağrısını tutar, gönderdiği hiçbir şeyi tutmaz. Ekle ve Kaldır önce satırların tam halini gösterir ve ikinci bir tıklama ister; Geri Al da o tek girdiyi geri alır. Test Et, bir girdinin çalıştırdığını araç listesine kadar çalıştırır ve başarısız olursa ne yapılacağını söyler; hiçbir araç çağırmaz. Tarayıcıdaki bir istemci için `appdyno mcp --http`'yi, hub ile biten bir süreçte, token istenene kadar gizli olarak başlatır ve durdurur. Bir istemcinin adı üst süreç tarafından `packages/cli/src/clients.ts`'ten gelir, asla viewer'dan değil. Bkz. [İstemci bağlamak](../guides/clients.tr.md).

Yapay Zekâ İstemcileri'nin altındaki **Yardım** ya da command-? ağ gerektirmez. appdyno'nun ne olduğunu söyler, en son önde olan cihaz ve uygulamayla doldurulmuş, hedefe göre istemler sunar, her biri cihaza ne yaptığını söyler; her panelin ve sayının ne anlama geldiğini anlatır ve `doctor`'ı çalıştırır. Uygulama, Performans panelinin en son adını verdiği uygulamadır; bu yüzden bir sistem uygulaması ya da bir simülatörde yayını başladıktan sonra açılan bir uygulama, `my app` diyen bir istem bırakır. Bir yer, bir cihazın duracağı yerde durur, bu yüzden cihazın yayını biter ve bir cihaz seçilene kadar Denetçi kapanır. Yardım görünürken istemci listesi her 2 s'de bir okunur, görünmezken hiçbir şey çalışmaz.

Diğer Denetimler menüsünde, bir satırın menüsünde ya da shift-command-N ile bulunan **Yeni Pencerede Aç**, bir cihaza kendi penceresini verir; bu, `appdyno mirror`'ın aynı kodla açtığı penceredir: hub onun orada olduğunu gösterir ve onu kapatabilir. Ölen bir viewer içinde duranı da götürür ve hub onu sahip olduğu cihazla geri getirir: bir Android emülatöründe ve bir simülatörde süreci öldürüldüğünde 0,6 s. Bir dakikada üç kez olunca durur.

## Telefon Bağla

Hub'ın gösterecek bir şeyi olmadığında yerinde Telefon Bağla durur ve kenar çubuğundaki satırı ona sonra da ulaşılabilmesini sağlar. Hiçbir şeyi bekletmez: o görünürken hub'ın diğer her bölümü açık kalır.

Elinizdeki telefonu kendisi bulur. Mac'in USB kaydı, telefon neye izin verirse versin, takılı olanı kimin yaptığını söyler ve telefona hiçbir şey sormaz: USB hata ayıklaması kapalı bir Android, adb'nin ondan haberi olmadan önce oradadır. Bu yüzden adb yalnızca elde bir Android varken, Google'ın koşulları gösterildikten sonra istenir; Xcode ise yalnızca bir iPhone varken. USB'de hiçbir şey yoksa bunu açıkça söyler; yalnızca şarj eden bir kablonun hiçbir şey göstermediğini ve başka bir kablo denenmesini de söyler.

Her sürücü kendi adımlarına sahiptir (sağlayıcısındaki `guide`); gerçekleri `doctor` ve `NEEDS` tutar. Geçerli adım kısa bir cümle ve viewer'da çizilen bir diyagramdır ve telefonun durumu değiştikçe ilerler:

| Telefon | Adımlar                                                      | Nasıl ilerler                                                                                                                                 |
| ------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Android | adb'yi edinin                                                | `doctor` adb'yi bulur                                                                                                                         |
|         | Geliştirici seçenekleri, USB hata ayıklama                   | adb telefondan haberdar olur. Bir Mac'ten bakınca bu ikisi tek bir durumdur, bu yüzden bir kişi aralarında İleri ile geçer                    |
|         | USB hata ayıklamaya izin verin                               | adb'nin durumu `unauthorized`'dan `device`'a geçer                                                                                            |
| Xiaomi  | USB hata ayıklama (Güvenlik ayarları), USB üzerinden yükleme | `persist.security.adbinput` ve `adbinstall` `1` olarak okunur. İkisi de telefonu bekletmez: öyle okunmadıkları yerde bir kişi İleri ile geçer |
| iPhone  | Xcode'u edinin, Güven, Geliştirici Modu                      | `devicectl`'ın eşleştirme ve Geliştirici Modu durumu                                                                                          |

Derleme numarasının yeri Samsung, Xiaomi ve Pixel için adıyla söylenir; başka bir üreticinin telefonunda nerede olabileceği söylenir. Geliştirici Modu, öncesinde telefonun yeniden başlayacağını söyler. Bir kilit ya da karanlık bir ekran yalnızca telefon okunabildiğinde söylenir. Bu Mac'e izin vermemiş bir telefonda hiçbir şey okunamaz, bu yüzden o adım telefonu uyandırmayı söyler. Bir runner'ın neye ihtiyacı olduğu, yanında Çalıştırıcıyı Derle ile, `doctor`'dan gelir.

Bu yer gösterilirken, sahnede hiçbir cihaz yokken hazır hale gelen bir telefon kendiliğinden açılır. Sahne, neyin deneneceğine dair tek bir cümleye yer açar, Yapay Zekâ İstemcileri bir tık uzaklıktadır; cümle 12 s sonra kendiliğinden gider. Bir kişi başka bir yerdeyken hazır hale gelen bir telefon satırını alır ve hiçbir şey kıpırdamaz; iki telefondan ilki açılır, ikincisi satırını alır. Baştan beri hazır olan bir telefon, diğer her telefon gibi satırını ya da Aç'ı bekler: bir telefona yalnızca bir kişi onunla çalıştığında ya da onu seçtiğinde dokunulur. Sizi Bekleyenler altındaki bir telefon burada, kendi adımında açılır. Bu yer görünürken telefon her 3 s'de bir okunur, görünmezken hiçbir şey okunmaz.

## Araçlar

Araçlar, appdyno'nun bir terminalde yaptığını çalıştırır; her satır komutun kendisidir ve hub onu tek bir tablodan (`packages/appdyno/src/hub-run.ts` içindeki `HUB_RUNS`) başlatır; aynı işi yapan ikinci bir kod yoktur. Bir pencerenin gönderdiği hiçbir şey kendi başına komut olmaz. Bir satır, cihazı, ne kadar sürdüğü ve sayfasıyla birlikte bir kişiye yönelik bir cümleyle biter. Komut ve söylediği her şey Ayrıntıları Göster'in arkasında durur, böylece hiçbir cihaz kimliği ya da geçici yol araya girmez. Bir uygulaması, cihazı ya da klasörü eksik olan satır soluk durur ve eksik olan en üstte bir kez söylenir. Durdur, komutun başlattığı her şeye Ctrl-C gönderir, böylece bir uçuş kaydedici tuttuğunu kaydeder. Kapının satırı, kapının çıkış koduna göre değil yazdırdığına göre davranır; çıkış kodu bir gerileme için de karar veremediği bir değişiklik için de aynı biçimde 1, çok az örnek için 0'dır: bir gerileme kırmızı, karar veremediği turuncu, yalnızca net bir yanıt yeşildir. Çalıştırması eksik bir baseline kaydedilir ve bunu söyler.

| Hub'da                                                             | Komut                                                 |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| Temel Ölçüm Olarak Kaydet, Temel Ölçümle Karşılaştır, Nedenini Bul | `perf baseline`, `perf compare`, `perf why`           |
| Her Şeyi Ölç                                                       | `perf survey`                                         |
| Akışları Çalıştır                                                  | `test`, çıktıları seçilen klasöre                     |
| Zaman Çizelgesi, Uçuş Kaydedici                                    | `timeline`, `flight`                                  |
| Gösterge Paneli                                                    | `perf dashboard` ve açılır                            |
| İz Araçlarını Al, uygulamanın dışında, adb'yi edinin               | `tools install`, `tools install adb --accept-license` |
| Telefon Bağla içinde Wi-Fi için Eşleştir, Eşleştirmeyi Unut        | `pair`, `pair --forget`                               |
| Tüm Yapay Zekâ İstemcilerine Ekle                                  | önce `install --dry-run`, sonra `install --yes`       |
| PATH'e Ekle, PATH'ten Çıkar                                        | `path`, `path --remove`, yalnızca uygulamadan         |
| Güncellemeleri Denetle, Güncelle                                   | `update --check`, `update`                            |
| Telefon Bağla içinde Çalıştırıcıyı Derle                           | `ios build`                                           |

Hub'ın başka yerlerinde: Doktor Yardım'dadır; kenar çubuğunda `devices`, yeni bir simülatör ya da emülatör oluşturma ve birini başlatıp kapatma vardır; Yapay Zekâ İstemcileri'nde de `mcp --http` ve her istemcinin `install`'ı vardır.

CI ya da betikler için oldukları ya da bir oturuma ait oldukları için bilerek dışarıda bırakılanlar:

| Dışarıda bırakılan                                                                                                              | Neden                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `bench`                                                                                                                         | Boşta duran bir makinede bir sürücüyü diğerlerine karşı zamanlar: bu projenin kendi sayıları için                                               |
| `perf comment`                                                                                                                  | Bir CI'ın göndermesi için Markdown yazar                                                                                                        |
| `perf budget`                                                                                                                   | Bütçeler kodla birlikte tutulan bir dosyadır ve `perf compare` onu okur                                                                         |
| `perf reference`                                                                                                                | Baseline'ın build'inin cihaza geri kurulmasını gerektirir: bir betiğin adımı                                                                    |
| `perf functions`                                                                                                                | Saklanmış iki profil kimliği alır; bir kişinin burada bunların listesi yoktur                                                                   |
| `perf prune`                                                                                                                    | Saklanan trace'ler kendiliğinden budanır                                                                                                        |
| `report`                                                                                                                        | Bir oturumun kendi adımlarından yazılır, bu yüzden bir ajana aittir. Zaman Çizelgesi, Uçuş Kaydedici ve Gösterge Paneli kendi sayfalarını yazar |
| stdio üzerinden `mcp`                                                                                                           | Bir istemcinin kendisi için başlattığı                                                                                                          |
| `version`                                                                                                                       | `update --check` bunu söyler                                                                                                                    |
| `--junit`, `--format`, `--retries`, `--tag`, `--env-file`, `--param`, `--share`, `--measurements` ve `--allow-*` gibi bayraklar | Bir pipeline içindir ve her birinin burada mantıklı tek bir varsayılanı vardır                                                                  |
| `tap` ya da `screen` gibi tek işlemler                                                                                          | Cihazın penceresi bunları elle, bir istemci de araçlarıyla yapar                                                                                |

## İki cihaz

Hub'ın kenar çubuğundaki bir satırda bulunan **Bunun Yanında Göster**, penceresini iki cihaz arasında böler: bir iPhone ve bir Android telefon ya da iki cihazın her birinde bir build. `appdyno mirror --device A --device B --pair`, aynısını tek bir süreçten yan yana iki pencere olarak açar. Birini kapatmak diğerini tek başına bırakır. İkisinden birinde zaten açık olan bir pencere önce kapanır.

İki pencereden birindeki bir dokunuş ikisine de gider. Ne kastettiği inmeden önceki haliyle okunsun diye iki ekranın da okunmasını bekler, sonra ikisine birden aynı anda gider. **İkisine de**'nin bedeli bu beklemedir: bir okuma bir simülatörde ve bir Android emülatöründe 30 ile 60 ms sürdü, iki telefonda ise bekleme, tablonun dediği gibi 150 ile 250 ms'ye varır. Diğer cihazda, id'ye ya da sözlere göre aynı şeye gider ve aynı biçimde adlandırılanlar arasından aynısına; çünkü iki cihazda bir şey nadiren aynı yerdedir. Adı olan hiçbir şeyin üstünde olmayan bir parmak aynı yere gider ve bir sürükleme indiği yerden uzunluğunu korur. Tuşlar, metin ve pencerenin cihaz denetimleri ikisine de gider.

Gerçek bir tıklamanın bırakılmasından penceredeki ilk değişen görüntüye kadar; yan yana bir Samsung SM-A525F ve bir Xiaomi 25078RA3EY'de, 720x1600'de, yük 5, her iki durumda 15 tıklama, her biri yerine ulaşarak. Bu, bench'in değil bir kişinin kendi ölçümüdür; bench bir kare gelince durur:

| Tıklanan | Yalnızca burada, iki yayın açık, p50, ms | İkisine de, tıklanan cihazda, p50, ms | İkisine de, diğerinde, p50, ms |
| -------- | ---------------------------------------- | ------------------------------------- | ------------------------------ |
| Xiaomi   | 97                                       | 243                                   | 265                            |
| Samsung  | 113                                      | 368, 180 ile 623 arası                | 363                            |

Yalnızca burada, her telefonun tek başına okuduğudur; bu yüzden ikinci bir yayın ölçülebilir bir bedel getirmez ve İkisine de'nin eklediği o beklemedir. Okumalar ondan ayrı olarak zamanlanmadı.

Her cihaz bir dokunuşun nereye gittiğini ve ona ne olduğunu söyler. Alt başlık, cihazın çevresinde vurgu renginde bir kenarla **İkisine de** ya da bağlantı denetimi kapalıysa **Yalnızca burada** der ve bir halka bir dokunuşun her ekranda nereye indiğini gösterir. Başarısız olduğu yerde cihazın kenarı kırmızıya döner ve alt başlık, bir dokunuş yerine ulaşana kadar nedenini söyler: o cihazda öyle bir şey yoksa `No Send here` ve başka hiçbir şeye dokunulmaz, `iPhone 17 Pro is not live`, `That did not land`. Böyle bir şeyin üstünde başlayan bir sürükleme aynı yerden sürer, çünkü tek bir şeyi kastetmez. Çubuğu bir tarafı anlatan hub penceresinde her görüntü, altında kimin olduğunu ve bir dokunuşun nereye gittiğini ya da neyin başarısız olduğunu kırmızıyla söyler, kenar çubuğu da çubuğu açık olan cihazı seçer.

Performans'taki **Yolculuğu Ölç…**, bir akışı `iterations` ile `flow` `run`'ın yaptığı gibi ölçer: ilk çalıştırma dışarıda bırakılır, beşi saklanır, aynı depoda: `perf_compare` onu kapıdan geçirir ve dashboard onu diğer her cihazın yanında gösterir. Uygulama adı vermeyen bir akış öndeki uygulamanızı alır, böylece iki kimlik altındaki build'ler tek bir dosyayı çalıştırabilir. İki pencerede önce bir cihazda sonra diğerinde çalışır, çünkü ikisi aynı anda birbirine yük bindirirdi; bu arada dokunuşlar kendi pencerelerinde kalır. Her pencere sonra durumunu söyler: `97 % slower, 1641 ms there` ve en çok değişen adım, kapının sırayla ölçülen iki koşul için kullandığı sıra testi ve tabana göre; ya da `No clear difference`. Her adımın sayıları satırın araç ipucundadır. Yolculuğun başarısız olduğu pencere bunu kırmızıyla söyler, diğerinin karşılaştıracak bir şeyi yoktur.

## İmleç ve trackpad

| pencerede                        | cihazda                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| tıklama, sürükleme, çift tıklama | dokunma, kaydırma, çift dokunma                                                                 |
| basılı tutma                     | basılı tutulduğu sürece bir uzun basış                                                          |
| sağ tıklama                      | bir ajanınki gibi 0,8 s'lik bir uzun basış; çerçevenin üstünde ya da yanında, Cihaz menüsü      |
| kaydırma tekerleği, iki parmak   | tek parmakla sürükleme: cihaz bir parmakla olduğu gibi kayar ve süzülmeyi cihazın kendisi yapar |
| trackpad'de kıstırma             | imlecin iki yanında iki parmak                                                                  |
| çerçeveden bir sürükleme         | dışarıdan gelen bir parmak gibi ekranın kenarından başlar: her sistemin kenar hareketleri       |

Bir nokta imlecin dokunduğu yeri gösterir, kıstırmada iki nokta. Çerçeve yokken görüntünün en dıştaki pikselinden bir sürükleme, çerçeveden yapılanla aynı işi yapar.

## Klavye

Bir pencere klavyeyi asla kendiliğinden almaz: ne açılırken, ne yeniden bağlanırken ya da yeniden başlarken, ne de bir ajan onu açtığında.
Klavyeyi bir kişinin tıklaması ya da ilk açılışta `--focus` verir. Klavyesi olmayan bir pencereye ulaşan bir tuş hiçbir
yere gitmez. Bir ajanın açtığı bir pencere de bir kişinin tıklamasına kadar tüm girdiyi tutar ve o tıklama daha öteye gitmez.
Yazılan cihaza ulaşır, başka hiçbir yere değil: ne bir log, ne Etkinlik paneli ne de `report` onu tutar. Bir iPhone'da bunun için runner'a bunu söylemek gerekir: XCTest her tuş için, güvenli bir alanınki de dahil, bir satır ve okuduğu her alanın değerini `xcodebuild`'in tuttuğu sonuç paketine yazar; kendi yazması da metni `xcodebuild`'in çıktısına yazar. Runner bu satırları kapatır, XCTest'in olay sentezleyicisiyle yazar ve `xcodebuild` her cihaz için durum klasöründe bir klasör tutar, `ios-<udid>.kept`; her başlangıçta değiştirilir ve bir durdurmada gider. Bir cihaz testi onu arar.

Anahtar pencere olmak yetmez. Öndeki uygulama etkinleştirmeyi başlattığı şeye devreder; bu yüzden bir kişinin yazdığı bir terminal, yeni bir pencereye o kişinin tuşlarını verebilirdi. Bu nedenle bir viewer açılışını tamamlayana kadar etkinleştirilemez, arkada tutulan bir viewer ise hiç etkinleştirilemez: sistem onu arka plan süreci sayar. Ayrıca bir kişi o pencerede fareye basana kadar cihaz hiçbir tuşu, yazılan metni, yapıştırmayı ya da cihaz kısayolunu duymaz; bu, pencere klavyeyi kaybedene kadar geçerlidir. ⌘Tab ile geri gelmek, tuşlar cihaza ulaşmadan önce bir tıklama gerektirir; fareyle seçilen bir menü gerektirmez.

Yazma sistemin kendi metin girişinden geçer, bu yüzden ölü tuş, basılı tutulan bir aksan ve bir giriş yöntemi çalışır. ⌘V, Mac'in metnini aynı yolla, en çok 4.096 karakter gönderir ve bir metni kısa kestiğinde pencere bunu söyler, çünkü uzun bir metin tuş tuş gider. Bir simülatör, ABD klavyesinde tuşu olanı tuş olarak, geri kalan her şeyi panosu ve command V ile yazar; bu yüzden bir uygulama Yapıştırmaya İzin Ver diye sorabilir.

Bir iPhone'un harfleri runner'ı ile gider; runner'ı ilk harfler başlatır, yaklaşık 3 s; harfler bir dize olarak gider, bu yüzden telefonun klavye düzeninin onlar üzerinde söz hakkı yoktur: tuşlar konuma göre gider ve Türkçe bir düzende `quick`, `quıck` olarak, `-` da `*` olarak girdi, hiçbir uyarı olmadan. Bir dokunuştan sonraki ilk harfler, altında ne olduğunu sorar. Bir metin alanındaysa o alanı adlandırırlar ve alan odağı alınca giderler; yeni bir pencerede ilk dokunuş için 2,3 s'de, bir alandan diğerine bir dokunuş için 70 ile 200 ms'de; 6 s'de ise, bir sonraki dokunuşa kadar onlardan sonra yazılanlarla birlikte atılırlar ve pencere bunu söyler; çünkü klavye o dokunuş boyunca açık kalır ve erken gelen harfler, aralarında bir parola da olmak üzere, ondan önceki alana ulaşmıştı. Hiçbir alanın üstünde olmayan bir dokunuş metin imlecini olduğu yerde bırakır ve harfler oraya gider. Bir harf runner ile 285 ms sürer ve saniyede 8 harfte bir kişi onları yaklaşık 475 ms sonra görür, en kötüsü 678; çünkü biri yoldayken yazılanlar birlikte gider. Yalnızca metni olan bu yoldan gider: ok gibi metni olmayan bir tuş, kendisinden önceki harflerden sonra tuş olarak gider.

Runner'a söylenmemiş bir uygulamada runner bir dokunuşun altında ne olduğunu söyleyemez; bu yüzden harfler, dokunuştan 3 s sonra telefonun erişilebilirlik servisinin tek bir bakışını bekler ve yalnızca bu bakış bir alanı adlandırırsa giderler; o alan da, dokunuş sonuncuya yapılmadıysa, sonuncudan farklı olmalıdır. Tek bir bakıştır, çünkü art arda bakışlar bir alanı 8,9 s boyunca odaktan alıkoydu. Runner bulunamadığında aynı bakış karar verir, harfler tuş konumuna göre gider ve pencere bunları telefonun düzeninin belirlediğini söyler.

Bir Android telefonun bunların hiçbirine ihtiyacı yoktur. Bir Samsung ve bir Xiaomi, yazdırılabilir 95 ASCII karakterin hepsini ve `ç ğ ı İ ö ş ü`'yü, bir pencereden de `type_text` ile de verildiği gibi aldı; güvenli bir alana dokunduktan 100 ile 900 ms sonra yazılan harfler 72 turun 72'sinde oraya ulaştı.

Bir pencere menü çubuğunu ve Dock simgesini bir kişinin ilk tıklamasında alır, daha önce değil: bir ajanın penceresi, biri onu kullanana kadar bir Mac'te hiçbir şeyi değiştirmez.

## Bir cihazı paylaşmak

Bir pencere, cihazı kim tutuyorsa onu izler: talepte bulunmaz ve bir cihazı tutan bir ajan bir ret nedeni değildir. Üstündeki kapsül
kimin yönettiğini söyler. `--no-input` onu yalnızca bakılan bir pencere yapar ve `--allow-devices` geçerlidir.

Hub ve bu Mac'teki her istemci, hangisi önce geldiyse, tek bir ajanda buluşur; hub'da duran bir cihazın penceresini isteyen
bir istemciye pencerenin açık olduğu söylenir. Bu build'ler arasında da geçerlidir: bir güncelleme boyunca açık bırakılan bir hub başlattığı
ajanı korur ve sonradan başlayan, hub kapanana kadar o ajanı kullanır.

Bir kişinin girdisi her zaman kendine ait bir bağlantıdan geçer ve bir ajanın yaptığı işin arkasında
sıraya girmez. `mirror status`, bir ajana bir kişinin pencereye en son ne zaman dokunduğunu söyler. Çağrılar geldikçe pencere bir ajanın yönettiğini söyler. Etkinlik paneli her çağrıyı listeler: zaman, araç, ne kadar sürdüğü, sonucu;
yazılan metin uzunluğuyla, gizli değerler gizlenmiş olarak, `report`'un kullandığı kodla. Panel, durum klasöründeki
`activity/<serial>.jsonl` dosyasını okur: soket yok, süreçler arasında.

Yalnızca bir kişinin yanıtlayabileceği bir uyarı (Face ID, Touch ID, bir parola, bir Apple Hesabı, Yapıştırmaya İzin Ver, bir VPN, bir profil, bir
satın alma), ekranı okuyan yanıtta söylenir: `needs a person: Face ID`. `hand_off {reason, timeoutS}`, pencereye bir sesle, Dock'ta bir sıçramayla ve "Bitti" ile bir uyarı bandı koyar, `--silent` ile çalışan bir sunucuda ses ve sıçrama olmadan. Pencere
yoksa bir ses ve elden geldiğince nedeni gösteren bir bildirim verir, böyle bir sunucuda hiçbirini vermez, ve ekranın değişmesini bekler. Beklemeyi kimin bitirdiğini
ya da kimsenin bitirmediğini yanıtlar.

Yansıtılan bir cihazda `perf_*`, gürültü işareti `mirrored`'ı alır; bu, yüksek yükün yaptığı gibi bir çalıştırmayı kapının dışında tutar:
bir yayın cihazda bir kodlayıcı çalıştırır.

## Ne gösterir

Yansıtma ekranın gösterdiğini gösterir. `report`'un üstünü boyama sözü bir pencere için geçerli değildir. Ajanın
token'ı viewer'a stdin'i üzerinden gider, asla argümanlarıyla değil.

## Bir telefonun görüntüsünün boyutu

Varsayılan olan `--quality auto`, bir kişiye yetişen en büyük boyutu alır: hızını koruyan bir görüntü yine de geç kalabilir ve bir dokunuş tam olarak bunu bekler. Ajan, kodlayıcının her hareket dizisinde, anahtar kareden sonraki beş ya da daha fazla karede ne kadar süre aldığını okur, çünkü bir saatin tıkırtısı ya da bir dalgalanma bu konuda hiçbir şey söylemez. Art arda iki dizide 40 ms'yi aşarsa doğrudan piksellerinin sığacağını söylediği boyuta geçer ve sonraki yayın oradan başlar. Hiçbir yerde bir model adı geçmez ve kodlayıcısı yetişen bir telefon ekranının boyutunda kalır. `--quality high` ve `standard` ekranın boyutunu korur, istenen bir boyut da o boyuttur.

Bir kişinin okuyabileceği en küçük boyutta durur ve cihazın yetişemediğini söyler: ekranın her dp'si için 1,12 piksel görüntü, bu da 914 dp'lik bir ekranda 1024 satırdır. Kare hızının bunda payı yoktur. Mac'in Vision'ı, gerçek bir pencerenin üç Ayarlar ekranından gösterdiğini okudu; cihazın kendi görüntüsünde okuduğu sözcüklerden kaçını okuyabildiği şöyle:

| görüntü  | 14 sp'de metin | 11 sp'de, Material'ın en küçüğü | 9 sp'de |
| -------- | -------------- | ------------------------------- | ------- |
| 576x1280 | 79/79          | 95/95                           | 104/104 |
| 456x1024 | 78/79          | 95/95                           | 102/104 |
| 360x800  | 79/79          | 93/95                           | 74/104  |

Göz de aynı fikirde: 360x800'de 9 sp'lik bir metin satırı seçilemez, 456x1024'te seçilebilir. Gövde metni tek başına burada bir şey söylemez; taban bu yüzden en küçükten alınır. Bir boyutu reddeden kodlayıcı başka bir konudur ve yine de tabanın altına inebilir: herhangi bir boyutta bir görüntü hiç olmamasından iyidir.

Bir boyut tek yönlü bir mandal değildir. Bu boyutta 30 s geçtikten sonra, aynı piksel kuralına göre bir üst boyut için yeterince hızlı art arda üç dizi olursa bir boyut yukarı çıkar; fazla yavaş olduğu görülen bir boyut 5 dakika bırakılır, bir büyüme her geri dönmek zorunda kaldığında bu süre iki katına çıkar, en çok bir saate kadar, yeni bir yayına dek. Durgun bir ekranda hiçbir şey okunmaz, bu yüzden görüntü bir kişi onu hareket ettirdikçe büyür. Bir emülatörde misafir sistem yük altındayken bir görüntü 456x1024'te kaldı ve bunu söyledi; `device-tests/mirror.android.test.ts`, istenen okumayla, gerçek bir yeniden başlatmada bir yayının büyüdüğünü doğrular, çünkü yoğun bir Mac altında bir dizi o boyutta 968 ms okudu ve kendiliğinden hiçbir sakinlik gelmedi. Android 14'lü bir Samsung A52'de, 8 ile 25 arası yükte, istenen okumayla (`roomMs` 1500, böylece her sakin dizi yer var diye okunur ve gerçek olan geri dönüş ve beklemedir), bir yayın 0,51 dk'da 1600 satırdan 1920'ye çıktı ve 2 s sonra geri döndü; bir sonraki deneme bundan 10,0 dk sonra, 5 dakikanın iki katı sonra geldi ve 19 s içinde geri döndü.

| Samsung SM-A525F, 90 Hz | kare/s | yakalamadan varışa p50; p95, ms | dokunuş p50, ms |
| ----------------------- | ------ | ------------------------------- | --------------- |
| 1080x2400               | 89     | 69,3; 73,4                      | 217             |
| 720x1600                | 65     | 36,6; 64,5                      | 107             |
| 576x1280                | 69     | 26,4; 29,3                      | 94,8            |
| 456x1024                | 81     | 23,6; 26,5                      | 93,8            |

O telefonun ilk yayını 576x1280'e yerleşir ve sonraki oradan başlar. Küçük bir ilk dizi eksik okuyabilir, bu yüzden bir boyutun yerleşmesi iki adım sürebilir; her biri, bir kişinin ilk dokunuşlarında görüntünün yeniden başlaması demektir.

Bir kodlayıcının kendisi hakkında yayımladıkları buna karar veremezdi: Android'in ölçeklediği gibi ölçeklendiğinde `measured-frame-rate` değerleri Samsung'un 2400 satırının bir Xiaomi'nin 1600 satırından hızlı olduğunu söyler; oysa Xiaomi'de bir dokunuş iki kattan daha hızlıdır.

## Sayılar

`packages/appdyno/scripts/mirror-bench.mjs <device>`, Android'de fixture'ın frames ekranını, iOS'ta ise bir
listeyi çalıştırır, dokunmadan önce ekranı okur ve her hedefin kararını host'un yükü yanında söyler. Hepsi
camdaki değil, Mac'e varış değerleridir. 60 yükünün üstündeki bir ıskalama "run it later" der. Bkz. [perf.md](perf.tr.md#yansıtma).

## Bir pencereye bakmak

Arkada tutulan ya da hiç penceresi olmayan bir viewer kendine ait bir panoya, `dev.appdyno.behind`'a kopyalar, çünkü bu Mac'in panosu bir kişinindir. `packages/core/test/viewer-behind.test.ts`, bir kopyalamanın öncesinde ve sonrasında Mac'in kendi sayacını okur; viewer'ın öz testi de yaptığı her şeyin çevresinde.

`packages/appdyno/scripts/mirror-shots.mjs <simulator> <folder>`, hiçbir şeyi öne getirmeden bir pencerenin her durumunu açık ve koyu olarak yazar. `--behind` gerçek bir pencereyi her ekranın dışında tutar; pencere sunucusu onu orada da, cam ve görüntü dahil, birleştirir ve `{"op":"snapshot","file":...}` onu dışarı yazar; hiçbir izin sorulmaz, çünkü bir süreç kendi penceresini okuyabilir. İmleç üzerinde durma, animasyon, sayfalar ve menü çubuğu bu yolla görülemez: bunları elle denemek gerekir.

## Hat

Bir viewer ve üst süreci, viewer'ın stdin ve stdout'unda satır başına bir JSON nesnesi konuşur, her birinde bir `op` vardır. İki taraf da bilmediği bir adı atlar, bu yüzden `packages/core/src/mirror/viewer.ts` içindeki `VIEWER_OPS` hepsini listeler, derleyici üst süreci bu listeye bağlı tutar, bir test de listeyi viewer'ın kaynaklarına ve bu tablolara bağlı tutar. Yalnızca adlar: bir mesajın taşıdığı, işlendiği yerde okunur.

Aldıkları:

| Ad           | Ne ister                                                                |
| ------------ | ----------------------------------------------------------------------- |
| `activity`   | Etkinlik paneli için bir satır.                                         |
| `agent`      | Cihazı şimdi kimin, hangi araçla yönettiği.                             |
| `answer`     | Bir panelden istenen bir bağlantının, push'un ya da yakalamanın sonucu. |
| `apps`       | Uygulamalar panelinin listelediği.                                      |
| `attach`     | Bu kaynağı göster.                                                      |
| `audit`      | Denetimin gösterilen ekranda bulduğu ya da nerede olduğu.               |
| `banner`     | Bir kişiden bir şey iste ya da istemeyi bırak.                          |
| `clients`    | Yapay Zekâ İstemcileri panelinin gösterdiği.                            |
| `copied`     | Bu görüntüyü panoya koy.                                                |
| `copyText`   | Bu metni panoya koy.                                                    |
| `crashes`    | Loglar paneli için uygulamanın çökme raporları.                         |
| `detach`     | Kaynağı bırak; pencere kalır.                                           |
| `element`    | İmlecin altında ne olduğu.                                              |
| `flow`       | Kaydın adımları.                                                        |
| `hub`        | Hub'ın listesi ve seçilen cihazın gösterdiği.                           |
| `logs`       | Uygulama logunun yeni satırları ya da yeni bir başlangıç.               |
| `mark`       | Şimdiden bir sonraki değişen kareye kadar geçen süre.                   |
| `measured`   | Bir ölçümün sonucu.                                                     |
| `measuring`  | Süren bir ölçüm hakkında bir satır.                                     |
| `network`    | Yakalama, gördükleri ve cihazın sahip olduğu yollar.                    |
| `note`       | Bir kişi için bir satır.                                                |
| `pair`       | Bir çiftin diğer cihazı.                                                |
| `perf`       | Canlı sayılar.                                                          |
| `poke`       | Bir testin pencereye, bir kişinin yapacağı gibi yaptığı.                |
| `quit`       | Kapan ve çık.                                                           |
| `raise`      | Bir kişinin isteğiyle öne gel.                                          |
| `record`     | Görüntüyü bu dosyaya kaydet.                                            |
| `recording`  | Bir kaydın sürdüğünü göster.                                            |
| `recordStop` | Kaydı bitir.                                                            |
| `results`    | Bu cihazda daha önce ölçülenler.                                        |
| `snapshot`   | Pencereyi bu dosyaya yaz.                                               |
| `status`     | Gösterilecek durum.                                                     |
| `tick`       | Paylaşılan dosyada yeni bir kare.                                       |
| `touchAt`    | Bir dokunuşun nereye indiğini göster.                                   |
| `turns`      | Görüntüyü dik çeviren çeyrek dönüşler.                                  |
| `watch`      | Sonraki karelerin hareketini oku.                                       |

Söyledikleri:

| Ad          | Anlamı                                                    |
| ----------- | --------------------------------------------------------- |
| `app`       | Uygulamalar panelinden bir işlem.                         |
| `board`     | Bir testin kendi panosunu okumasına yanıt.                |
| `button`    | Bir cihaz düğmesine basıldı.                              |
| `clicked`   | Bir testin tıklamasına yanıt.                             |
| `closed`    | Pencere kapandı.                                          |
| `control`   | Girdi olmayan bir denetim.                                |
| `done`      | Bir kişi bir uyarı bandını yanıtladı.                     |
| `fired`     | Bir testin menü öğesine yanıt.                            |
| `first`     | Bir kaynağın ilk görüntüsü.                               |
| `hover`     | İmleç burada duruyor.                                     |
| `hub`       | `action`'ın adını verdiği bir hub işlemi.                 |
| `inspect`   | Öğe denetçisi açıldı ya da kapandı.                       |
| `key`       | Bir tuşa basıldı ya da tuş bırakıldı.                     |
| `lost`      | Yayın kayboldu ve geri gelip gelemeyeceği.                |
| `marked`    | `mark`'a yanıt.                                           |
| `needKey`   | Çözücü bir anahtar kare istiyor.                          |
| `paneWatch` | Cihazı okuyan bir panel görünüyor ya da artık görünmüyor. |
| `perfWatch` | Sayılar isteniyor ya da artık istenmiyor.                 |
| `pick`      | Denetçide bir öğeye tıklama.                              |
| `ready`     | Süreç ayakta.                                             |
| `recorded`  | `recordStop`'a yanıt.                                     |
| `refused`   | Açılamıyor ve neye ihtiyacı olduğu.                       |
| `sleep`     | Mac uykuya geçiyor.                                       |
| `snapped`   | `snapshot`'a yanıt.                                       |
| `stats`     | Yayının sayıları, saniyede bir.                           |
| `text`      | Yazılan metin.                                            |
| `touch`     | Bir parmak indi, hareket etti ya da kalktı.               |
| `wake`      | Mac uyandı.                                               |
| `watched`   | `watch`'a yanıt.                                          |
| `zoom`      | Pencerenin ölçeği değişti.                                |

## Belirtilen sınırlar

- Bir iPhone deneyseldir: belgelenmemiş, değişebilecek servislere dayanır.
- Bir iPhone'un kilit ekranı: ona gönderilen bir kaydırma onu açmaz. Pencerenin denetimlerinden Ana Ekran açar.
- Bir iPhone bağlanırken kapatılan bir hub: pencere hemen gider, süreç ise runner'ının başlatılması başladıktan yaklaşık 5 s sonra; çünkü o başlatma sonuna kadar sürer ve bir runner kendi host'undan uzun yaşar. Bu arada açılan bir hub ayağa kalkar ve canlıdır.
- En ağır görüntüde, 167 Mbit/s, yük altındaki bir iPhone: 361 yükünde başlayan 30 dakika boyunca paketlerinin %0,25'i kayboldu, her kayıp görüntüyü bir anahtar kareye kadar dondurdu. 8 yükünde 15 dakika boyunca, görüntü ağırlaşırken bir kez %0,01 kaybetti ve 1,1 s donma oldu.
- Performans panelindeki **Gösterge Panelini Aç** sayfasını yazar ve `open` ile açar: sayfanın ardından bir tarayıcıda göründüğünü elle denemek gerekir, çünkü bir test hiçbir şeyi öne getirmemelidir.
- Bir kişinin tıklamadığı bir pencerede tuşlar hiçbir yere gitmez: bir pencereye yazmayı elle denemek gerekir, çünkü bir testin penceresi klavyeyi hiç tutmaz.
- Bir simülatörün katlanması: bir simülatörü katlayan bir denetim bulunamadı, bu yüzden bir katlanmada yeni bir yüzey test edilmedi.
- Pencere güvenli bir Android penceresinin içeriğini henüz göstermez, çünkü Android 12'den itibaren hiçbir shell ona erişemez: siyahtır, durum çubuğu yine oradadır. Android 12 ve 13'te ya da burada imajı olmayan 10'da çalıştırılmadı.
- Canlı sayılar bir simülatörde, bir Android emülatöründe, bir Samsung'da, bir Xiaomi'de ve bir iPhone'da çalıştırıldı. Bir iPhone'da bir kişiyi bir uygulamadan diğerine izleyen bir pencere telefonsuz test edildi.
- Bir pencerenin ölçümleri bir simülatörde ve bir Android emülatöründe çalıştırıldı. Bir iPhone'da bir açılış çalıştırıldı; bir kaydırma turlarını çalıştırır, sonra trace aracı kendi trace'inde başarısız olur ve pencere bunu söyler.
- Okumaların bir cihaza bedeli tek bir Android 14 emülatöründe, saniyede on kez değişen bir ekranda dururken ölçüldü: pencere açık ve sayılar kapalıyken bütün CPU'sunun %6,0'ı, sayılar gösterilirken %10,8'i, 30 s'lik sekiz dönem boyunca. Hiçbir telefon ölçülmedi.
- Bir cihazın rengi: çerçeve bir renk alır ama henüz hiçbir şey onu bir cihazdan okumaz, bu yüzden her çerçeve tablonun kendi grafit ya da karbon rengidir.
- Çerçevenin Eylem düğmesi ve Kamera Denetimi çizilir ve hiçbir şey yapmaz: onlara basan bilinen bir girdi yoktur.
- Runner yokken, bir iPhone klavyesinde tuşu olmayan metin panosu üzerinden gider: telefon bir kişiden yapıştırmaya izin vermesini ister ve panonun tuttuğu, metinse sonra geri gelir. Güvenli bir alanda hiç gitmez ve pencere bunu söyler. Orada karar veren tek bakış yalnızca birim testleriyle, turlar halinde ve hiçbir telefon olmadan denendi.
- Yeni bir pencerede ilk dokunuşun bir alana odağı vermesinin neden 2,3 s sürdüğü bilinmiyor. Turdan tura bu değere yakın kalır ve araya erişilebilirlik servisinin hiçbir okuması girmez.
- Hiçbir alan almadığı için atılan harfler yine de bir kayda ulaşır; kayıt onları pencereden çıkarken not eder: bir yeniden oynatma onları yazar.
- Diğer Denetimler menüsü, çerçevenin üzerinde durma, bir pencerenin hatırlanan boyutu ve yeri ve bir trackpad'de kıstırma ya da gerçek bir klavyede ölü tuş elle denenmedi; hesapları öz testle denetlenir.
- Bir telefonda `auto` ekranın boyutunda başlar ve kodlayıcının geride kaldığını gösteren ilk harekette onu bir kez değiştirir, bu yüzden bir kişi ilk dokunuşlarında görüntünün yeniden başladığını görebilir. `--quality high` ve `standard` ekranın boyutunu korur.
- Bir telefonun dokunuşunun, hiçbir boyutun altına indiremediği bir tabanı vardır: bir Samsung SM-A525F'de 1024 satırda 94 ms, 1280'de çalıştırmalar boyunca 95 ile 107 arası; hedef olan 80'in üstünde. Bir Xiaomi'ninki kendi boyutunda 92 olarak okunur, bu da bir ıskalama.
- İki cihaz, her birinde fixture ile, bir simülatörde ve bir Android emülatöründe ve bir Samsung ile bir Xiaomi'de çalıştırıldı. Bir ekranda yan yana duran iki pencere gözle değil öz testin hesaplarıyla denetlenir, çünkü bir testin pencereleri her ekranın dışında tutulur; döndürülmüş bir cihaz bir çiftte çalıştırılmadı. İki kimlik altında iki build çalıştırılmadı.
- `key` ile girdi: Android ajanın tuşlarına basar ve orada Esc, Geri'dir; bir kayıt da bunu yazar, böylece bir yeniden oynatma yapılanı yapar. Bir simülatörde bir klavyenin karakterleri ABD tuşları olarak gider; diğer her metin panosu ve command V ile.

- Bir iPhone'da bir kayıt ve panel, ilk kullanımın başlattığı runner'ı ile okur: `inspector` yerleri olmadan sözler ve id'ler verir, bu yüzden runner yokken bir tıklamanın adlandırılacağı bir öğe olmaz ve pencere nedenini söyler.
- Bir iPhone'da ya da bir Xiaomi'de yapılan bir akış orada, bir simülatörde ve bir emülatörde yeniden oynatıldı. Bir simülatörde ya da emülatörde yapılan, diğerinde yeniden oynatıldı, hiçbir telefonda değil.
- Bir cihazın kendi klavyesindeki tıklamalar yalnızca yerine geçen bir cihazda kaydedildi. Gerçek bir imlecin üzerinde durması, bir tekerlek ve bir trackpad elle denenmedi: bir testin penceresine gönderilmiş tıklamalar, sürüklemeler ve üzerinde durmalar verilir.
- Bir kaydırma yönünü korur, uzunluğunu değil: bir yeniden oynatmanınki ekranın %40'ı kadar gider. Ardından bir tıklama ya da doğrulama geldiyse, ulaştığı şey `scroll_to` olarak saklanır.
- Bir adım, girdi cihaza yola çıktığında yazılır, bu yüzden bir cihazın sonra reddettiği şey, örneğin bir iPhone'un güvenli alanına yapıştırma, dosyada yerine ulaşmış gibi durur. Pencere reddi söyler.
- Cihazın kendi klavyesindeki tıklamalar sonradan alandan anlaşılır, bu yüzden Return tuşu görülmez: onu Mac'in klavyesi kaydeder ve pencere bunu söyler.
- Bir akış cihazın adıyla Masaüstüne gider: onu orada yeniden adlandırın. Adımlar panelde geri alınamaz: bir akış bir metin dosyasıdır, onu düzenleyin.
- Başka bir süreçten gelen `flow start` bir pencereye çeyrek saniye içinde ulaşır ve bu sürede yapılan tıklamalar kaydedilmez. Aynı anda tek bir kayda yazan iki süreç bir adım kaybedebilir.
- Üzerinde durma ve bir doğrulama en son okunana göre gider; bu yüzden son okumanın süresi içinde değişen bir ekran eski halini gösterir ve o zamandan beri gelen bir şeyin üstünde duran imleç hareket edene kadar hiçbir şey söylemez.

## Wi-Fi

Varsayılan kablo olarak kalır. Ağ bir kişinin seçimidir ve her telefon için bir kez yapılır.

| cihaz   | eşleştirme                                                                                             | bir pencere                                                   |
| ------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Android | Kablosuz hata ayıklama, Cihazı eşleme kodu ile eşle: gösterildiği gibi `appdyno pair <address> <code>` | diğerleri gibi bir cihaz: `appdyno mirror --device <ip:port>` |
| iPhone  | kablosu takılıyken, kilidi açık: `appdyno pair --device <udid>` ve bir kişi telefonda onaylar          | `appdyno mirror --device <udid> --wifi`                       |

Pencerenin başlığı Wi-Fi'da olduğunu, bir not da bunun neye mal olduğunu söyler. Bir iPhone, diğer kipi
`--quality high` istemedikçe düşük kipi alır.

Bir iPhone için yeniden çalıştırılan `appdyno pair` de kablosu üzerinden gider: bu Mac'i hâlâ tanıdığını kanıtlayan bir telefon,
bir iPhone 13 Pro Max'te olduğu gibi, hiçbir şey sorulmadan olduğu gibi bırakılır; bu Mac'i unutmuş bir telefon ya da burada okunamayan bir eşleştirme
bir kişinin onayıyla yeniden eşleştirilir. Bu ikinci yolu birim testleri doğrular ve hiçbir telefon onu göstermedi.

Bunların hepsi hub'da da var. Telefon Bağla'da kablodaki bir telefon için bir kart vardır, Kablosuz: Wi-Fi için Eşleştir
aynı `appdyno pair`'i çalıştırır; bir iPhone için tek tıkla, bir Android telefon için telefonun gösterdiği adres ve kodla. Eşleştirmeyi Unut
`appdyno pair --forget`'i çalıştırır; bu, bir iPhone eşleştirmesinin bu Mac'teki yarısını siler; telefon kendi yarısını, güvenilen
bilgisayarları temizlenene kadar tutar; bir Android telefonun eşleştirmesi ise telefonda Kablosuz hata ayıklama altında unutulur.

Bir telefon tek bir satırdır, çünkü tek bir kodlayıcısı vardır. Kablodayken kablodan gider ve adb'nin ağda bulduğu bir ad, o telefon
kablosundayken dışarıda bırakılır. Kablo yokken aynı telefon listede Wi-Fi ile durur ve üstündeki çubuk bunu söyler:
`Live · Picture 60 fps · Wi-Fi`. Bir adres kime ait olduğunu söylemez, bu yüzden `adb connect` ile ulaşılan bir telefon kendine ait bir
satır tutar. Wi-Fi için eşleştirilmiş bir iPhone, bu Mac'te olana dayanarak ve ağa hiç bakmadan, kablo takılı olmadan listede
durur; telefon orada değilse penceresi bunu söyler. `--wifi` olmadan da ağ üzerinden gider, çünkü başka bir yolu yoktur.

Giden bir ağ okunacak bir son bırakmaz, bu yüzden bunu sessizlik söyler: sessizlik sürünce son görüntü soluklaşır ve pencere,
çekilmiş bir kablodaki gibi `waiting not-connected` der. Adresle, sessizleşen bir aktarıcı üzerinden ulaşılan bir emülatörde
ölçüldü: 20 s'lik bir sessizliğin 7 s'si içinde söylendi, dönüşten sonra 1 s içinde kendiliğinden canlı.

Android'de telefonun kendi Wi-Fi'ının gitmesi başka bir konudur. Kablosu takılıyken Wi-Fi seri numarasıyla bağlı bir Samsung SM-A525F'de, Wi-Fi'ı `svc wifi` ile 20 s kapatıldı, 5 yükünde tek çalıştırma: 7,1 s'de söylendi ve kendiliğinden geri gelmedi, çünkü Android Wi-Fi ile birlikte Kablosuz hata ayıklamayı da kapattı ve Wi-Fi döndükten 30 s sonra hâlâ kapalıydı. O kablo üzerinden `adb_wifi_enabled` ile yeniden açılınca pencere 1,6 s sonra canlıydı. Kablosu olmayan bir telefonda bunu Kablosuz hata ayıklama altında elle yapmak gerekir. adb sonra telefonu iki kez listeledi, adıyla ve aynı adın `(2)` eklenmiş haliyle; ikisi de telefonun dinlediği tek porta ulaşıyordu ve Kablosuz hata ayıklama kapatılıp açıldıktan sonra da öyleydi: hub onun için tek bir satır tutar.

Wi-Fi'ın bedeli, bir Samsung SM-A525F'de kabloyla kendisine karşı ölçüldü (tablo `reference/perf.md` içinde): bir dokunuşun görünmesi yaklaşık iki kat uzun sürer, 103 ile 110 yerine 168 ile 208 ms; bir pencere 100 ile 150 ms, bir kez de 1,4 s daha geç açılır. Görüntülerin çoğu kabloyla olduğu kadar çabuk gelir, yirmide bir en yavaşı ise yaklaşık 50 ms daha geç; bir kişi bunu hareket eden bir telefonda düzensiz bir görüntü olarak görür. Olası neden ağın gidiş-dönüşüdür, ama ayrıca ölçülmedi: o telefona bir ping 6 ile 170 ms arası sürdü.

Bir iPhone 13 Pro Max'te kabloyla kendisine karşı, aynı yerde bedeli: bir pencere 0,5 yerine 1,5 ile 2,5 s'de açılır, bir görüntü 60 yerine saniyede 44 ile 59 kare alır ve bir çalıştırmada 0 ile 4 yerine 13 ile 18 kez donar, her seferinde bir saniyeden kısa; bir fiske 93 ile 98 yerine 121 ile 470 ms'de görünür. Wi-Fi ile beşer fiskelik üç çalıştırmada 10 fiskeden yalnızca 2 ile 5'i göründü ve hiçbir neden bulunamadı.

O Samsung'da, kablosu takılıyken Wi-Fi seri numarasıyla, arkada tutulan pencere suite'iyle, 4 yükünde 12/12 çalıştırıldı: bir görüntü, bir dokunuş, yazma, bir uzun basış, bir sürükleme, Ana Ekran, Son Kullanılanlar, Geri, döndürme, bir ekran görüntüsü, Denetçi, ajanının öldürülüp geri gelmesi, bir kapatma ve yeni bir açılış. Bir telefonun, hangi yoldan ulaşılırsa ulaşılsın tek bir ajanı vardır.

O iPhone'da, kablosu takılıyken çalıştırıldı. Bir eşleştirme: telefonda bir soru belirir, bir kişi onaylar ve `appdyno pair` sonra ikisinin eşleştiğini söyler. Arkada tutulan pencere suite'iyle, harfleri hâlâ kablodan giderken Wi-Fi ile 16/16: bir fiske, bir dokunuş, metin, panodan bir gizli değer, karartma ve geri gelme, döndürme, ekran görüntüleri, öldürülen bir viewer. Sürücüye kablo olmadığı söylenerek, böylece görüntü, dokunuşlar ve harfler ağda tünellerden geçerek, 4 ile 7 yükte: harfler suite'i, 6/6; bir düzenin başka bir karaktere çevirdiği her karakterle, 100 ve 900 ms önce dokunulmuş güvenli bir alana bir gizli değerle, odağı olmayan bir alanla ve `xcodebuild`'in tuttuklarında hiçbir sözcük kalmadan; ve gerçek penceresi arkada tutulan pencere suite'i, 17/17. Bunların hepsinde runner'ı `xcodebuild` kablo üzerinden başlattı.

Bir runner telefonunun loopback'iyle sınırlı kalır; Wi-Fi için eşleştirilmiş bir telefonda aynı token ile bir tüneli de kabul eder. Hiçbir dinleyici yalnızca bir tünelle sınırlanamazdı, bu yüzden eşleştirilmiş bir telefonda portu Wi-Fi'da da açık durur ve o yoldan gelen hiçbir şey okunmadan kapatılır. O iPhone'da denendi: telefonun Wi-Fi adresinden gelen token'ı 15 ms içinde kesildi, bir tünelden geldiğinde ise yanıtlandı. Bu Mac'te eşleştirme yokken o port Wi-Fi'da reddetti.

Runner bulunamazken (bu durumu hemen başarısız olan bir `xcodebuild` taklit etti), her biri bir çalıştırma: düz bir alana dokunduktan sonra yazılan, tuşu olmayan metin panodan gitti, pencere bunu ve harflerin artık tuş konumuyla gittiğini söyledi ve telefonun yapıştırma sorusunu bekledi; güvenli bir alana dokunduktan sonra yazıldığında gitmedi ve pencere hiçbir alanın onu almadığını söyledi. İkisinden sonra telefonun kendi görüntüsü her alanı boş gösterdi.

Sürücüye kablo olmadığı söylendiğinde gerçek bir hub, adb Samsung'u iki kez listelerken bile, bir Samsung'u ve bir iPhone'u Wi-Fi ile, her birini tek satırda listeler ve her pencerenin çubuğu bunu yanında canlı sayılarla söyler. Kablolar görüldüğünde her biri kablosuyla tek bir satırdadır.

Wi-Fi'daki bir pencere bunları yapmaz:

- Bir iPhone'un eşleştirmesi orada yapılamaz: ağda bir telefon eşleştirme başlatmayı reddeder, bu yüzden bir kez kablo ister.
- Bir telefon bu Mac'in ağını paylaşmalıdır: bir iPhone orada duyurduğu şeyle bulunur, bir Android telefon ise Kablosuz hata ayıklamanın açık kalmasını ister; Wi-Fi'ının gitmesi onu kapatır.
- Wi-Fi ile bir iPhone, istenmedikçe düşük kipi alır.

Kablo çıkarılmışken çalıştırılmadı, bu yüzden bir iddiada bulunulmaz: kablosu takılı olmayan bir iPhone'un herhangi bir şeyi ve önce `xcodebuild`'in runner'ını başlatıp başlatamadığı; kullanımdaki bir telefondan çekilen bir kablo, Wi-Fi ile süren bir pencere ve gerçek bir hub'da bununla değişen bir satır. Bir telefonda çalıştırılmadı: bir iPhone'da giden bir ağ ve hub'ın kartının gerçek bir telefonu eşleştirmesi; bunları öz testi ve birim testleri doğrular.

## Şimdilik dışarıda bırakılanlar

Ses.
