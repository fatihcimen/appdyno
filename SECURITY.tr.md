# Güvenlik

[English](SECURITY.md)

## Bir güvenlik açığını bildirmek

Özel olarak bildirin, herkese açık bir issue açmayın. Bu depo herkese açık olduğunda, depodaki GitHub özel
güvenlik açığı bildirimini kullanın (Security sekmesi). O zamana kadar fatih@fatihcimen.com adresine yazın.
Ne yaptığınızı, ne olduğunu ve sürümü ya da commit'i söyleyin.

## Makineden hiçbir şey çıkmaz

appdyno'da telemetri yoktur ve hiçbir yere bir şey göndermez. Bir sürümü yalnızca siz `appdyno update` ya da
Check for Updates çalıştırırken sorar: paket npm kayıt defterine, uygulama bu deponun sürümlerine. MCP sunucusu bunu
hiç yapmaz. Uygulama adb'yi Google'dan yalnızca Google'ın koşullarını kabul ettiğinizde indirir. `npx -y appdyno` çalıştıran bir istemcide npx,
her açılışta, appdyno çalışmadan önce kayıt defterine sorar: bu npm'in işidir ve `docs/guides/clients.md` dosyasının dediği gibi global bir
kurulum sürümün değişmesini önler.
Varsayılan olarak MCP sunucusu, onu başlatan istemciyle stdio üzerinden
konuşur ve ağdan bağlantı dinlemez. Yalnızca `--http` bir dinleyici açar: aşağıya bakın. Ölçümler yerel diskte, durum
klasörü ya da `--measurements` klasörü altında saklanır. Android ajanı cihazda abstract bir unix soketini
dinler; ona adb üzerinden ulaşılır ve yalnızca kendi başlatma token'ını taşıyan bağlantıyı kabul eder. Bir iPhone'a
USB üzerinden ulaşılır, ağ üzerinden ise ancak bir kişi onu bunun için `appdyno pair` ile eşleştirdikten sonra. Bir pencerenin görüntüsü aynı ajandan, aynı token ile gelir; token viewer'a
stdin'i üzerinden verilir. `simulator` ile başlatılmış bir emülatörde ise görüntü o emülatörün kendi gRPC portundan, token'ının arkasından,
yalnızca bu kullanıcının okuyabildiği bir dosyaya gelir.

## Sunucunun yapabildikleri

Sunucunun bir istemcisi, bir cihazda onu elinde tutan bir kişinin yapabildiğini yapabilir: ekranı okur, dokunur, kaydırır ve
yazar, bağlantı açar, uygulama başlatır ve durdurur, panoyu, konumu ve ekranın yönünü ayarlar, ekran görüntüsü alır ve
bir uygulamanın loglarını ve çökme kayıtlarını okur. Android ajanı shell kullanıcısı olarak çalışır. Ekranda gösterilen
her şey istemciye görünür, bu yüzden modelin onu gördüğünü varsayın.

Sizin koyduğunuz sınırlar:

- `--allow-devices`, `--allow-apps` ve `--allow-urls` sunucunun nerede iş yapacağını sınırlar.
- `--no-home` ana ekran tuşunu engeller.
- `APPDYNO_SECRETS=a,b` değerleri hiçbir zaman geri gösterilmez ve panoya konmaz. Loglardan ve çökme
  özetlerinden bu değerler çıkarılır.
- Sunucu, Android'de başka bir aracın UI otomasyonunu yalnızca `--takeover` ile durdurur. Bu seçenek olmadan
  cihazı tutanın adını söyler ve hiçbir şey yapmaz.

Bir pencere, ekranın gösterdiğini bu Mac'in başında oturan herkese gösterir. `--no-input` ile pencere yalnızca izler.

## Bir kişiyi bekleyenler

Hiçbir araç bir cihazı ya da simülatörü yeniden başlatmaz, içeriğini silmez ya da sıfırlamaz; hiçbiri bir simülatörü ya da emülatörü kaldırmaz:
herhangi bir kaynak bunun bir yolunu kazanırsa `packages/appdyno/test/device-reset.test.ts` başarısız olur. `simulator create`, oluşturduğunu bir kişinin
nasıl kaldıracağını söyler ve bunların hiçbirini çalıştırmaz.

