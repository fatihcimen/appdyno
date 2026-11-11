# Pencere ve hub

[English](mirror.md)

`appdyno mirror` her cihaz için bir native pencere açar; pencere fare, trackpad ve klavyeyle yönetilir, bu sırada bir ajan
da aynı cihazı yönetebilir. Pencere küçük bir Objective-C programıdır ve simülatör yardımcıları gibi ilk kullanımda `clang` ile
derlenir: Command Line Tools yeterlidir. Kontrol düzlemi Node'dur: yayınları başlatır ve durdurur,
girdiyi taşır, neyin yanlış olduğunu söyler ve yeniden bağlanır. Bize ait bir sunucu, daemon ya da dinleyici yoktur.
Bir pencerenin içte nasıl çalıştığı ve her iddiayı tutmak için neyin çalıştırıldığı [Pencere nasıl çalışır](mirror-internals.tr.md) sayfasındadır.

```sh
appdyno mirror                     # bu cihazın penceresini açar ve çalışmayı sürdürür
appdyno mirror --all [--watch]     # her cihaz ve geldikçe yenileri; en çok --max, varsayılan 8
appdyno mirror open --detach       # bu komuttan uzun yaşayan bir pencere
appdyno mirror --device A --device B --pair   # yan yana iki cihaz, bir dokunuş ikisine de gider
appdyno mirror close | status | stats
  --quality auto|high|standard  --codec h264|hevc  --wifi  --max N  --no-input  --headless
  --seconds N  --takeover  --record file.mp4  --focus  --allow-devices RE
```

`--detach` ile pencere `--quality` ve `--wifi` seçeneklerini alır; bu komutun yanında kaldığı bir pencere için olan `--codec`, `--no-input`, `--headless`, `--seconds`, `--record` ve `--focus` seçeneklerinin hiçbirini almaz. `--pair` tam iki `--device` ister ve `--detach` ile kullanılmaz.

`mirror` aracında `open`, `close`, `status` ve `stats` vardır. MCP üzerinden hiçbir kare geçmez: bir ajanın `screenshot`
ve `record` araçları vardır. `hand_off`, bir ajanın yapamadığını bir kişiden ister.

## Görüntü nereden gelir

