# Pencere nasıl çalışır

[English](mirror-internals.md)

[Pencere ve hub](mirror.tr.md) sayfasının dışarıda bıraktıkları: görüntünün ve girdinin nasıl ilerlediği, bir pencereyle üst süreci arasındaki iletişim protokolü ve her iddiayı tutmak için hangi cihazda, hangi yükte neyin çalıştırıldığı. Yük, Mac'in 1 dakikalık yük ortalamasıdır. Burada adı geçen telefonlar bir Samsung Galaxy A52 (SM-A525F, Android 14), bir Xiaomi (25078RA3EY, Android 16) ve bir iPhone 13 Pro Max'tir (iOS 27.2).

## Görüntü nereden gelir

Emülatörün karesi, tam kendi boyutundaki bir dosyada RGBA'dır, en üst satır önce (proto'nun yorumu aşağıdan yukarı der,
`screencap` ile karşılaştırılan bir kare öyle olmadığını söyler). Boyut verilmeden ya da daha büyük bir dosyaya istendiğinde her kareye yanıt verir ve
hiçbir şey yazmaz. Dönen bir misafir sistem aynı biçimdeki bir karede yana yatık çizer; bu yüzden görüntü, yeni bir oturum açılmadan
görüntüleyicide dik çevrilir. Bir simülatör de yüzeyinde aynısını yapar, geri çağrı olmadan: okuma yardımcısı öndeki uygulamanın nasıl çizildiğini saniyede dört kez söyler; böylece dönmeyen bir uygulama döndürülmüş bir cihazda dik kalır ve bir dokunuş inerken geri döndürülür. `simulator` ile başlatılan bir emülatör, `APPDYNO_EMULATOR_ARGS` yanında `-grpc <free port> -grpc-use-token` alır (bunlar
`-grpc` içermiyorsa). Port, adb'ninki adb'ye ait olduğu gibi, emülatöre aittir. Görüntünün dosyası `0600` izniyle durum
klasöründedir ve oturumla birlikte gider.

## Durumlar ve her birini neyin test ettiği

Bir pencerenin neyi beklediği tek bir tablodadır, `packages/core/src/mirror/need.ts` içindeki `NEEDS`; bunu pencerenin uyarı bandı, `mirror status` ve bir ret kullanır.

| ne olur                             | neyle test edildi                                              |
| ----------------------------------- | -------------------------------------------------------------- |
| yayın sırasında cihaz gider         | yayını altında öldürülen bir emülatör; kablo için elle denendi |
| simülatör kapatılır                 | penceresi altında kapatılan bir simülatör                      |
| ekran kapalı                        | emülatörler ve Xiaomi                                          |
| kodlayıcı başarısız olur            | ajan birim testi; emülatörlerde ve Xiaomi'de `failFirst`       |
| çözücü başarısız olur               | görüntüleyici öz testi; oturum birim testi                     |
| görüntüleyici ölür                  | her türde SIGKILL; oturum birim testi                          |
| üst süreç ölür                      | `appdyno mirror` için SIGKILL, ardından `dumpsys`              |
| ajan durur                          | emülatörlerde ve Xiaomi'de `shutdown`                          |
| Mac uyur, uyanır                    | oturum birim testi; elle denendi                               |
| pencere örtülür                     | görüntüleyici öz testi                                         |
| döndürme, katlama                   | emülatörler; bir simülatörünki bir suite ile, dokunuşlar dahil |
| bir cihazda ikinci pencere          | üst süreç birim testi; Xiaomi'de iki çalıştırma                |
| birkaç cihaz                        | üst süreç birim testi; biri öldürülen üç cihaz                 |
| derleyici yok, pencere sunucusu yok | oturum birim testi                                             |

## Bir iPhone

Bir telefonun servisleriyle konuşan her şey `packages/driver-apple/src/phone-stream/` içindedir ve tek bir giriş yolu vardır: o
klasörü silin, geri kalanı derlenir ve testlerini geçer, bir iPhone runner'ını korur ve yansıtması
`no-phone-stream` olarak reddedilir. Başka hiçbir şeyin onun içine uzanmadığını bir test doğrular.

Kendi tünelini kurar: `usbmuxd`, bu Mac'in eşleştirme kaydıyla lockdown, `CoreDeviceProxy`, ardından IPv6, TCP ve UDP, bu
sürecin bir thread'inde. Apple'ın kendi tünelinin keşif portuna asla bağlanmaz; o port tek bir istemci kabul eder ve
`remoted`'u ondan düşürürdü; bunu da bir test doğrular. Eşleştirme kaydı okunur ve hiç yazılmaz; kabloyla eşleştirme
hiç istenmez ve her ret, bir kişinin yapması gerekeni söyleyerek durur. Bunların hiçbiri için bu Mac'te soket açılmaz; böylece
appdyno yine hiçbir dinleyici açmaz.

