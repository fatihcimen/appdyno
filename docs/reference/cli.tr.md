# Komut satırı

[English](cli.md)

Her araç aynı zamanda tirelerle yazılan bir komuttur:

```sh
appdyno devices
appdyno screen --device emulator-5554
appdyno wait-for --selector '{"text":"Done"}'
appdyno tap --help
appdyno --help
```

`action` alan bir araç onu ilk sözcük olarak alır: `appdyno record start`, `appdyno network stop`. Her araç komutu ayrıca argümanlarını JSON olarak vermek için `--json '{...}'`, bir görselin yazılacağı yer için `--out <file>` ve cihazı bu komut ile aynı klasörde çalışan sonraki komutlar için seçen `--device <serial>` alır. `appdyno <command> --help` bir komutun seçeneklerini listeler. Bir komut yanıtının metnini yazar; `appdyno screen --raw` ağacın öğelerini onun ardından, her biri bir JSON satırı olarak, kütüphanenin `data.nodes` alanının tuttuğu gibi yazar.

Çıkış kodu 0 işin yapıldığını, 1 çağrının reddedildiğini, 2 argümanların yanlış olduğunu gösterir. İleti, bir MCP yanıtındaki ipucunun aynısını taşır: örneğin `tap --text OK`'ye bir seçicinin sözcüklerinin nereye yazılacağı söylenir. Seçili cihaz ve bir diff'in karşılaştırıldığı son ekran, komutlar arasında durum klasöründe (`~/Library/Caches/appdyno`) her çalışma klasörü için bir tane olan küçük bir dosyada tutulur; böylece iki klasördeki iki terminal aynı cihazı paylaşmaz.