Bir kişinin isteyebileceği veriyi kaybettiren işlem önce o kişiye sorar: [liste](docs/reference/tools.tr.md#önce-kişiye-sorulanlar).
Soruyu istemci gösterir, model onu yanıtlayamaz ve bir hayır hiçbir şey yaptırmaz. İstemcinin soramadığı yerde ve
`--http` üzerinden işlem reddedilir; ancak kişi sunucuyu `--allow-data-loss virtual` (simülatörler ve
emülatörler) ya da `all` ile başlattıysa reddedilmez. Bir araç çağrısının taşıdığı hiçbir şey bunu ayarlamaz ya da evet yerine geçmez. İstemcinin
ayarlarını değiştirebilen ya da bir kabuk çalıştırabilen bir model, sunucunun durdurabileceklerinin ötesindedir: `appdyno`'yu `--yes` ile ya da doğrudan `adb`'yi çalıştırabilir ve
o zaman geçerli olan, istemcinin her komut için kendi verdiği izindir.

## Wi-Fi

`appdyno pair`, bu Mac'in tek bir telefonla paylaştığı bir kimliği bir kez, telefonda bir kişinin onayıyla oluşturur. Bir iPhone'da bu kimliğin
özel anahtarı durum klasöründe, `wifi-pairing/` altında durur ve onu yalnızca bu kullanıcı okuyabilir: **bu dosyaya sahip olan ve
telefonun ağında bulunan herkes telefonun geliştirici servislerine ulaşabilir**, bir pencerenin yaptığı gibi. Bu, eşleştirme kaydı değildir;
o kayıt okunur, hiç yazılmaz. Bir iPhone'un eşleştirmesi kablosundayken yapılır, çünkü ağ üzerinden telefon buna izin vermez. Her
başlangıçta telefon, eşleştirmede verdiği anahtarla kendini kanıtlar; böylece ağda onun yerine yanıt veren başka bir şey
geri çevrilir. Ağda hepsi şifrelidir. Android'inki adb'nin kendisine aittir ve onu adb saklar.

Bir iPhone'un runner'ı, telefon bunun için eşleştirilmedikçe telefonun loopback'iyle sınırlı kalır. Eşleştirilmiş bir telefonun runner'ı aynı token ile bir tüneli
de kabul eder; hiçbir dinleyici yalnızca bir tünelle sınırlanamadığı için de çalıştığı sürece portu telefonun ağında açık
durur: bir bağlantı yalnızca loopback'ten ya da tünel türünden bir arayüzden, Mac'in tünel ucundan telefonun ucuna
geldiğinde okunur; görülen her tünel bu iki ucu tek bir özel /64'ün `::2` ve `::1` adresleri yaptı. Diğer her bağlantı,
aralarında telefonun Wi-Fi'ı ve bir VPN'inki de olmak üzere, hiçbir şey okunmadan kapatılır; tek istisna telefonda aynı
biçimde adreslerle kurulmuş bir VPN'dir, o da runner'ın token'ına ulaşırdı.

## `--http`

`appdyno mcp --http 127.0.0.1:PORT` aynı araçları MCP'nin Streamable HTTP taşıması üzerinden sunar. Yalnızca bu Mac'in
loopback'ine bağlanır ve başka her adresi reddeder. Her istek token ister, token sabit sürede karşılaştırılır ve
sunucununkinden başka bir `Origin` taşıyan istek reddedilir; böylece bir web sayfası ona ulaşamaz. Üretilen bir token bir kez,
başlangıçta yazdırılır ve hiçbir token loga yazılmaz.

Onu internete çıkaran bir tüneldir ve tüneli siz çalıştırırsınız: appdyno tünel çalıştırmaz ve bize ait bir servis yoktur.
**Adresi ve token'ı bilen herkes cihazlarınızda yukarıdakilerin hepsini yapabilir, ayrıca bir aracın yol aldığı yerlerde bu
Mac'te dosya okuyup yazabilir.** Tüneli ve istemciyi çalıştıran kim olursa trafiği görür; bir adresteki token da
tünelin loglarında görünür. Süreyi kısa tutun, `--allow-devices`, `--allow-apps` ve `--allow-urls` ile sınırlayın ve işiniz
bitince durdurun. Sunucu bir token'ın iki sahibini birbirinden ayıramaz: bir istemciyi verdiği adla tanır; bu,
iki istemciyi tek bir bağlamdan uzak tutmak içindir, kimseyi dışarıda tutmak için değil.

Test cihazı ve test hesapları kullanın. Sunucuyu gerçek veri tutan bir cihaza yöneltmeyin.