`--wifi` ile aynı tünel ağda TCP ve TLS üzerinden çalışır. Oraya ulaştıran `wifi.ts`'dir: burada soket açan tek
dosya odur, o da yalnızca bir telefona açar: `dns-sd` telefonun duyurduğunu bulur ve telefon, tünel için bir anahtar
oluşturulmadan önce, eşleştirmede verdiği anahtarla kendini kanıtlar. Hiçbir şey dinlemez. O eşleştirme `appdyno pair`'in işidir:
telefonda bir kişinin onayı, durum klasörünün `wifi-pairing/` içinde kendine ait bir kimlik, `0600`. Bir kez yapılır,
kabloda: ağda bir telefon `allowsPairSetup: false` der ve hiçbir udid söylemez; kablonun tüneli içinde ise
eşleştirme kabul eden bir servis sunar, böylece bu da keşif portunun yakınına bile gelmez. Eşleştirme kaydı o
tüneli, diğer her tüneli açtığı gibi açar ve ağ üzerinden bir pencerede hiçbir rol oynamaz; bunu da bir test doğrular.

Yayın önce uzak masaüstü profilini ister, yapılandırmaya göre 20 ile 60 Mbit/s, 4:4:4 olarak; bir telefon onu reddederse ya da
`--quality standard` isterse daha düşük olanı, 4:2:0 olarak alır. Görüntüler görüntüleyiciye `0600` izinli adlandırılmış bir pipe ile gider; pipe,
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

## Pencerenin görünüşü

Cihaz, sistemin araç çubuğunun altında, hub'ın paletinden boyanmış bir zeminde durur. Sistemin camının kendine ait bir rengi yoktur, bu yüzden bir pencere arkasında duran kadar zengindir; renk görüntünün üstünde değil, çevresinde yaşar.

Pencere çoğu zaman bir kişinin yazdığı pencerenin arkasındadır, bu yüzden söyledikleri orada da gücünü koruyacak biçimde yapılmıştır. AppKit, anahtar (key) olmayan bir pencerenin çubuğundaki sistem renklerini ve her görüntüyü soldurur: kendi başlığını 2:1'e kadar. Bu yüzden çubuktaki ad bize ait bir etikettir, renkler düz renklere çözülür ve simgeleri bize ait bir görünüm çizer. Gerçek pencerenin pikselleri koyu ve açık olarak, bir simülatörde, hub'ın her yerinde, kullanımdaymış gibi ve diğerlerinin arkasındaymış gibi çizilmiş halleriyle okundu: her iki biçimde 854 sözcük ve simgeden her sözcük 4,5:1 ya da üstünde, her simge 3:1'de; Reduce Transparency, Increase Contrast ve Differentiate Without Color açıkken de, Liquid Glass ayarının iki ucunda da öyle. Arkada tutulan bir pencere anahtar yapılamaz; bu yüzden kullanımdaki hal, pencerenin öyle çizilmiş halidir ve gerçek bir anahtar pencere okunmadı.

Sözleri, Mac'in diline göre Türkçe ya da İngilizcedir ve tek bir tablodan, `mac/Viewer/WordsTable.m` dosyasından gelir. Anahtar İngilizcedir, bu yüzden üst sürecin bir komut satırı için gönderdiğinin ikinci bir ada ihtiyacı yoktur: bir etiket pencerenin kendi sözlerini tabloda arar; tablonun içermediği, örneğin bir aracın kendi hatası, İngilizce kalır. Bir uygulamanın ya da cihazın adlandırdığı, örneğin bir öğenin etiketi, bir uygulamanın ya da cihazın adı, bir adres, bir log satırı ya da bir ajanın ona yaptığı, tabloda asla aranmaz, çünkü oradaki `Settings` ya da `Small` bir addır: geldiği gibi durur, pencerenin bir cümlesinin içinde de; cümle onun çevresinde söylenir.

Çerçeve, modele göre küçük bir tablodan kodla çizilir: köşeleri, adası ya da çentiği, düğmeleri. Hiçbir parçası hazır bir görsel değildir ve her boyut için bir kez çizilir; bu yüzden durgun bir pencerede çerçevenin hiçbir maliyeti yoktur. Bir simülatörün görüntüsü kendi adasını taşır, bu yüzden çerçeve adayı yalnızca görüntüde ada olmayan yerde ekler. **Cihaz Çerçevesini Göster** (⌥⌘F) onu kaldırır ve ayar kalıcıdır. Zemin, paletten karıştırılmış ve katman tarafından gerilmiş küçük bir görüntüdür, bulanıklaştırma geçişi yoktur ve renkleri gösterilen yerle birlikte döner. Bir cihazın renkleri zemine yalnızca ton olarak ulaşır; iki cihaz yan yana durduğunda her biri kendi tarafında; en çok 2 s'de bir ve bir ekran durunca bir kez daha okunur. macOS 26'nın altında kenar çubuğu ve Denetçi sistemin eski malzemesidir ve zemin onların arkasından görünmez. Reduce Transparency düz bir zemin ve dolu kartlar, Increase Contrast daha güçlü çizgiler ve sözler, Differentiate Without Color da her durum için bir biçim verir.

Yalnızca bir durumu değiştiren şey hareket eder ve 300 ms içinde durulur: bir yerin zemini geçiş yapar, bir adım tek bir halkayla geçer, bir çalıştırma işaretiyle yerine oturur, bir sonuç listesine gelir ve kapsül bir durum için geçiş yapar. Bir kişinin tekrarladığı şey, bir satır, bir sekme ya da bir düğme, hemen olur ve bir okuma solmadan değişir. İki şey açıkladıkları için daha uzun sürer: yapılacak adımdaki halkalar ve onun resmindeki vuruşlar, her biri üç kez, sonra dururlar. Dönen bir gösterge yalnızca bir çalıştırma sürerken döner. Durgun bir pencerede hiçbir şey hareket etmez ve Reduce Motion açıkken hareket bir kesmeye dönüşür.