Veri kaybettiren bir komut önce kendi terminalinde sorar; hangileri olduğu [Araçlar](tools.tr.md#önce-kişiye-sorulanlar) sayfasındadır ve `--yes` soruyu yanıtlar. Terminal de `--yes` de yoksa komut reddedilir; `APPDYNO_ALLOW_DATA_LOSS` (sistemin güç denetimleri için `APPDYNO_ALLOW_POWER`) izin veriyorsa reddedilmez.

## Diğer komutlar

| komut                                                     | ne yapar                                                                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp`                                                     | MCP sunucusu: bkz. [Sunucu seçenekleri](#sunucu-seçenekleri)                                                                             |
| `install [--dry-run] [--yes] [--remove]`                  | appdyno'yu bu Mac'teki MCP istemcilerine ekler ya da çıkarır                                                                             |
| `update [--check]`                                        | önce doğrulayıp son sürüme geçer: bkz. [appdyno'yu güncel tutmak](../guides/clients.tr.md#appdynoyu-güncel-tutmak)                       |
| `doctor [--serial S]`                                     | bu Mac'te ve o cihazda neyin eksik olduğu ve nasıl düzeltileceği                                                                         |
| `devices`, `version`                                      | bağlı cihazlar; bunun hangi sürüm olduğu                                                                                                 |
| `hub`, `mirror`                                           | canlı pencere: bkz. [Pencere ve hub](mirror.tr.md)                                                                                       |
| `pair`                                                    | bu Mac'i Wi-Fi için bir telefonla bir kez eşleştirir                                                                                     |
| `ios build`                                               | iOS runner'larını ilk kullanımda değil, şimdi derler                                                                                     |
| `tools install`                                           | sabitlenmiş Perfetto trace processor'ı indirir                                                                                           |
| `tools install adb --accept-license`                      | `adb`'si olmayan bir Mac için Google'ın platform-tools paketini indirir ve Google'ın koşullarını kabul ettiğinizi söyler                 |
| `push setup apns\|fcm [--forget]`                         | bir push servisinin kimlik bilgilerini saklar: bkz. [Araçlar](tools.tr.md#apple-ve-google-üzerinden-bir-telefona-ve-bir-simülatöre-push) |
| `test`                                                    | akışları yeniden oynatır: bkz. [Akışlar](../guides/flows.tr.md)                                                                          |
| `timeline`, `flight`                                      | video, dokunuşlar, kareler, istekler, log ve bellek tek bir saatte, tek bir dosyada: bkz. [Kanıt](../guides/evidence.tr.md)              |
| `perf compare\|baseline\|budget\|why\|reference\|comment` | performans kapısı: bkz. [Performansı ölçmek](../guides/performance.tr.md)                                                                |
| `perf functions\|prune\|dashboard\|survey`                | saklanan profiller ve trace'ler, her ölçümün sayfası: bkz. [Performans](perf.tr.md)                                                      |
| `bench --serial S`                                        | bir Android cihazda okumaları, dokunuşları ve yazmayı ölçer                                                                              |
| `path [--remove]`                                         | Mac uygulamasından: `appdyno`'yu her kabuğun PATH'ine koyar ya da çıkarır                                                                |

## Sunucu seçenekleri

`appdyno mcp [flags]`. Seçeneklerin çoğunun bir ortam değişkeni de vardır; birkaç ayarın ise yalnızca değişkeni vardır.

| seçenek                     | ortam                               | ne                                                                                                                                                                        |
| --------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--device S`                | `APPDYNO_SERIAL`                    | adb seri numarası, simülatör kimliği ya da iPhone UDID'si                                                                                                                 |
| `--app A`                   | `APPDYNO_APP`                       | varsayılan uygulama (bundle ya da paket kimliği)                                                                                                                          |
| `--allow-devices RE`        | `APPDYNO_ALLOW_DEVICES`             | yalnızca seri numarası, UDID'si ya da adı eşleşen cihazlar; `simulator` boot ve shutdown ile `use_device` bir simülatörün ya da emülatörün adını ya da bir modeli de alır |
| `--allow-apps a,b`          | `APPDYNO_ALLOW_APPS`                | yalnızca bu uygulamalar: başka bir uygulamaya düşecek bir dokunuş, tuş ya da yazma ve birini açacak bir bağlantı reddedilir                                               |
| `--allow-urls RE`           | `APPDYNO_ALLOW_URLS`                | yalnızca eşleşen bağlantılar                                                                                                                                              |
| `--allow-data-loss V`       | `APPDYNO_ALLOW_DATA_LOSS`           | veri kaybettiren işlem hiçbir şey sorulmadan yapılır: simülatörlerde ve emülatörlerde `virtual`, her cihazda `all`                                                        |
| `--allow-power V`           | `APPDYNO_ALLOW_POWER`               | sistemin kendi güç, acil durum ya da silme denetimlerine bir girdi hiçbir şey sorulmadan yapılır: simülatörlerde ve emülatörlerde `virtual`, her cihazda `all`            |
| `--no-home`                 |                                     | uygulamadan çıkaran tuşları ve herhangi bir araçla Ayarlar'ı engeller; ana ekrana giden x,y ile bir dokunuşu yalnızca `--allow-apps` tutar                                |
| `--silent`                  | `APPDYNO_SILENT=1`                  | `hand_off` ses çalmaz ve macOS bildirimi göstermez, CI ve paylaşılan bir Mac için: bir pencere bandını sessiz gösterir                                                    |
| `--measurements dir`        |                                     | ölçümlerin saklandığı yer (varsayılan: durum klasöründeki `measurements`)                                                                                                 |
| `--takeover`                |                                     | Android'de UI otomasyonunu tutan başka bir aracı durdurur                                                                                                                 |
| `--no-install-consent`      | `APPDYNO_NO_INSTALL_CONSENT=1`      | `app install` telefondaki hiçbir soruya dokunmaz: hepsini bir kişi yanıtlar                                                                                               |
| `--accept-install-warnings` | `APPDYNO_ACCEPT_INSTALL_WARNINGS=1` | `app install` bir Play Protect uyarısını geçer, bunu her zaman söyler ve uyarıyı aktarır                                                                                  |
| `--share`                   | `APPDYNO_SHARE=1`                   | başka bir sürecin tuttuğu bir cihazı kullanır                                                                                                                             |
| `--animations V`            | `APPDYNO_ANIMATIONS`                | `off`, bir Android cihaz yönetildiği sürece animasyon ölçeklerini 0'a ayarlar                                                                                             |
| `--trace-limit-gb N`        | `APPDYNO_TRACE_LIMIT_GB`            | saklanan trace'lerin ve heap dump'ların kaplayabileceği yer, varsayılan 10; eskiler silinir, bir baseline'ın ya da yakın tarihli bir çalıştırmanın andıkları asla         |
| `--flight-seconds N`        | `APPDYNO_FLIGHT_SECONDS`            | uçuş kaydedicisinin ne kadarını tuttuğu, varsayılan 30 s, 20 ile 120 arası                                                                                                |
| `--full-urls`               | `APPDYNO_FULL_URLS=1`               | bir zaman çizelgesi bir isteğin, bir token'ın taşınabildiği sorgusunu da tutar; listelenen bir sır ve kimlik bilgisine benzeyen yine gizlenir                             |
| `--http 127.0.0.1:PORT`     |                                     | stdio değil, bu Mac'in loopback'inde Streamable HTTP: aşağıya bakın. Verilmedikçe kapalıdır ve hiçbir değişken onu açmaz                                                  |

CI için doğru değer `virtual`'dır. `all` gerçek telefonları da kapsar: `--allow-power all` ile bir telefonun kapatma, acil arama ya da silme ekranındaki bir dokunuş kimseye sorulmadan yapılır. `all` değerini yalnızca içinde ihtiyacınız olan hiçbir şey bulunmayan bir test telefonu için verin.

Yalnızca değişkeni olan ayarlar:

| ortam                         | ne                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APPDYNO_HTTP_TOKEN`          | `--http`'nin istediği token, 32 karakter ya da daha uzun: ayarlanmamışsa üretilir ve yazdırılır                                                                  |
| `APPDYNO_STATE_DIR`           | durum klasörü: varsayılan `~/Library/Caches/appdyno`                                                                                                             |
| `APPDYNO_TOOLS_DIR`           | indirilen araçların tutulduğu yer, durum klasörü ne olursa olsun: varsayılan `~/Library/Caches/appdyno/tools`                                                    |
| `APPDYNO_PERF_DIR`            | baseline'ların ve bütçelerin tutulduğu yer: varsayılan, çalışma klasöründeki `.appdyno/perf`; böylece commit edilebilirler                                       |
| `APPDYNO_TRACE_PROCESSOR`     | Android'in trace'lerini okumak için, uygulamanınkinin ve indirilen sabit olanın yerine bir `trace_processor_shell`                                               |
| `APPDYNO_SECRETS=a,b`         | hiçbir zaman geri gösterilmeyen ve panoya konmayan değerler                                                                                                      |
| `APPDYNO_FAST_TAP=0`          | iOS runner'ı XCTest'in olay sentezleyicisi yerine, yaklaşık iki kat uzun süren XCUI'nin kendi dokunuşuyla dokunur                                                |
| `APPDYNO_ANIMATION_WAIT=0`    | bir iOS dokunuşu uygulamanın animasyonlarının bitmesini beklemeden gider                                                                                         |
| `APPDYNO_HOST_VIRTUAL=0`      | bu Mac, macOS ne derse desin, sanal makine sayılmaz; load average'ı ne kadar meşgul olduğunu gerçekten söyleyen bir sanal Mac için: bkz. [Kapı](perf.tr.md#kapı) |
| `APPDYNO_IOS_TEAM`            | Xcode'un iPhone runner'ını hazırlarken kullandığı Apple ekibi: bkz. [Xcode halletsin](../guides/clients.tr.md#xcode-halletsin)                                   |
| `APPDYNO_IOS_PROFILE`         | iPhone runner'ı için bir provisioning profile; `APPDYNO_IOS_KEYCHAIN` ve `APPDYNO_IOS_KEYCHAIN_PASSWORD` ile birlikte                                            |
| `APPDYNO_EMULATOR_ARGS`       | `simulator` bir emülatör başlatırken verilen seçenekler: bkz. [Bir simülatör ya da emülatör başlatmak](tools.tr.md#bir-simülatör-ya-da-emülatör-başlatmak)       |
| `APPDYNO_ANDROID_AGENT`       | bu checkout'un build'i ya da paketinki yerine kurulacak bir Android ajanı `.apk` dosyası                                                                         |
| `APPDYNO_IOS_PRODUCTS`        | bu checkout'un build'i ya da ilk kullanımda yapılan yerine, bir simülatör için derlenmiş iOS runner'ını ve onun `.xctestrun` dosyasını tutan bir klasör          |
| `APPDYNO_IOS_DEVICE_PRODUCTS` | aynısı, bir telefon için                                                                                                                                         |

`--allow-devices` ve `--allow-urls` JavaScript düzenli ifadeleridir ve sabitlenmedikçe metnin herhangi bir yerinde eşleşir: `--allow-urls 'https://staging.example.com'`, `https://staging.example.com.evil.test/` ve `evilapp://x?u=https://staging.example.com` bağlantılarını da içeri alır. Onu sabitleyin: `--allow-urls '^https://staging\.example\.com/'` (`/` ana makine adını bitirir) ve `--allow-devices '^emulator-5554$'`; `'^emulator-'` her emülatörü içeri alır. Seçenekle ya da değişkenle boş verilen bir liste, her şeyi içeri alacağından başlangıçta reddedilir; biri tanımsızken `"$A|$B"`'nin verdiği gibi boş metinle eşleşen bir desen de öyle.

`--takeover` olmadan, Android'de UI otomasyonunu tutan ikinci bir araç asla durdurulmaz. Hata, onu tutanı pid'i ve komut satırıyla adlandırır ve onu durduracak komutun tam halini verir.

stdio üzerindeki sunucu, istemcisi stdin'i kapattığında ya da SIGTERM veya SIGINT ile biter ve oturumunun bir cihazda değiştirdikleri eski haline döner; [Araçlar](tools.tr.md) her birini anlatır. Bir istemci onu, bitmesini istedikten yarım saniye sonra öldürebilir; `claude -p` bunu SIGINT, 0,1 s sonra SIGTERM ve ardından SIGKILL ile yapar, oysa bir emülatörün yazı boyutunun eski haline dönmesi saniyeler sürer. Bu yüzden sunucu, bitişinde değiştirdiği her cihaz için kendi süreç grubundan ayrı olarak `appdyno mcp --put-back-after <pid> --device <serial>` (appdyno'nun kendi süreçleri arasındaki bir seçenek; elle yazılmaz) başlatır: bu süreç sunucunun gitmesini bekler, sonra onun orada bıraktığını her oturumun başlangıcının yaptığı gibi eski haline döndürür, bir Android cihazın ayarlarının diskine ulaşmasını bekler, stderr'e bir `putBackAfter` satırı yazar ve çıkar. İstemci çıktıktan hemen sonraki bir kontrol, değişmiş değeri 5 s kadar daha okuyabilir.

