# Komut satırı

[English](cli.md)

Her araç aynı zamanda tirelerle yazılan bir komuttur:

```sh
appdyno devices
appdyno screen --device emulator-5554
appdyno wait-for --text Done
appdyno tap --help
appdyno --help
```

`action` alan bir op onu ilk sözcüğü olarak alır: `appdyno record start`, `appdyno network stop`. Diğer komutlar: `mirror` (bkz. [pencere](mirror.tr.md)), `doctor [--serial S]`, `ios build`, `test` (bkz. [akışlar](../guides/flows.tr.md)), `tools install` (sabitlenmiş
Perfetto trace processor'ı indirir), `bench`, `push setup apns|fcm [--forget]` (bkz. [Araçlar](tools.tr.md#apple-ve-google-üzerinden-bir-telefona-ve-bir-simülatöre-push)). Çıkış kodu 1 çağrının reddedildiği, 2 argümanların yanlış olduğu anlamına gelir ve bir MCP yanıtının ipucuyla söylenir, `tap --text OK`'ye bir selector'ın sözlerinin nereye gittiğinin söylendiği gibi. CLI süreçleri
arasında seçili cihaz ve diff baseline'ı, durum klasöründe çalışma klasörü başına bir tane olan küçük bir dosyada
tutulur, böylece iki klasördeki iki terminal bir cihazı paylaşmaz. Veri kaybettiren bir komut önce kendi terminalinde sorar,
[Araçlar](tools.tr.md#önce-kişiye-sorulanlar) sayfasının listelediği gibi; yanıt `--yes`'tir, terminal ve `--yes` yoksa da
`APPDYNO_ALLOW_DATA_LOSS`, sistemin güç denetimlerine olanına da `APPDYNO_ALLOW_POWER` izin vermedikçe reddedilir.

## Sunucu seçenekleri

`appdyno mcp [flags]`. Her bayrağın bir ortam değişkeni vardır.

| bayrak                      | ortam                               | ne                                                                                                                                                                        |
| --------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--device S`                | `APPDYNO_SERIAL`                    | adb seri numarası, simülatör kimliği ya da iPhone UDID'si                                                                                                                 |
| `--app A`                   | `APPDYNO_APP`                       | varsayılan uygulama (bundle ya da paket kimliği)                                                                                                                          |
| `--allow-devices RE`        | `APPDYNO_ALLOW_DEVICES`             | yalnızca seri numarası, UDID'si ya da adı eşleşen cihazlar; `simulator` boot ve shutdown ile `use_device` bir simülatörün ya da emülatörün adını ya da bir modeli de alır |
| `--allow-apps a,b`          | `APPDYNO_ALLOW_APPS`                | yalnızca bu uygulamalar                                                                                                                                                   |
| `--allow-urls RE`           | `APPDYNO_ALLOW_URLS`                | yalnızca eşleşen bağlantılar                                                                                                                                              |
| `--allow-data-loss V`       | `APPDYNO_ALLOW_DATA_LOSS`           | veri kaybettiren işlem hiçbir şey sorulmadan yapılır: simülatörlerde ve emülatörlerde `virtual`, her cihazda `all`                                                        |
| `--allow-power V`           | `APPDYNO_ALLOW_POWER`               | sistemin kendi güç, acil durum ya da silme denetimlerine bir girdi hiçbir şey sorulmadan yapılır: simülatörlerde ve emülatörlerde `virtual`, her cihazda `all`            |
| `--no-home`                 |                                     | ana ekran tuşunu engeller                                                                                                                                                 |
| `--silent`                  | `APPDYNO_SILENT=1`                  | `hand_off` ses çalmaz ve macOS bildirimi göstermez, CI ve paylaşılan bir Mac için: bir pencere bandını sessiz gösterir                                                    |
| `--measurements dir`        |                                     | ölçümlerin saklandığı yer (varsayılan: durum klasörü)                                                                                                                     |
| `--takeover`                |                                     | Android'de UI otomasyonunu tutan başka bir aracı durdurur                                                                                                                 |
| `--no-install-consent`      | `APPDYNO_NO_INSTALL_CONSENT=1`      | `app install` telefondaki hiçbir soruya dokunmaz: hepsini bir kişi yanıtlar                                                                                               |
| `--accept-install-warnings` | `APPDYNO_ACCEPT_INSTALL_WARNINGS=1` | `app install` bir Play Protect uyarısını geçer, bunu her zaman söyler ve uyarıyı aktarır                                                                                  |
| `--share`                   | `APPDYNO_SHARE=1`                   | başka bir sürecin tuttuğu bir cihazı kullanır                                                                                                                             |
| `--animations V`            | `APPDYNO_ANIMATIONS`                | `off`, bir Android cihaz yönetildiği sürece animasyon ölçeklerini 0'a ayarlar                                                                                             |
| `--trace-limit-gb N`        | `APPDYNO_TRACE_LIMIT_GB`            | saklanan trace'lerin ve heap dump'ların kaplayabileceği yer, varsayılan 10; eskiler silinir, bir baseline'ın ya da yakın tarihli bir çalıştırmanın andıkları asla         |
| `--http 127.0.0.1:PORT`     |                                     | stdio değil, bu Mac'in loopback'inde Streamable HTTP: aşağıya bakın. Verilmedikçe kapalıdır ve hiçbir değişken onu açmaz                                                  |
|                             | `APPDYNO_HTTP_TOKEN`                | `--http`'nin istediği token, 32 karakter ya da daha uzun: ayarlanmamışsa üretilir ve yazdırılır                                                                           |
|                             | `APPDYNO_TOOLS_DIR`                 | indirilen araçların tutulduğu yer, durum klasörü ne olursa olsun: varsayılan `~/Library/Caches/appdyno/tools`                                                             |
|                             | `APPDYNO_TRACE_PROCESSOR`           | Android'in trace'lerini okumak için, uygulamanınkinin ve indirilen sabit olanın yerine bir `trace_processor_shell`                                                        |
|                             | `APPDYNO_SECRETS=a,b`               | hiçbir zaman geri gösterilmeyen ve panoya konmayan değerler                                                                                                               |

`--takeover` olmadan, Android'de UI otomasyonunu tutan ikinci bir araç asla durdurulmaz. Hata, onu tutanı
pid'i ve komut satırıyla adlandırır ve onu durduracak komutun tam halini verir.

stdio üzerindeki sunucu, istemcisi stdin'i kapattığında ya da SIGTERM veya SIGINT ile biter ve oturumunun bir cihazda değiştirdiği geri gider; [Araçlar](tools.tr.md) her birini anlatır. Bir istemci onu, bitmesini istedikten yarım saniye sonra öldürebilir; `claude -p` bunu SIGINT, 0,1 sn sonra SIGTERM ve ardından SIGKILL ile yapar, oysa bir emülatörün metin boyutunun geri gitmesi saniyeler sürer. Bu yüzden sunucu, bitişinde değiştirdiği her cihaz için kendi süreç grubundan ayrı olarak `appdyno mcp --put-back-after <pid> --device <serial>` başlatır: bu süreç sunucunun gitmesini bekler, sonra onun orada bıraktığını her oturumun başlangıcının yaptığı gibi geri koyar, bir Android cihazın ayarlarının diskine ulaşmasını bekler, stderr'e bir `putBackAfter` satırı yazar ve çıkar. İstemci çıktıktan hemen sonraki bir kontrol, değişmiş değeri 5 sn kadar daha okuyabilir.

`--http`, bu Mac'te bir program başlatamayan bir istemci içindir. Loopback'te dinler ve başka her adresi reddeder; daha uzağa yalnızca sizin çalıştırdığınız bir tünel üzerinden ulaşır: arada bize ait bir servis yoktur. **Adresi ve token'ı bilen herkes cihazlarınızı yönetir** ve bir aracın yol aldığı yerlerde burada dosya okuyup yazar. Bir tane açmadan önce [Tarayıcıdaki istemciler](../guides/clients.tr.md#tarayıcıdaki-istemciler) bölümüne bakın.

Bir istek token ister: `/mcp` üzerinde `Authorization: Bearer <token>` olarak ya da başlık için alanı olmayan bir istemci için `/mcp/<token>` olarak; adresteki bir token tünelin loglarında görünür. Sunucununkinden başka bir `Origin` taşıyan istek 403 ile reddedilir. Her POST için bir sunucu vardır ve MCP oturumu yoktur, çünkü böyle bir istemci her araç çağrısı için bir oturum açıp bittiğini hiç söylemeyebilir. Bir istemci verdiği adla tanınır: bir araç çağırdıktan sonra, son çağrısından 10 dakika sonrasına kadar bir stdio oturumunun bağlamını tutar, o zaman koşulları eski haline döner; başka bir istemci de onu adıyla anan bir 409 ile reddedilir. Kopan bir bağlantı kendi çağrısını durdurur. Token'ı bir değişken ayarlar, hiçbir bayrak ayarlamaz, çünkü bir bayrak `ps` çıktısında görünürdü.