Hareket değişen şey içindir: kenar çubuğunda gelen ya da giden bir cihaz, 200 ms; hemen beliren bir çerçeveye solarak gelen ilk kare, 200 ms; halka, 240 ms; bir nokta, 300 ms; bir ölçüm çubuğunun bir adımı, 150 ms; bir gerileme için küçük bir yay. Durgunken hiçbir şey hareket etmez ve Reduce Motion açıkken her biri düz bir kesmedir. VoiceOver gelen ya da giden bir cihazı ve bulunan bir gerilemeyi duyurur.

## Paneller, çalıştırıldığı haliyle

**Loglar, Çökmeler, Ağ ve Erişilebilirlik.** iOS 27.2 yüklü bir iPhone 17 Pro simülatöründe ve API 34 bir emülatörde, arkada tutulan hub'dan, 4 ile 10 arası yüklerde, her görünüm ve dilde çalıştırıldı: fixture'ın logu geldi, çökmesi raporları arasında durdu, yaptığı bir istek simülatörde belirteci gizlenmiş olarak, emülatörde bayt olarak durdu, erişilebilirlik ekranının sorunları da türlerine göre durdu, biri görüntüde işaretlendi.

**Bağlantılar.** Arkada tutulan bir pencereden, iOS 27.2'li bir iPhone 17 Pro simülatöründe ve bir API 34 emülatöründe, 7 ile 57 arası yüklerde çalıştırıldı: `appdyno-fixture://open/form` fixture'ı formunda açtı ve `javascript:alert(1)` reddedildi, hiçbir şey açılmadı. Aynısı iOS 27.2'li bir iPhone 13 Pro Max'te (fixture uygulama alanında adıyla verildi) ve USB üzerinden Android 14'lü bir Samsung Galaxy A52'de, 6 ile 11 arası yüklerde.

**Bildirim.** Arkada tutulan bir pencereden, iOS 27.2'li bir iPhone 17 Pro simülatöründe 5 ile 12 arası yüklerde, uydurma APNs kimlik bilgileriyle ve push Apple'ın yerine teste gönderilerek çalıştırıldı: alan bu bilgilerle göründü, onlarsız yok oldu ve zengin bir push yazılan token ile gitti. Arkada tutulan bir pencereden 40 ile 52 arası yüklerde çalıştırıldı: iOS 27.2'li, yeni silinmiş bir iPhone 17 Pro simülatöründe başlığı ve bir veri anahtarı olan bir uyarı, bir kişi pencerede uygulamanın bildirimlerine izin verdikten sonra fixture'ın koduna ulaştı; bir API 34 emülatöründe ve Samsung'da dokunulan bir push, fixture'ı iki veri anahtarı extras olarak verilmiş halde açtı ve fixture bunları gösterdi. iPhone'da panel her türü iPhone'un kendi nedeniyle listeledi ve bu yüzden gönderilecek hiçbirini sunmadı.

**Cihaz.** Arkada tutulan bir pencereden, bir API 34 emülatöründe 5 ile 10 arası yüklerde çalıştırıldı: panelin ayarladığı karanlık mod ve 1.3 metin boyutu emülatörde öyle okundu; bir konum, bir arama ve bitişi ve bir kısa mesaj ona ulaştı; koyu ve açık görünümde, İngilizce ve Türkçe, hub penceresi kapandıktan 2,4 ile 2,9 s sonra bitti ve ikisi de önceki gibi okundu. iOS 27.2'li bir iPhone 17 Pro simülatöründe 7 ile 33 arası yüklerde aynı ikisi ayarlandı ve öyle okundu; telsizler, ağın hızı, pil, ısıl durum, katlama, animasyonlar, bir arama ve bir kısa mesaj simülatörün kendi nedenleriyle devre dışı durdu; bir konum ayarlanıp temizlendi ve hub penceresi kapandıktan 0,5 ile 1 s sonra bitti, ikisi de önceki gibi okundu.

## Bir tıklama, ölçülmüş

Bir tıklamadan değiştirdiği ilk görüntüye kadar, her iki durumda 15 tıklama, her biri durgun bir ekrandan, arkada tutulan bir pencere üzerinden. Simülatörde tıklama bir listenin ilk Add'ine, Android'de ise bench'inki gibi fixture'ın frames düğmesine yapılır; bu düğme her kareyi 2 s boyunca çizer. Kaydı olmayan bir pencere Android'de UI otomasyonu tutmaz ve bunlar onsuz başlar. Bir iPhone'da tıklamanın yerine listede bir fiske kullanılır, çünkü küçük bir değişiklik yayınının sürekli gönderdikleri içinde kaybolur.

| cihaz                | kayıt yok, p50, ms | kayıt, p50, ms | Mac'in yükü |
| -------------------- | ------------------ | -------------- | ----------- |
| simülatör, iOS 27.2  | 102,3              | 109,8          | 4           |
| emülatör, Android 14 | 33,2               | 35,1           | 3           |
| Xiaomi, Android 16   | 68,2               | 67,1           | 3           |
| iPhone 13 Pro Max    | 110,7              | 109,0          | 10          |

## Hub, ölçülmüş