| cihaz     | nasıl                                                                                               | bilinmesi gerekenler                                                                                                                                                                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| simülatör | CoreSimulator'ın kendi yüzeyi, kodlama yok: her kare sunumunda geri çağrılan framebuffer'ın kendisi | durgun bir ekranın hiçbir maliyeti yoktur. Çalışma anında yüklenen özel API; başarısız olan şey bunu söyler                                                                                                                                                                                               |
| telefon   | ajanın yayını, kendine ait bir bağlantıda: Node'dan hiçbir şey geçmez                               | varsayılan olarak H.264, siz isterseniz HEVC. Android 10 ve üstü. Güvenli bir pencere, `screencap`'te olduğu gibi siyahtır (Android 16'da görüldü)                                                                                                                                                        |
| iPhone    | iOS 27'nin ekran servisi, bu sürecin kendi tüneli üzerinden, USB ile; telefonda hiçbir şey yok      | belgelenmemiştir ve değişebilir. Telefonun kendi boyutunda 4:4:4, ekranının hızına kadar. Durgun bir ekran göndermeyi sürdürür, saniyede yaklaşık 20 kare; bu yüzden penceresi diğerleri gibi bedava değildir. Açık tutulan bir yayın, hiçbir şey dokunmadan bir telefonun ekranını 30 dakika yanık tuttu |
| emülatör  | emülatörün kendi gRPC portu, ekranı paylaşılan bir dosyada; misafir sistemde hiçbir şey yok         | port emülatörün kendi portudur, bizim değil. Portu olmayan yerde kodlamayı misafir sistem yapar; bu saniyelerce gecikme getirir ve bunu söyler                                                                                                                                                            |

## Bir pencerenin durumları

`connecting`, `live`, `waiting {need}`, `reconnecting {attempt}`, `stopped {why}`. Bir pencerenin neyi beklediği uyarı bandında, `mirror status`'ta ve bir retta aynı biçimde, her seferinde kendi sözleri ve çözümüyle söylenir. Bir bekleme her saniye yeniden sorar ve engel kalkınca kendiliğinden sürer.

| ne olur                             | ne yapar                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| yayın sırasında cihaz gider         | son görüntü soluklaşır, uyarı bandı, `waiting not-connected`; geri gelince: yeniden canlı                                          |
| simülatör kapatılır                 | `waiting simulator-off`; başlatılınca: yeniden canlı                                                                               |
| ekran kapalı                        | `waiting asleep`; bir kişi uyandırınca yeniden açık                                                                                |
| kodlayıcı başarısız olur            | 500 ms arayla 3 kez yeniden başlatma; daha küçük boyut; diğer codec; yazılım; ardından nedeniyle birlikte `stopped`                |
| çözücü başarısız olur               | bir anahtar kare istenir ve görüntü tutulur; art arda üç kez olursa yeni bir yayın; ardından `stopped`                             |
| görüntüleyici ölür                  | hemen, aynı yakınlaştırmayla yeniden başlatılır; bir dakikada iki kez olursa, söylediğiyle birlikte `stopped`                      |
| üst süreç ölür                      | görüntüleyicinin stdin'i biter, böylece görüntüleyici de biter; ajan bunu görür ve ekranı ve codec'i bırakır                       |
| ajan durur                          | `reconnecting` ve ajan, her sürücünün kullandığı yoldan başlar                                                                     |
| Mac uyur, uyanır                    | yayın biter ve uyanınca geri gelir                                                                                                 |
| pencere örtülür                     | kareler okunur, çözülmez ve çizilmez; bir anahtar kareyle geri gelir                                                               |
| döndürme, katlama                   | yeni oturum olmadan yeni bir boyut: ajanın kodlayıcısı yeniden başlar, bir emülatörün görüntüsü dik çevrilir, bir simülatörünki de |
| bir cihazda ikinci pencere          | ilki öne gelir ve ret onu kimin tuttuğunu söyler                                                                                   |
| birkaç cihaz                        | her birine bir görüntüleyici, `--max`; biri başarısız olunca diğerleri sürer                                                       |
| derleyici yok, pencere sunucusu yok | hiçbir şey açılmadan, ihtiyacıyla birlikte `stopped`                                                                               |

## Pencere

Cihaz, sistemin araç çubuğunun altında renkli bir zemin üzerinde çizilir. Görüntünün üstüne hiçbir şey konmaz ve hiçbir şey onu renklendirmez. Oradaki tek bir kapsül, cihazın içinde bulunduğu her şeyi söyler: "Canlı · Görüntü 60 fps · USB", "Yeniden bağlanıyor", onu neyin beklettiği, alt kenarında bir çubukla "Açılış ölçülüyor: 3/6" ya da bir yapay zekâ istemcisinin yönettiği. Ona tıklamak yayının sayılarını gösterir. Bir durum asla yalnızca bir renk değildir: her birinin bir simgesi ve sözleri vardır. Oradaki hız, görüntünün bu Mac'e ulaştığı hızdır: Performans panelindeki **Uygulamanın kare hızı** uygulamanın çizdiğidir; ikisinin tutması gerekmez, çünkü duran bir uygulama bir kez çizilir, yayın da değişeni gönderir.

Sözleri Mac'in diline göre Türkçe ya da İngilizcedir. Cihazın çerçevesi kodla çizilir; **Cihaz Çerçevesini Göster** (⌥⌘F) onu kaldırır ve bu ayar kalıcıdır. Yalnızca bir durumu değiştiren şey hareket eder ve durgun bir pencerede hiçbir şey hareket etmez. Pencere Reduce Transparency, Increase Contrast, Differentiate Without Color ve Reduce Motion ayarlarına uyar; VoiceOver gelen ya da giden bir cihazı ve bulunan bir gerilemeyi duyurur.

Çerçevedeki düğmeler çalışır: bir tıklama onlara basar, yan düğmeyi basılı tutmak Siri'dir. Bir pencere boyutunu ve yerini cihaz başına korur. Herhangi bir boyutta olabilir: cihaz var olan alanı alır, yakınlaştırma da pencereyi ona sığacak biçimde ayarlar.

Pencere en çok basılanları gösterir; geri kalanı **Diğer Denetimler** içinde ve menü çubuğunda bir tık uzaklıktadır. İkisi de tek bir tablodan gelir, böylece hiçbir denetim birinde olup diğerinde eksik kalmaz. Bir cihazda olmayanı pencere göstermez: Android'de Geri ve Hızlı Ayarlar vardır, Siri yoktur.

| denetim                                                                           | kısayol         | cihazda                                                                                                                           |
| --------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Ana Ekran, Kilitle, Sesi Aç, Sesi Kıs                                             | ⇧⌘H, ⌘L, ⌘↑, ⌘↓ | kendi düğmeleri                                                                                                                   |
| Geri                                                                              | ⌘[              | yalnızca Android                                                                                                                  |
| Uygulama Değiştirici                                                              | ⇧⌘A             | iOS: iki kez Ana Ekran. Android: kendi tuşu                                                                                       |
| Siri                                                                              | ⇧⌘K             | iOS: yan düğme basılı tutulur                                                                                                     |
| Denetim Merkezi (iOS) ya da Hızlı Ayarlar (Android), Bildirimler, Spotlight (iOS) | ⌃⌘C, ⌃⌘N, ⌃⌘F   | bir parmağın sürüklemesi                                                                                                          |
| Sola Döndür, Sağa Döndür                                                          | ⌘←, ⌘→          | cihazın kendi yönü: ilk döndürme ajanı başlatır, bir simülatörün önce onu derlemesi gerekebilir                                   |
| Ekran Görüntüsünü Kaydet, Ekranı Kopyala                                          | ⌘S, ⌘C          | cihazın kendi kayıpsız görüntüsü, Masaüstüne ve panoya ya da yalnızca panoya. Cihazın ajansız bir yolu olduğu yerde ajan gerekmez |
| Ekranı Kayda Al                                                                   | ⌥⌘R             | Filmler'e: bir yayının kendi kareleri ya da görüntüsü yayın olmayan yerde cihazın kaydedicisi                                     |
| Akışı Kayda Al                                                                    | ⌥⌘T             | bir kişinin yaptığı, bir akış olarak: bkz. [Bir akış kaydetmek](#bir-akış-kaydetmek)                                              |
| Bağlantı Aç…                                                                      | ⌘O              | aşağıdaki Bağlantılar paneli                                                                                                      |
| Bildirim Gönder…                                                                  | ⇧⌘P             | aşağıdaki Bildirim paneli                                                                                                         |
| Sığacak Kadar Büyüt, Gerçek Boyut, Yakınlaştır, Uzaklaştır                        | ⌘9, ⌘0, ⌘=, ⌘-  | Gerçek Boyut, bir cihaz noktasını bir Mac noktasına eşler                                                                         |
| Yeniden Bağlan                                                                    | ⇧⌘R             | yeni bir yayın                                                                                                                    |
| Denetçiyi Göster, Performansı Göster, Cihaz Çerçevesini Göster                    | ⌥⌘I, ⌥⌘P, ⌥⌘F   | yalnızca pencere                                                                                                                  |
| Yapıştır                                                                          | ⌘V              | Mac'teki metin, cihaza yazılır                                                                                                    |

Bir ajan yönetirken ekranın çevresinde mor bir halka döner, kapsül bunu söyler, istemci kim olduğunu söylüyorsa onun adını verir, her dokunuşun indiği yerde de bir nokta solar. Bir kişiye yöneltilen bir istek halkayı turuncuya çevirir.

Bir cihazla görüntüsü arasında duran şey, sonraki adımıyla birlikte sözlerle söylenir. Uykudaysa ya da kilitliyse, soluklaşmış görüntünün üstünde yapılacak şeyi ve **Yeniden Dene**'yi gösteren bir kart durur; düğmesinin yanına bir tıklama yine cihaza gider. Karanlık bir ekranda ikisi de ekranı yakar, çünkü bunu isteyen kişi ekranı geri istiyordur. İlk görüntüsünden önce takılıp kalan bir cihazın soluklaştıracak görüntüsü yoktur, bu yüzden alan bunu aynı sözlerle söyler. Kablosu çıkarılan bir telefon **Sizi Bekleyenler** altında "Bağlantısı kesildi" olarak seçili kalır ve kendiliğinden geri gelir; başka bir cihazla değiştirilmez. Yalnızca şarj eden bir kablo hiç telefon yokmuş gibi görünür, çünkü bu Mac'e ikisini ayırt ettirecek hiçbir şey ulaşmaz; bu yüzden bir kişinin okuduğu metin bunu da söyler.

### Denetçi

Denetçi (⌥⌘I) sistemin kendi denetçisidir, 320 nokta genişliğinde ve kenardan kenaradır; pencere 1.100 noktanın altına daralınca kendiliğinden çekilir, kenar çubuğu da 860'ın altında; pencere yeniden genişleyince ikisi de geri gelir. Panelleri üst kenarında kendi satırlarında simgeler olarak durur; her biri imlecin altında ve ekran okuyucuya adıyla söylenir, seçilenin adı da altlarında kendi satırında durur. Hub'da açık, kendi penceresinde kapalı durur; o pencere de Denetçi'ye yer açmak için büyür.

#### Performans

- Ekranın nasıl olduğunu tek cümleyle söyler, sonra kare hızını, CPU'yu ve belleği her birinin bir dakikasıyla ve ölçümleri gösterir: bkz. [Canlı sayılar](#canlı-sayılar).
- **Sonuçlar**, bu cihazda öndeki uygulama için daha önce ölçülenleri listeler; her biri kapının yöntemiyle, aynı türde build'in kendisinden önceki temiz çalıştırmalarına karşı değerlendirilir: "Gerileme +553 ms" ya da "Karar verilemedi: 3/5 örnek".
- Bir pencereden alınan bir çalıştırmada kodlayıcı cihazda çalışmaktadır, bu yüzden hiçbir referansa girmez; daha kötü okunan böyle bir çalıştırma "Karar verilemedi: yansıtma açıkken ölçüldü" olarak görünür. Bir gerileme, pencere açık olmayan çalıştırmalarda bulunur.
- Yalnızca dosya okur, bu yüzden bunun için bir telefona dokunulmaz.

#### Akışlar

- Bir kişinin yaptığını bir akış olarak kaydeder: bkz. [Bir akış kaydetmek](#bir-akış-kaydetmek).
- İmlecin altında ne olduğunu ve oraya bir tıklamanın ne yazacağını söyler.

#### Uygulamalar

- Uygulamaları listeler, açar, kapatır ve kaldırır; birini ancak onunla birlikte neyin gittiğini söyleyen bir sayfadan sonra kaldırır.
- iOS'ta liste sistemin uygulamalarını da içerir, çünkü yeni bir simülatörde başkası yoktur; Android'de yalnızca kurulmuş olanları.

#### Etkinlik

- Bir ajanın yaptığını iş parçaları halinde anlatır, örneğin "40 saniye çalıştı · 23 çağrı"; her biri çağrılarına açılır, örneğin "Sign in öğesine dokunuldu".
- Bir kişinin pencereden gönderdiği bir bağlantı ya da push hiçbir ajanın değildir ve listelenmez.

#### Loglar ve Çökmeler

- **Loglar**, öndeki uygulamanın logunu geldikçe gösterir: `logs` aracının okuduğu satırları aynı gizlemeyle; bir satırdaki belirteç, parola ya da anahtar gizlenir.
- Öndeki uygulamayı Performans gibi izler, her 5 s'de bir sorar ve başka bir uygulama için baştan başlar. Kişinin kendi uygulaması olmayan ya da sunucunun uygulama listesinde bulunmayan bir uygulama adıyla söylenir ve hiçbir şey okunmaz.
- Ayrıntılı'dan Hatalar'a bir düzeyi, bir araması, durduğu yerden okumayı sürdüren Duraklat ve Sürdür'ü, bir seçimin dokunduğu satırların tamamını alan Kopyala'sı ve görünümü boşaltıp cihazın logunu asla silmeyen Temizle'si vardır.
- Yanındaki **Çökmeler**, uygulamanın son 5 raporunu `crashes` aracının verdiği gibi listeler; her biri ilk satırlarına ve raporun tamamının bu Mac'teki yoluna açılır.
- Log yalnızca panel görünürken ve duraklatılmamışken 2 s'de bir okunur ve arkada çalışan bir şey bırakılmaz. Bir iPhone'da çalışan uygulamanın bu Mac'in okuyabileceği bir logu yoktur; panel bunu, neyin okunabildiğiyle birlikte söyler.

#### Ağ

- Uygulamanın isteklerini `network` aracının verdiği gibi, o aracın cihaz için tuttuğu yakalamadan gösterir: bir ajanın başlattığı yakalama burada, burada başlatılan da ajana görünür ve ikisi de aynı biçimde gizlenir. Her isteğin yöntemi, adresi, durumu, süresi ve boyutu vardır; seçilen istek tam olarak görünür.
- Yalnızca bu cihazın sahip olduğu yolları sunar: simülatörde uygulamayı yeniden başlatan, bu yüzden bir kayıt ya da ölçüm sürerken reddedilen sonda; Android'de baytlar ve build'in kaydettiği yerlerde Android 14'ten itibaren paketler; ikisi de adres olmadan sayar.
- Proxy yalnızca cihaz zaten birinden geçiyorsa sunulur ve listesi, bu araç proxy'nin kendi dışa aktarımını okuyabiliyorsa okunur. Hiçbir pencere, hiçbir cihazda proxy ayarlamaz.
- Hiçbir yolun istekleri listelemediği yerde, bir iPhone'da ya da proxy'si olmayan bir Android'de, panel kişinin neye ihtiyacı olduğunu söyler.
- Sondanın listesi panel görünürken 3 s'de bir, diğerleri Yeniden Oku ile okunur. Burada başlatılan bir yakalama pencere kapanınca durur.

#### Erişilebilirlik

- `audit` aracının gösterilen ekranda bulduklarını türlerine göre, her türü sayarak gösterir. İmlecin altındaki öğenin kontrastını söyleyen denetim de odur: tek denetim, asla iki.
- Ekran panel görünürken okunur ve bir saniye aynı kaldığında denetlenir, çünkü bir denetim cihazın sırasını saniyelerce tutar. Yeni bir ekran yeniden denetlenir, **Yeniden Denetle** de gösterileni denetler.
- Kayıt sürerken hiçbir denetim çalışmaz, çünkü bir tıklama o zaman kendi yaptığı ekranla adlandırılırdı; panel bunu söyler.
- Seçilen bir sorun, imlecin altındaki öğe gibi, cihazın görüntüsünde işaretlenir.

#### Bağlantılar

- Bir bağlantıyı cihazda, bir ajanın çağırdığı araç olan `open_link` ile, aynı politika altında açar: bir web bağlantısı, bir evrensel bağlantı ya da App Link veya bir uygulamanın kendi şeması. Dosya menüsünde ve Diğer Denetimler içinde bulunan **Bağlantı Aç…** (⌘O), onu alanı hazır halde gösterir ve Return gönderir.
- İkinci bir alan, bağlantının açılacağı uygulamayı belirtir; cihaz öndeki uygulamanın bir kişinin kendi uygulaması olduğunu söylüyorsa onunla doldurulur ve sunucunun uygulama listesine karşı denetlenir. Bir iPhone bir bağlantıyı yalnızca adı verilmiş bir uygulamada açar; başka yerlerde boş bir alan seçimi sisteme bırakır ve `--allow-apps` ile sistem, `open_link`'in tuttuğu gibi, izin verilen bir uygulamayı seçmelidir.
- Bir kişinin gönderdiği bir arama bağlantısı, `tel:` ya da `facetime:`, onundur ve hiçbir şey sormaz; bir ajanınki ise kişiye sorar. Bir kişinin gönderdiği bağlantı hiçbir ajanın değildir: kapsül bir yapay zekâ istemcisinin yönettiğini söylemez ve Etkinlik onu listelemez. İlki, bir ajanın ilk çağrısı gibi, cihazda bir oturum açar.
- Yanıtı iş ilerledikçe gelir ve bir ret tam olarak, hub'ın sözleri varsa yapılacak şey de bir kişinin sözleriyle, İngilizce ve Türkçe gösterilir. Aracın bir ajana verdiği, bir çağrıyı değiştirip yeniden yapmasını söyleyen ipucu gösterilmez.
- Açılan bağlantılar o cihaz için saklanır, son sekizi, en yenisi önce. Altlarında, uygulama alanındaki uygulamanın açtığı bağlantılar, `open_link` `links`'in listelediği gibi, her birinin türü ve bir alan adının durumuyla durur. Seçilen biri alana yerleşir; bir filtrenin `*` kısmı bir kişinin doldurması için bırakılır.
- Bir simülatör, bir uygulamanın şeması onu ilk kez açmadan önce sorar ve yanıt bunu söyler, çünkü bir kişi pencerede yanıtlayana kadar hiçbir şey açılmamıştır.

#### Bildirim

- Bir ajanın çağırdığı araç olan `push` ile bir uygulamaya push gönderir. Dosya menüsünde ve Diğer Denetimler içinde bulunan **Bildirim Gönder…** (⇧⌘P) onu gösterir ve her seferinde araca bu cihazın neleri aldığını sorar.
- Aracın listelediği her tür sunulur; cihazın almadığı bir tür nedeniyle birlikte durur ve seçilemez. Alanlar türü izler; **Yük** de aracın o tür için kendi şablonundan başlar ve alanların yerine gönderilir.
- Uygulama, cihazın bir kişinin kendi uygulaması olduğunu söylediği öndeki uygulamadır ya da yazılan uygulamadır. Bir kişi birini yazmayı bitirince türleri yeniden sorulur, çünkü bir Android uygulamasının build'i başka bir yol izleyebilir.
- Bir alanda Return gönderir ve yanıt bir bağlantınınki gibi gelir, bir ret tam olarak.
- `appdyno push setup` APNs ya da FCM kimlik bilgilerini kaydettikten sonra, onlar üzerinden giden bir rota uygulamanın yazdırmadığı bir token alabilir: rotanın altında, rotaların kullandığı token türlerini, seçilen türünkini başta sunan bir alan. Yazılırken gizlenir ve o uygulama için yalnızca bu oturum boyunca tutulur, panelin söylediği gibi. Hiçbir şey onu yeniden göstermez, loglamaz ya da bir yere yazmaz ve bir ajanın çağırdığı hiçbir araç ona ulaşamaz. O türden bir push bundan sonra onu kullanır.

#### Cihaz

- Bir ajanın çağırdığı araç olan `device_setting` ile cihazın koşullarını ayarlar: karanlık mod, metin boyutu, dil, hareketi azaltma, kontrastı artırma, saydamlığı azaltma, animasyonlar, ağın hızı, Wi-Fi, mobil veri, uçak modu, bir proxy, pil düzeyi, ısıl durum ve katlama; `set_location`'ın ayarladığı gibi bir konum; cihaz alıyorsa Face ID ya da parmak izi, gelen bir arama ve bir kısa mesaj. Kendi sözü olmayan bir mesaj, pencerenin dilinde "Pencereden gönderildi" der.
- Her denetim, panel her gösterildiğinde yeniden sorulan, cihazın okuduğu değeri gösterir. Bu cihazın yapamadığı şey, bir kişinin okuyacağı sözlerle kısa bir nedenle, örneğin "Bu cihaz katlanmaz.", devre dışı durur; bir ajana ise sürücünün nedeni söylenir. Pencerenin sözü olmayan bir neden, sürücünün verdiği gibi gösterilir.
- Bir telefonda Wi-Fi, uçak modu, mobil veri ve proxy de devre dışı durur, çünkü her biri hub'ın ona Wi-Fi ya da Wi-Fi üzerinden adb ile giden bağlantısını kesebilir.
- Bir değişiklik, bir ajanın değişikliklerinin girdiği tek kayda girer ve burada değiştirilen şeyi bir nokta gösterir. **Tümünü Geri Al**, `device_setting` `restore`'un geri aldığını geri alır; çalışan bir ajanın değiştirdiğini o ajana bırakır.
- Pencerenin değiştirdiği, cihazı pencereden ayrıldığında, yani pencere kapanınca ya da hub'da başka bir cihaz seçilince geri alınır ve hub ancak bundan sonra biter.

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

**Akışı Kayda Al** (⌥⌘T), bir kişinin pencerede yaptığını bir akış olarak, yani `flow run`'ın yeniden oynattığı dosya olarak yazar. **Akışlar** paneli cihazın yanında açılır ve her adımı yazıldıkça listeler. İkinci bir basış kaydı durdurur ve Masaüstüne `<device> <date>.flow` olarak kaydeder; pencereyi kapatmak da bir film için olduğu gibi aynısını yapar.

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

**Bir tıklamanın kastettiği ekran.** Bir tıklama, tıklamadan hemen önceki ekrana göre adlandırılır. Pencere bir tıklamayı duyduğunda cihaz çoktan tepki vermeye başlamıştır. Bu yüzden bir kayıt sürerken ya da panel açıkken ekran, dokunuşların yanında sürekli okunur: bir dokunuş, buradaki herhangi bir şey onu duymadan önce cihaza yola çıkmıştır; parmak basılıyken ya da sonraki 100 ms boyunca hiçbir okuma başlamaz ve bir okuma zamanın en çok yarısını alır. Bir tıklama son girdiden bu yana en yeni okumayı, yoksa sürmekte olanı alır. İmleci üzerinde tutmak cihaza hiçbir şey sormaz. İkisi de kullanımda değilken, yayın kapalıyken ya da bir ölçüm sürerken hiçbir şey okunmaz. Böyle bir okuma bir bakıştır: bir araç için `tree`'nin yaptığı gibi, karanlık bir ekranı uyandırmaz ve kilit açmaz.

**İmlecin altında.** Akışlar paneli açıkken cihazın üzerindeki imleç, altındaki öğeyi görüntü üzerinde işaretleyerek gösterir: rolünü, sözlerini, ref'ini ve id'sini, oraya bir tıklamanın ne yazacağını ve `audit`'in kontrastı hakkında ne dediğini; bu, ekran başına bir kez okunur. Bir denetim imlecin durmasını bekler, bir simülatörün runner'ını başlatabilir ve panel, bitene kadar okuduğunu söyler. Bir kayıt sırasında hiçbir denetim çalışmaz, çünkü bir denetimin arkasında bekleyen bir okuma, adlandıracağı tıklamadan sonra gelirdi; panel bunu söyler. Cihazdaki bir tıklamanın ne yapacağı orada seçilir: cihaza **Dokunur**, öğenin seçicisini **Kopyalar** ya da kayda bir doğrulama ekleyen ve hiçbir şeye dokunmayan **Doğrular**: `assert id=result check=text equals="Sent: Ada"` ya da öğeyi sözleri adlandırıyorsa `assert text="Bilgiler"`.

Kayıt, `flow`'un tuttuğu kayıttır, cihaz başına bir dosya. Bu yüzden bir ajandan ya da komut satırından gelen `flow start` bir kişinin tıklamalarını da alır, bir pencerenin kaydı da bir ajanın çağrılarını alır; her biri geldiği sırayla. Bir akışın `stop` ve `save`'i ikisinde de çalışır.

## Hub

`appdyno hub` tek bir penceredir: bu Mac'in ulaşabildiği her cihaz bir kenar çubuğunda, önce telefonlar, sonra çalışanlar, kapalı olanlar katlanmış halde; seçilen cihaz da yanında canlıdır ve orada denetlenir. Yalnızca pencerede duran yayın yapar ve bir telefon yalnızca bir kişi onu seçtiğinde başlar: zaten çalışan bir simülatör ya da emülatör hemen görünebilir ve hiçbir seçim bir açılıştan diğerine saklanmaz. Araç çubuğu sistemin kendi araç çubuğudur; kendi penceresindekiyle aynı denetimleri taşır ve yalnızca o cihazda olanları. Denetçi bir tık uzaklıktadır, önce Performans. Arama katlanmış olanları da kapsar. Hub sanal olanları başlatır ve durdurur, bu Mac'te kurulu olandan yeni bir simülatör ya da emülatör oluşturur. Gösterilecek bir şey olmayan yerde sıradaki adımı söyler.

Cihazların altındaki **Yapay Zekâ İstemcileri**, `appdyno install`'ın bildiği her MCP istemcisini gerçek durumuyla listeler. Bağlı sözünü yalnızca gerçek bir çağrı kazandırır: sunucu her istemcinin adını, sürümünü, giriş yolunu ve son çağrısını tutar, gönderdiği hiçbir şeyi tutmaz. Ekle ve Kaldır önce satırların tam halini gösterir ve ikinci bir tıklama ister; Geri Al da o tek girdiyi geri alır. Test Et, bir girdinin çalıştırdığını araç listesine kadar çalıştırır ve başarısız olursa ne yapılacağını söyler; hiçbir araç çağırmaz. Tarayıcıdaki bir istemci için `appdyno mcp --http`'yi, hub ile biten bir süreçte, token istenene kadar gizli olarak başlatır ve durdurur. Bkz. [İstemci bağlamak](../guides/clients.tr.md).

Yapay Zekâ İstemcileri'nin altındaki **Yardım** ya da command-? ağ gerektirmez. appdyno'nun ne olduğunu söyler, en son önde olan cihaz ve uygulamayla doldurulmuş, hedefe göre istemler sunar, her biri cihaza ne yaptığını söyler; her panelin ve sayının ne anlama geldiğini anlatır ve `doctor`'ı çalıştırır. Uygulama, Performans panelinin en son adını verdiği uygulamadır; bu yüzden bir sistem uygulaması ya da bir simülatörde yayını başladıktan sonra açılan bir uygulama, `my app` diyen bir istem bırakır. Bir yer, bir cihazın duracağı yerde durur, bu yüzden cihazın yayını biter ve bir cihaz seçilene kadar Denetçi kapanır. Yardım görünürken istemci listesi her 2 s'de bir okunur, görünmezken hiçbir şey çalışmaz.

Diğer Denetimler menüsünde, bir satırın menüsünde ya da shift-command-N ile bulunan **Yeni Pencerede Aç**, bir cihaza kendi penceresini verir; bu, `appdyno mirror`'ın aynı kodla açtığı penceredir: hub onun orada olduğunu gösterir ve onu kapatabilir. Ölen bir görüntüleyici içinde duranı da götürür ve hub onu sahip olduğu cihazla geri getirir. Bir dakikada üç kez olunca durur.

### Telefon Bağla

Hub'ın gösterecek bir şeyi olmadığında yerinde Telefon Bağla durur ve kenar çubuğundaki satırı ona sonra da ulaşılabilmesini sağlar. Hiçbir şeyi bekletmez: o görünürken hub'ın diğer her bölümü açık kalır.

Elinizdeki telefonu kendisi bulur. Mac'in USB kaydı, telefon neye izin verirse versin, takılı olanı kimin yaptığını söyler ve telefona hiçbir şey sormaz: USB hata ayıklaması kapalı bir Android, adb'nin ondan haberi olmadan önce oradadır. Bu yüzden adb yalnızca elde bir Android varken, Google'ın koşulları gösterildikten sonra istenir; Xcode ise yalnızca bir iPhone varken. USB'de hiçbir şey yoksa bunu açıkça söyler; yalnızca şarj eden bir kablonun hiçbir şey göstermediğini ve başka bir kablo denenmesini de söyler.

Geçerli adım kısa bir cümle ve bir diyagramdır ve telefonun durumu değiştikçe ilerler:

| Telefon | Adımlar                                                      | Nasıl ilerler                                                                                                                                 |
| ------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Android | adb'yi edinin                                                | `doctor` adb'yi bulur                                                                                                                         |
|         | Geliştirici seçenekleri, USB hata ayıklama                   | adb telefondan haberdar olur. Bir Mac'ten bakınca bu ikisi tek bir durumdur, bu yüzden bir kişi aralarında İleri ile geçer                    |
|         | USB hata ayıklamaya izin verin                               | adb'nin durumu `unauthorized`'dan `device`'a geçer                                                                                            |
| Xiaomi  | USB hata ayıklama (Güvenlik ayarları), USB üzerinden yükleme | `persist.security.adbinput` ve `adbinstall` `1` olarak okunur. İkisi de telefonu bekletmez: öyle okunmadıkları yerde bir kişi İleri ile geçer |
| iPhone  | Xcode'u edinin, Güven, Geliştirici Modu                      | `devicectl`'ın eşleştirme ve Geliştirici Modu durumu                                                                                          |

Derleme numarasının yeri Samsung, Xiaomi ve Pixel için adıyla söylenir; başka bir üreticinin telefonunda nerede olabileceği söylenir. Geliştirici Modu, öncesinde telefonun yeniden başlayacağını söyler. Bir kilit ya da karanlık bir ekran yalnızca telefon okunabildiğinde söylenir. Bu Mac'e izin vermemiş bir telefonda hiçbir şey okunamaz, bu yüzden o adım telefonu uyandırmayı söyler. Bir runner'ın neye ihtiyacı olduğu, yanında Çalıştırıcıyı Derle ile, `doctor`'dan gelir.

Bu yer gösterilirken, sahnede hiçbir cihaz yokken hazır hale gelen bir telefon kendiliğinden açılır. Sahne, neyin deneneceğine dair tek bir cümleye yer açar, Yapay Zekâ İstemcileri bir tık uzaklıktadır; cümle 12 s sonra kendiliğinden gider. Bir kişi başka bir yerdeyken hazır hale gelen bir telefon satırını alır ve hiçbir şey kıpırdamaz; iki telefondan ilki açılır, ikincisi satırını alır. Baştan beri hazır olan bir telefon, diğer her telefon gibi satırını ya da Aç'ı bekler: bir telefona yalnızca bir kişi onunla çalıştığında ya da onu seçtiğinde dokunulur. Sizi Bekleyenler altındaki bir telefon burada, kendi adımında açılır. Bu yer görünürken telefon her 3 s'de bir okunur, görünmezken hiçbir şey okunmaz.

### Hub'daki araçlar

Araçlar, appdyno'nun bir terminalde yaptığını çalıştırır; her satır komutun kendisidir ve hub onu bir terminalin çalıştıracağı gibi çalıştırır; aynı işi yapan ikinci bir kod yoktur. Bir pencerenin gönderdiği hiçbir şey kendi başına komut olmaz. Bir satır, cihazı, ne kadar sürdüğü ve sayfasıyla birlikte bir kişiye yönelik bir cümleyle biter. Komut ve söylediği her şey Ayrıntıları Göster'in arkasında durur, böylece hiçbir cihaz kimliği ya da geçici yol araya girmez. Bir uygulaması, cihazı ya da klasörü eksik olan satır soluk durur ve eksik olan en üstte bir kez söylenir. Durdur, komutun başlattığı her şeye Ctrl-C gönderir, böylece bir uçuş kaydedici tuttuğunu kaydeder. Kapının satırı, kapının çıkış koduna göre değil yazdırdığına göre davranır; çıkış kodu bir gerileme için de karar veremediği bir değişiklik için de aynı biçimde 1, çok az örnek için 0'dır: bir gerileme kırmızı, karar veremediği turuncu, yalnızca net bir yanıt yeşildir. Çalıştırması eksik bir baseline kaydedilir ve bunu söyler.

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

İki pencereden birindeki bir dokunuş ikisine de gider. Ne kastettiği inmeden önceki haliyle okunsun diye iki ekranın da okunmasını bekler, sonra ikisine birden aynı anda gider. **İkisine de**'nin bedeli bu beklemedir: bir okuma bir simülatörde ve bir Android emülatöründe 30 ile 60 ms sürdü, iki telefonda ise bekleme, 150 ile 250 ms'ye varır. Diğer cihazda, id'ye ya da sözlere göre aynı şeye gider ve aynı biçimde adlandırılanlar arasından aynısına; çünkü iki cihazda bir şey nadiren aynı yerdedir. Adı olan hiçbir şeyin üstünde olmayan bir parmak aynı yere gider ve bir sürükleme indiği yerden uzunluğunu korur. Tuşlar, metin ve pencerenin cihaz denetimleri ikisine de gider.

Her cihaz bir dokunuşun nereye gittiğini ve ona ne olduğunu söyler. Alt başlık, cihazın çevresinde vurgu renginde bir kenarla **İkisine de** ya da bağlantı denetimi kapalıysa **Yalnızca burada** der ve bir halka bir dokunuşun her ekranda nereye indiğini gösterir. Başarısız olduğu yerde cihazın kenarı kırmızıya döner ve alt başlık, bir dokunuş yerine ulaşana kadar nedenini söyler: o cihazda öyle bir şey yoksa "Burada Send yok" ve başka hiçbir şeye dokunulmaz, "iPhone 17 Pro canlı değil", "Dokunuş yerine ulaşmadı". Böyle bir şeyin üstünde başlayan bir sürükleme aynı yerden sürer, çünkü tek bir şeyi kastetmez. Çubuğu bir tarafı anlatan hub penceresinde her görüntü, altında kimin olduğunu ve bir dokunuşun nereye gittiğini ya da neyin başarısız olduğunu kırmızıyla söyler, kenar çubuğu da çubuğu açık olan cihazı seçer.

Performans'taki **Yolculuğu Ölç…**, bir akışı `iterations` ile `flow` `run`'ın yaptığı gibi ölçer: ilk çalıştırma dışarıda bırakılır, beşi saklanır, aynı depoda: `perf_compare` onu kapıdan geçirir ve dashboard onu diğer her cihazın yanında gösterir. Uygulama adı vermeyen bir akış öndeki uygulamanızı alır, böylece iki kimlik altındaki build'ler tek bir dosyayı çalıştırabilir. İki pencerede önce bir cihazda sonra diğerinde çalışır, çünkü ikisi aynı anda birbirine yük bindirirdi; bu arada dokunuşlar kendi pencerelerinde kalır. Her pencere sonra durumunu söyler: "97 % slower, 1641 ms there" ve en çok değişen adım, kapının sırayla ölçülen iki koşul için kullandığı sıra testi ve tabana göre; ya da "Belirgin fark yok". Her adımın sayıları satırın araç ipucundadır. Yolculuğun başarısız olduğu pencere bunu kırmızıyla söyler, diğerinin karşılaştıracak bir şeyi yoktur.

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
Yazılan cihaza ulaşır, başka hiçbir yere değil: ne bir log, ne Etkinlik paneli ne de `report` onu tutar. Bir iPhone'da runner, XCTest'in her tuştan tutacağını kapatır, böylece orada da böyledir.

Yazma sistemin kendi metin girişinden geçer, bu yüzden ölü tuş, basılı tutulan bir aksan ve bir giriş yöntemi çalışır. ⌘V, Mac'in metnini aynı yolla, en çok 4.096 karakter gönderir ve bir metni kısa kestiğinde pencere bunu söyler, çünkü uzun bir metin tuş tuş gider. Bir simülatör, ABD klavyesinde tuşu olanı tuş olarak, geri kalan her şeyi panosu ve command V ile yazar; bu yüzden bir uygulama Yapıştırmaya İzin Ver diye sorabilir.

Bir iPhone'da yazılan metni runner bir dize olarak gönderir, bu yüzden telefonun klavye düzeni onu değiştirmez. İlk harfler runner'ı başlatır; bu yaklaşık 3 s sürer. Bir metin alanına dokunduktan sonra yazılan harfler, o alan odağı alınca gider; 6 s içinde hiçbir alan onları almazsa atılır ve pencere bunu söyler.

Bir pencere menü çubuğunu ve Dock simgesini bir kişinin ilk tıklamasında alır, daha önce değil: bir ajanın penceresi, biri onu kullanana kadar bir Mac'te hiçbir şeyi değiştirmez.

## Bir cihazı paylaşmak

Bir pencere cihazı sahiplenmez, bu yüzden bir ajan cihazı tutarken de açılır. Kapsülü kimin yönettiğini söyler.
`--no-input` onu yalnızca bakılan bir pencere yapar ve `--allow-devices` geçerlidir.

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
ya da kimsenin bitirmediğini yanıtlar. Varsayılan olarak 300 s, en çok 3.600 s bekler.

Yansıtılan bir cihazda `perf_*`, gürültü işareti `mirrored`'ı alır; bu, yüksek yükün yaptığı gibi bir çalıştırmayı kapının dışında tutar:
bir yayın cihazda bir kodlayıcı çalıştırır.

## Gizlilik: bir pencere ekranın tamamını gösterir

Yansıtma ekranın gösterdiğini gösterir: `report` gizli değerlerin üstünü boyar, bir pencere boyamaz. **Ekran Görüntüsünü Kaydet** ve **Ekranı Kayda Al** da boyamaz: kaydettikleri, ekranın o anki halidir, düz alanlardaki parolalar dahil. Ajanın token'ı görüntüleyiciye stdin'i üzerinden gider, asla argümanlarıyla değil.

## Bir telefonun görüntüsünün boyutu

Varsayılan olan `--quality auto`, bir kişiye yetişen en büyük boyutu alır; buna kodlayıcının her hareket dizisinde ne kadar süre aldığına bakarak karar verir. Kodlayıcısı yetişen bir telefon ekranının boyutunda kalır; geride kalan daha küçük bir boyuta geçer ve sonraki yayın oradan başlar. Bir kişinin okuyabileceği en küçük boyutta, ekranın her dp'si için 1,12 piksel görüntüde durur ve cihazın yetişemediğini söyler. Bir boyut yeniden büyüyebilir: 30 s sonra, bir üst boyut için yeterince hızlı üç dizi onu oraya taşır. `--quality high` ve `standard` ekranın boyutunu korur, istenen bir boyut da o boyuttur.

## Belirtilen sınırlar

- Bir iPhone deneyseldir: belgelenmemiş, değişebilecek servislere dayanır.
- Bir iPhone'un kilit ekranı: ona gönderilen bir kaydırma onu açmaz. Pencerenin denetimlerinden Ana Ekran açar.
- Pencere güvenli bir Android penceresinin içeriğini henüz göstermez, çünkü Android 12'den itibaren hiçbir shell ona erişemez: siyahtır, durum çubuğu yine oradadır. Android 12 ve 13'te ya da burada imajı olmayan 10'da çalıştırılmadı.
- Çerçevenin Eylem düğmesi ve Kamera Denetimi çizilir ve hiçbir şey yapmaz: onlara basan bilinen bir girdi yoktur.
- Bir telefonda `auto` ekranın boyutunda başlar ve kodlayıcının geride kaldığını gösteren ilk harekette onu bir kez değiştirir, bu yüzden bir kişi ilk dokunuşlarında görüntünün yeniden başladığını görebilir. `--quality high` ve `standard` ekranın boyutunu korur.

Bir akış kaydetmek:

- Bir kaydırma yönünü korur, uzunluğunu değil: bir yeniden oynatmanınki ekranın %40'ı kadar gider. Ardından bir tıklama ya da doğrulama geldiyse, ulaştığı şey `scroll_to` olarak saklanır.
- Bir adım, girdi cihaza yola çıktığında yazılır, bu yüzden bir cihazın sonra reddettiği şey, örneğin bir iPhone'un güvenli alanına yapıştırma, dosyada yerine ulaşmış gibi durur. Pencere reddi söyler.
- Bir akış cihazın adıyla Masaüstüne gider: onu orada yeniden adlandırın. Adımlar panelde geri alınamaz: bir akış bir metin dosyasıdır, onu düzenleyin.

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
"Canlı · Görüntü 60 fps · Wi-Fi". Bir adres kime ait olduğunu söylemez, bu yüzden `adb connect` ile ulaşılan bir telefon kendine ait bir
satır tutar. Wi-Fi için eşleştirilmiş bir iPhone, bu Mac'te olana dayanarak ve ağa hiç bakmadan, kablo takılı olmadan listede
durur; telefon orada değilse penceresi bunu söyler. `--wifi` olmadan da ağ üzerinden gider, çünkü başka bir yolu yoktur.

Giden bir ağ okunacak bir son bırakmaz, bu yüzden bunu sessizlik söyler: sessizlik sürünce son görüntü soluklaşır ve pencere,
çekilmiş bir kablodaki gibi `waiting not-connected` der. Adresle, sessizleşen bir aktarıcı üzerinden ulaşılan bir emülatörde
ölçüldü: 20 s'lik bir sessizliğin 7 s'si içinde söylendi, dönüşten sonra 1 s içinde kendiliğinden canlı.

Wi-Fi zaman kaybettirir: bir Android telefonda bir dokunuşun görünmesi kabloyla olduğunun yaklaşık iki katı sürer, bir iPhone'un görüntüsü de daha az düzgündür. Ölçümler [Wi-Fi, çalıştırıldığı haliyle](mirror-internals.tr.md#wi-fi-çalıştırıldığı-haliyle) bölümündedir.

Wi-Fi'daki bir pencere bunları yapmaz:

- Bir iPhone'un eşleştirmesi orada yapılamaz: ağda bir telefon eşleştirme başlatmayı reddeder, bu yüzden bir kez kablo ister.
- Bir telefon bu Mac'in ağını paylaşmalıdır: bir iPhone orada duyurduğu şeyle bulunur, bir Android telefon ise Kablosuz hata ayıklamanın açık kalmasını ister; Wi-Fi'ının gitmesi onu kapatır.
- Wi-Fi ile bir iPhone, istenmedikçe düşük kipi alır.

## Şimdilik dışarıda bırakılanlar

Ses.