`--http`, bu Mac'te bir program başlatamayan bir istemci içindir. Loopback'te dinler ve başka her adresi reddeder; daha uzağa yalnızca sizin çalıştırdığınız bir tünel üzerinden ulaşır: arada bize ait bir servis yoktur. **Adresi ve token'ı bilen herkes cihazlarınızı kullanabilir** ve bir aracın yol aldığı yerlerde burada dosya okuyup yazar. Bir tane açmadan önce [Tarayıcıdaki istemciler](../guides/clients.tr.md#tarayıcıdaki-istemciler) bölümüne bakın.

Bir istek token ister: `/mcp` üzerinde `Authorization: Bearer <token>` olarak ya da başlık için alanı olmayan bir istemci için `/mcp/<token>` olarak; adresteki bir token tünelin loglarında görünür. Sunucununkinden başka bir `Origin` taşıyan istek 403 ile reddedilir. Her POST için bir sunucu vardır ve MCP oturumu yoktur, çünkü böyle bir istemci her araç çağrısı için bir oturum açıp bittiğini hiç söylemeyebilir. Bir istemci verdiği adla tanınır: bir araç çağırdıktan sonra, son çağrısından 10 dakika sonrasına kadar bir stdio oturumunun bağlamını tutar, o zaman koşulları eski haline döner; başka bir istemci de onu adıyla anan bir 409 ile reddedilir. Kopan bir bağlantı kendi çağrısını durdurur. Token'ı bir değişken ayarlar, hiçbir seçenek ayarlamaz, çünkü bir seçenek `ps` çıktısında görünürdü.