Bir simülatörle bir Android emülatörü arasında başka birini seçmek, yaklaşık 250 yükte 0,4 ile 0,8 s sürdü. Hub'ın altında öldürülen bir görüntüleyici, bir Android emülatöründe ve bir simülatörde, sahip olduğu cihazla 0,6 s'de geri geldi.

Bir istemcinin adı üst süreç tarafından `packages/cli/src/clients.ts`'ten gelir, asla görüntüleyiciden değil.

Telefon Bağla'nın adımları her sürücünün kendisinindir (sağlayıcısındaki `guide`); gerçekleri `doctor` ve `NEEDS` tutar, diyagramı da görüntüleyicide çizilir. Hub'ın Araçları tek bir tablodan gelir: `packages/appdyno/src/hub-run.ts` içindeki `HUB_RUNS`.

## İki cihaz, ölçülmüş

Gerçek bir tıklamanın bırakılmasından penceredeki ilk değişen görüntüye kadar; yan yana bir Samsung SM-A525F ve bir Xiaomi 25078RA3EY'de, 720x1600'de, yük 5, her iki durumda 15 tıklama, her biri yerine ulaşarak. Bu, bench'in değil bir kişinin kendi ölçümüdür; bench bir kare gelince durur:

| Tıklanan | Yalnızca burada, iki yayın açık, p50, ms | İkisine de, tıklanan cihazda, p50, ms | İkisine de, diğerinde, p50, ms |
| -------- | ---------------------------------------- | ------------------------------------- | ------------------------------ |
| Xiaomi   | 97                                       | 243                                   | 265                            |
| Samsung  | 113                                      | 368, 180 ile 623 arası                | 363                            |

Yalnızca burada, her telefonun tek başına okuduğudur; bu yüzden ikinci bir yayın ölçülebilir bir bedel getirmez ve İkisine de'nin eklediği o beklemedir. Okumalar ondan ayrı olarak zamanlanmadı.

## Klavye

Bir iPhone'da bu, buna göre ayarlanmış bir runner gerektirir. XCTest varsayılan olarak her tuş için, güvenli bir alanınki dahil, bir satırı ve okuduğu her alan değerini `xcodebuild`'in tuttuğu sonuç paketine yazar; kendi yazması da metni `xcodebuild`'in çıktısına yazar. Runner bu satırları kapatır, XCTest'in olay sentezleyicisiyle yazar ve `xcodebuild` her cihaz için durum klasöründe bir klasör tutar, `ios-<udid>.kept`; her başlangıçta değiştirilir ve bir durdurmada gider. Bir cihaz testi onu arar.

Anahtar pencere olmak yetmez. Öndeki uygulama etkinleştirmeyi başlattığı şeye devreder; bu yüzden bir kişinin yazdığı bir terminal, yeni bir pencereye o kişinin tuşlarını verebilirdi. Bu nedenle bir görüntüleyici açılışını tamamlayana kadar etkinleştirilemez, arkada tutulan bir görüntüleyici ise hiç etkinleştirilemez: sistem onu arka plan süreci sayar. Ayrıca bir kişi o pencerede fareye basana kadar cihaz hiçbir tuşu, yazılan metni, yapıştırmayı ya da cihaz kısayolunu duymaz; bu, pencere klavyeyi kaybedene kadar geçerlidir. ⌘Tab ile geri gelmek, tuşlar cihaza ulaşmadan önce bir tıklama gerektirir; fareyle seçilen bir menü gerektirmez.

Bir iPhone'da yazılan metni runner bir dize olarak gönderir, bu yüzden telefonun klavye düzeni onu değiştirmez. Tuş konumlarıyla gönderildiğinde Türkçe bir düzen `quick`'i `quıck`'e, `-`'yi `*`'a çevirdi ve hiçbir şey söylemedi. İlk harfler runner'ı başlatır; bu yaklaşık 3 s sürer. Bir dokunuştan sonraki ilk harfler, altında ne olduğunu sorar. Bir metin alanındaysa o alanı adlandırırlar ve alan odağı alınca giderler; yeni bir pencerede ilk dokunuş için 2,3 s'de, bir alandan diğerine bir dokunuş için 70 ile 200 ms'de; 6 s'de ise, bir sonraki dokunuşa kadar onlardan sonra yazılanlarla birlikte atılırlar ve pencere bunu söyler; çünkü klavye o dokunuş boyunca açık kalır ve erken gelen harfler, aralarında bir parola da olmak üzere, ondan önceki alana ulaşmıştı. Hiçbir alanın üstünde olmayan bir dokunuş metin imlecini olduğu yerde bırakır ve harfler oraya gider. Bir harf runner ile 285 ms sürer ve saniyede 8 harfte bir kişi onları yaklaşık 475 ms sonra görür, en kötüsü 678; çünkü biri yoldayken yazılanlar birlikte gider. Yalnızca metni olan bu yoldan gider: ok gibi metni olmayan bir tuş, kendisinden önceki harflerden sonra tuş olarak gider.

Runner'a söylenmemiş bir uygulamada runner bir dokunuşun altında ne olduğunu söyleyemez; bu yüzden harfler, dokunuştan 3 s sonra telefonun erişilebilirlik servisinin tek bir bakışını bekler ve yalnızca bu bakış bir alanı adlandırırsa giderler; o alan da, dokunuş sonuncuya yapılmadıysa, sonuncudan farklı olmalıdır. Tek bir bakıştır, çünkü art arda bakışlar bir alanı 8,9 s boyunca odaktan alıkoydu. Runner bulunamadığında aynı bakış karar verir, harfler tuş konumuna göre gider ve pencere bunları telefonun düzeninin belirlediğini söyler.

Bir Android telefonun bunların hiçbirine ihtiyacı yoktur. Bir Samsung ve bir Xiaomi, yazdırılabilir 95 ASCII karakterin hepsini ve `ç ğ ı İ ö ş ü`'yü, bir pencereden de `type_text` ile de verildiği gibi aldı; güvenli bir alana dokunduktan 100 ile 900 ms sonra yazılan harfler 72 turun 72'sinde oraya ulaştı.

## Boyut nasıl seçildi

Varsayılan olan `--quality auto`, bir kişiye yetişen en büyük boyutu alır: hızını koruyan bir görüntü yine de geç kalabilir ve bir dokunuş tam olarak bunu bekler. Ajan, kodlayıcının her hareket dizisinde, anahtar kareden sonraki beş ya da daha fazla karede ne kadar süre aldığını okur, çünkü bir saatin tıkırtısı ya da bir dalgalanma bu konuda hiçbir şey söylemez. Art arda iki dizide 40 ms'yi aşarsa doğrudan piksellerinin sığacağını söylediği boyuta geçer ve sonraki yayın oradan başlar. Hiçbir yerde bir model adı geçmez ve kodlayıcısı yetişen bir telefon ekranının boyutunda kalır. `--quality high` ve `standard` ekranın boyutunu korur, istenen bir boyut da o boyuttur.

Bir kişinin okuyabileceği en küçük boyutta durur ve cihazın yetişemediğini söyler: ekranın her dp'si için 1,12 piksel görüntü, bu da 914 dp'lik bir ekranda 1024 satırdır. Kare hızının bunda payı yoktur. Mac'in Vision'ı, gerçek bir pencerenin üç Ayarlar ekranından gösterdiğini okudu; cihazın kendi görüntüsünde okuduğu sözcüklerden kaçını okuyabildiği şöyle:

| görüntü  | 14 sp'de metin | 11 sp'de, Material'ın en küçüğü | 9 sp'de |
| -------- | -------------- | ------------------------------- | ------- |
| 576x1280 | 79/79          | 95/95                           | 104/104 |
| 456x1024 | 78/79          | 95/95                           | 102/104 |
| 360x800  | 79/79          | 93/95                           | 74/104  |

Göz de aynı fikirde: 360x800'de 9 sp'lik bir metin satırı seçilemez, 456x1024'te seçilebilir. Gövde metni tek başına burada bir şey söylemez; taban bu yüzden en küçükten alınır. Bir boyutu reddeden kodlayıcı başka bir konudur ve yine de tabanın altına inebilir: herhangi bir boyutta bir görüntü hiç olmamasından iyidir.

Bir boyut yeniden büyüyebilir. Bu boyutta 30 s geçtikten sonra, aynı piksel kuralına göre bir üst boyut için yeterince hızlı art arda üç dizi olursa bir boyut yukarı çıkar; fazla yavaş olduğu görülen bir boyut 5 dakika bırakılır, bir büyüme her geri dönmek zorunda kaldığında bu süre iki katına çıkar, en çok bir saate kadar, yeni bir yayına dek. Durgun bir ekranda hiçbir şey okunmaz, bu yüzden görüntü bir kişi onu hareket ettirdikçe büyür. Bir emülatörde misafir sistem yük altındayken bir görüntü 456x1024'te kaldı ve bunu söyledi; `device-tests/mirror.android.test.ts`, istenen okumayla, gerçek bir yeniden başlatmada bir yayının büyüdüğünü doğrular, çünkü yoğun bir Mac altında bir dizi o boyutta 968 ms okudu ve kendiliğinden hiçbir sakinlik gelmedi. Android 14'lü bir Samsung A52'de, 8 ile 25 arası yükte, istenen okumayla (`roomMs` 1500, böylece her sakin dizi yer var diye okunur ve gerçek olan geri dönüş ve beklemedir), bir yayın 0,51 dk'da 1600 satırdan 1920'ye çıktı ve 2 s sonra geri döndü; bir sonraki deneme bundan 10,0 dk sonra, 5 dakikanın iki katı sonra geldi ve 19 s içinde geri döndü.

| Samsung SM-A525F, 90 Hz | kare/s | yakalamadan varışa p50; p95, ms | dokunuş p50, ms |
| ----------------------- | ------ | ------------------------------- | --------------- |
| 1080x2400               | 89     | 69,3; 73,4                      | 217             |
| 720x1600                | 65     | 36,6; 64,5                      | 107             |
| 576x1280                | 69     | 26,4; 29,3                      | 94,8            |
| 456x1024                | 81     | 23,6; 26,5                      | 93,8            |

O telefonun ilk yayını 576x1280'e yerleşir ve sonraki oradan başlar. Küçük bir ilk dizi eksik okuyabilir, bu yüzden bir boyutun yerleşmesi iki adım sürebilir; her biri, bir kişinin ilk dokunuşlarında görüntünün yeniden başlaması demektir.

Bir kodlayıcının kendisi hakkında yayımladıkları buna karar veremezdi: Android'in ölçeklediği gibi ölçeklendiğinde `measured-frame-rate` değerleri Samsung'un 2400 satırının bir Xiaomi'nin 1600 satırından hızlı olduğunu söyler; oysa Xiaomi'de bir dokunuş iki kattan daha hızlıdır.

## Bir yansıtmayı ölçmek

`packages/appdyno/scripts/mirror-bench.mjs <device>`, Android'de fixture'ın frames ekranını, iOS'ta ise bir
listeyi çalıştırır, dokunmadan önce ekranı okur ve her hedefin kararını host'un yükü yanında söyler. Bütün değerler bir karenin bu Mac'e ulaştığı
zamandır, telefonun camında göründüğü zaman değil. 60 yükünün üstündeki bir ıskalama "run it later" der. Sayılar, ölçümlerin nasıl doğrulandığını anlatan sayfadaki [Yansıtma](perf-evidence.tr.md#yansıtma) bölümündedir.

## Bir pencereye bakmak

Arkada tutulan ya da hiç penceresi olmayan bir görüntüleyici kendine ait bir panoya, `dev.appdyno.behind`'a kopyalar, çünkü bu Mac'in panosu bir kişinindir. `packages/core/test/viewer-behind.test.ts`, bir kopyalamanın öncesinde ve sonrasında Mac'in kendi sayacını okur; görüntüleyicinin öz testi de yaptığı her şeyin çevresinde.

`packages/appdyno/scripts/mirror-shots.mjs <simulator> <folder>`, hiçbir şeyi öne getirmeden bir pencerenin her durumunu açık ve koyu olarak yazar. `--behind` gerçek bir pencereyi her ekranın dışında tutar; pencere sunucusu onu orada da, cam ve görüntü dahil, birleştirir ve `{"op":"snapshot","file":...}` onu dışarı yazar; hiçbir izin sorulmaz, çünkü bir süreç kendi penceresini okuyabilir. İmleç üzerinde durma, animasyon, sayfalar ve menü çubuğu bu yolla görülemez: bunları elle denemek gerekir.

## Pencerenin iletişim protokolü

Bir görüntüleyici ve üst süreci, görüntüleyicinin stdin ve stdout'unda satır başına bir JSON nesnesi konuşur, her birinde bir `op` vardır. İki taraf da bilmediği bir adı atlar, bu yüzden `packages/core/src/mirror/viewer-wire.ts` içindeki `VIEWER_OPS` hepsini listeler, derleyici üst süreci bu listeye bağlı tutar, bir test de listeyi görüntüleyicinin kaynaklarına ve bu tablolara bağlı tutar. Yanındaki `ViewerMessage` ve `ViewerOrder` her ada alanlarını verir, üst sürecin işleyicileri onları adla okur, aynı test de onları görüntüleyicinin yazıp okuduklarına bağlı tutar.

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

## Sınırlar ve çalıştırılmamış olanlar

- Bir iPhone bağlanırken kapatılan bir hub: pencere hemen gider, süreç ise runner'ının başlatılması başladıktan yaklaşık 5 s sonra; çünkü o başlatma sonuna kadar sürer ve bir runner kendi host'undan uzun yaşar. Bu arada açılan bir hub ayağa kalkar ve canlıdır.
- En ağır görüntüde, 167 Mbit/s, yük altındaki bir iPhone: 361 yükünde başlayan 30 dakika boyunca paketlerinin %0,25'i kayboldu, her kayıp görüntüyü bir anahtar kareye kadar dondurdu. 8 yükünde 15 dakika boyunca, görüntü ağırlaşırken bir kez %0,01 kaybetti ve 1,1 s donma oldu.
- Performans panelindeki **Gösterge Panelini Aç** sayfasını yazar ve `open` ile açar: sayfanın ardından bir tarayıcıda göründüğünü elle denemek gerekir, çünkü bir test hiçbir şeyi öne getirmemelidir.
- Bir kişinin tıklamadığı bir pencerede tuşlar hiçbir yere gitmez: bir pencereye yazmayı elle denemek gerekir, çünkü bir testin penceresi klavyeyi hiç tutmaz.
- Bir simülatörün katlanması: bir simülatörü katlayan bir denetim bulunamadı, bu yüzden bir katlanmada yeni bir yüzey test edilmedi.
- Canlı sayılar bir simülatörde, bir Android emülatöründe, bir Samsung'da, bir Xiaomi'de ve bir iPhone'da çalıştırıldı. Bir iPhone'da bir kişiyi bir uygulamadan diğerine izleyen bir pencere telefonsuz test edildi.
- Bir pencerenin ölçümleri bir simülatörde ve bir Android emülatöründe çalıştırıldı. Bir iPhone'da bir açılış çalıştırıldı; bir kaydırma turlarını çalıştırır, sonra trace aracı kendi trace'inde başarısız olur ve pencere bunu söyler.
- Okumaların bir cihaza bedeli tek bir Android 14 emülatöründe, saniyede on kez değişen bir ekranda dururken ölçüldü: pencere açık ve sayılar kapalıyken bütün CPU'sunun %6,0'ı, sayılar gösterilirken %10,8'i, 30 s'lik sekiz dönem boyunca. Hiçbir telefon ölçülmedi.
- Bir cihazın rengi: çerçeve bir renk alır ama henüz hiçbir şey onu bir cihazdan okumaz, bu yüzden her çerçeve tablonun kendi grafit ya da karbon rengidir.
- Runner yokken, bir iPhone klavyesinde tuşu olmayan metin panosu üzerinden gider: telefon bir kişiden yapıştırmaya izin vermesini ister ve panonun tuttuğu, metinse sonra geri gelir. Güvenli bir alanda hiç gitmez ve pencere bunu söyler. Orada karar veren tek bakış yalnızca birim testleriyle, turlar halinde ve hiçbir telefon olmadan denendi.
- Yeni bir pencerede ilk dokunuşun bir alana odağı vermesinin neden 2,3 s sürdüğü bilinmiyor. Turdan tura bu değere yakın kalır ve araya erişilebilirlik servisinin hiçbir okuması girmez.
- Hiçbir alan almadığı için atılan harfler yine de bir kayda ulaşır; kayıt onları pencereden çıkarken not eder: bir yeniden oynatma onları yazar.
- Diğer Denetimler menüsü, çerçevenin üzerinde durma, bir pencerenin hatırlanan boyutu ve yeri ve bir trackpad'de kıstırma ya da gerçek bir klavyede ölü tuş elle denenmedi; hesapları öz testle denetlenir.
- Bir telefonun dokunuşunun, hiçbir boyutun altına indiremediği bir tabanı vardır: bir Samsung SM-A525F'de 1024 satırda 94 ms, 1280'de çalıştırmalar boyunca 95 ile 107 arası; hedef olan 80'in üstünde. Bir Xiaomi'ninki kendi boyutunda 92 olarak okunur, bu da bir ıskalama.
- İki cihaz, her birinde fixture ile, bir simülatörde ve bir Android emülatöründe ve bir Samsung ile bir Xiaomi'de çalıştırıldı. Bir ekranda yan yana duran iki pencere gözle değil öz testin hesaplarıyla denetlenir, çünkü bir testin pencereleri her ekranın dışında tutulur; döndürülmüş bir cihaz bir çiftte çalıştırılmadı. İki kimlik altında iki build çalıştırılmadı.
- `key` ile girdi: Android ajanın tuşlarına basar ve orada Esc, Geri'dir; bir kayıt da bunu yazar, böylece bir yeniden oynatma yapılanı yapar. Bir simülatörde bir klavyenin karakterleri ABD tuşları olarak gider; diğer her metin panosu ve command V ile.

Bir akış kaydetmek:

- Bir iPhone'da bir kayıt ve panel, ilk kullanımın başlattığı runner'ı ile okur: `inspector` yerleri olmadan sözler ve id'ler verir, bu yüzden runner yokken bir tıklamanın adlandırılacağı bir öğe olmaz ve pencere nedenini söyler.
- Bir iPhone'da ya da bir Xiaomi'de yapılan bir akış orada, bir simülatörde ve bir emülatörde yeniden oynatıldı. Bir simülatörde ya da emülatörde yapılan, diğerinde yeniden oynatıldı, hiçbir telefonda değil.
- Bir cihazın kendi klavyesindeki tıklamalar yalnızca yerine geçen bir cihazda kaydedildi. Gerçek bir imlecin üzerinde durması, bir tekerlek ve bir trackpad elle denenmedi: bir testin penceresine gönderilmiş tıklamalar, sürüklemeler ve üzerinde durmalar verilir.
- Cihazın kendi klavyesindeki tıklamalar sonradan alandan anlaşılır, bu yüzden Return tuşu görülmez: onu Mac'in klavyesi kaydeder ve pencere bunu söyler.
- Başka bir süreçten gelen `flow start` bir pencereye çeyrek saniye içinde ulaşır ve bu sürede yapılan tıklamalar kaydedilmez. Aynı anda tek bir kayda yazan iki süreç bir adım kaybedebilir.
- Üzerinde durma ve bir doğrulama en son okunana göre gider; bu yüzden son okumanın süresi içinde değişen bir ekran eski halini gösterir ve o zamandan beri gelen bir şeyin üstünde duran imleç hareket edene kadar hiçbir şey söylemez.

## Wi-Fi, çalıştırıldığı haliyle

Android'de telefonun kendi Wi-Fi'ının gitmesi başka bir konudur. Kablosu takılıyken Wi-Fi seri numarasıyla bağlı bir Samsung SM-A525F'de, Wi-Fi'ı `svc wifi` ile 20 s kapatıldı, 5 yükünde tek çalıştırma: 7,1 s'de söylendi ve kendiliğinden geri gelmedi, çünkü Android Wi-Fi ile birlikte Kablosuz hata ayıklamayı da kapattı ve Wi-Fi döndükten 30 s sonra hâlâ kapalıydı. O kablo üzerinden `adb_wifi_enabled` ile yeniden açılınca pencere 1,6 s sonra canlıydı. Kablosu olmayan bir telefonda bunu Kablosuz hata ayıklama altında elle yapmak gerekir. adb sonra telefonu iki kez listeledi, adıyla ve aynı adın `(2)` eklenmiş haliyle; ikisi de telefonun dinlediği tek porta ulaşıyordu ve Kablosuz hata ayıklama kapatılıp açıldıktan sonra da öyleydi: hub onun için tek bir satır tutar.

Wi-Fi'ın bedeli, bir Samsung SM-A525F'de kabloyla kendisine karşı ölçüldü (tablo [Yansıtma](perf-evidence.tr.md#yansıtma) bölümünde): bir dokunuşun görünmesi yaklaşık iki kat uzun sürer, 103 ile 110 yerine 168 ile 208 ms; bir pencere 100 ile 150 ms, bir kez de 1,4 s daha geç açılır. Görüntülerin çoğu kabloyla olduğu kadar çabuk gelir, yirmide bir en yavaşı ise yaklaşık 50 ms daha geç; bir kişi bunu hareket eden bir telefonda düzensiz bir görüntü olarak görür. Olası neden ağın gidiş-dönüşüdür, ama ayrıca ölçülmedi: o telefona bir ping 6 ile 170 ms arası sürdü.

Bir iPhone 13 Pro Max'te kabloyla kendisine karşı, aynı yerde bedeli: bir pencere 0,5 yerine 1,5 ile 2,5 s'de açılır, bir görüntü 60 yerine saniyede 44 ile 59 kare alır ve bir çalıştırmada 0 ile 4 yerine 13 ile 18 kez donar, her seferinde bir saniyeden kısa; bir fiske 93 ile 98 yerine 121 ile 470 ms'de görünür. Wi-Fi ile beşer fiskelik üç çalıştırmada 10 fiskeden yalnızca 2 ile 5'i göründü ve hiçbir neden bulunamadı.

O Samsung'da, kablosu takılıyken Wi-Fi seri numarasıyla, arkada tutulan pencere suite'iyle, 4 yükünde 12/12 çalıştırıldı: bir görüntü, bir dokunuş, yazma, bir uzun basış, bir sürükleme, Ana Ekran, Son Kullanılanlar, Geri, döndürme, bir ekran görüntüsü, Denetçi, ajanının öldürülüp geri gelmesi, bir kapatma ve yeni bir açılış. Bir telefonun, hangi yoldan ulaşılırsa ulaşılsın tek bir ajanı vardır.

O iPhone'da, kablosu takılıyken çalıştırıldı. Bir eşleştirme: telefonda bir soru belirir, bir kişi onaylar ve `appdyno pair` sonra ikisinin eşleştiğini söyler. Arkada tutulan pencere suite'iyle, harfleri hâlâ kablodan giderken Wi-Fi ile 16/16: bir fiske, bir dokunuş, metin, panodan bir gizli değer, karartma ve geri gelme, döndürme, ekran görüntüleri, öldürülen bir görüntüleyici. Sürücüye kablo olmadığı söylenerek, böylece görüntü, dokunuşlar ve harfler ağda tünellerden geçerek, 4 ile 7 yükte: harfler suite'i, 6/6; bir düzenin başka bir karaktere çevirdiği her karakterle, 100 ve 900 ms önce dokunulmuş güvenli bir alana bir gizli değerle, odağı olmayan bir alanla ve `xcodebuild`'in tuttuklarında hiçbir sözcük kalmadan; ve gerçek penceresi arkada tutulan pencere suite'i, 17/17. Bunların hepsinde runner'ı `xcodebuild` kablo üzerinden başlattı.

Bir runner telefonunun loopback'iyle sınırlı kalır; Wi-Fi için eşleştirilmiş bir telefonda aynı token ile bir tüneli de kabul eder. Hiçbir dinleyici yalnızca bir tünelle sınırlanamazdı, bu yüzden eşleştirilmiş bir telefonda portu Wi-Fi'da da açık durur ve o yoldan gelen hiçbir şey okunmadan kapatılır. O iPhone'da denendi: telefonun Wi-Fi adresinden gelen token'ı 15 ms içinde kesildi, bir tünelden geldiğinde ise yanıtlandı. Bu Mac'te eşleştirme yokken o port Wi-Fi'da reddetti.

Runner bulunamazken (bu durumu hemen başarısız olan bir `xcodebuild` taklit etti), her biri bir çalıştırma: düz bir alana dokunduktan sonra yazılan, tuşu olmayan metin panodan gitti, pencere bunu ve harflerin artık tuş konumuyla gittiğini söyledi ve telefonun yapıştırma sorusunu bekledi; güvenli bir alana dokunduktan sonra yazıldığında gitmedi ve pencere hiçbir alanın onu almadığını söyledi. İkisinden sonra telefonun kendi görüntüsü her alanı boş gösterdi.

Sürücüye kablo olmadığı söylendiğinde gerçek bir hub, adb Samsung'u iki kez listelerken bile, bir Samsung'u ve bir iPhone'u Wi-Fi ile, her birini tek satırda listeler ve her pencerenin çubuğu bunu yanında canlı sayılarla söyler. Kablolar görüldüğünde her biri kablosuyla tek bir satırdadır.

Kablo çıkarılmışken çalıştırılmadı, bu yüzden bir iddiada bulunulmaz: kablosu takılı olmayan bir iPhone'un herhangi bir şeyi ve önce `xcodebuild`'in runner'ını başlatıp başlatamadığı; kullanımdaki bir telefondan çekilen bir kablo, Wi-Fi ile süren bir pencere ve gerçek bir hub'da bununla değişen bir satır. Bir telefonda çalıştırılmadı: bir iPhone'da giden bir ağ ve hub'ın kartının gerçek bir telefonu eşleştirmesi; bunları öz testi ve birim testleri doğrular.
