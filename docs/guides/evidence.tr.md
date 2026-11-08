# Kanıt

[English](evidence.md)

Bir ajanın ne olduğunu göstermek için geride bırakabildikleri ve bunun bir uygulamanın içinde nasıl göründüğü.

## Video

`record`, `action` olarak `start` (`file`, `maxSeconds`, varsayılan 1.800) ve `stop` alır; cihaz başına bir kayıt. Kayıt,
onu başlatan süreçten uzun yaşar; bu yüzden `appdyno record start` ve `appdyno record stop` iki ayrı komut olarak çalışır. Bir oturumun
sonu, oturumun çalışır bıraktığı bir kaydı durdurur.

`stop` dosyayı okur; oynatılamayan bir dosya nedenini söyleyen bir rettir (bitmeden öldürülen bir kaydedici hiç
index bırakmaz). Yanıt süreyi, kareleri ve boyutu verir.

|           | nasıl                                                      | bilinmesi gerekenler                                                                                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android   | cihazda `screenrecord`, çalıştırma başına 3 dakika, 4 Mbps | çalıştırmalar, kareleri kopyalanarak, hiçbir bağımlılık olmadan tek bir videoda birleştirilir; her birleşme noktasında bir an kaybolur. Bir kodlayıcı değişikliğinin birleştirilemez yaptığı çalıştırmalar `name-1.mp4`, `name-2.mp4` olarak kalır ve yanıt bunu söyler |
| simülatör | `simctl io recordVideo --codec=h264`, bir QuickTime `.mov` | bir kare yalnızca ekran değiştiğinde yazılır, bu yüzden durgun bir ekran çok kısa bir video verir ve yanıt bunu söyler                                                                                                                                                  |
| iPhone    | kendi yayını, ikinci bir kodlama olmadan bir filme         | telefonun kendi boyutunda HEVC 4:4:4, bir anahtar kareden itibaren; yayını olmayan bir build `devicectl device capture screen-record` kullanır, bunu her telefon sunmaz                                                                                                 |

## Rapor

`report` `start` (`dir`) o andan itibaren her çağrıyı saklar: argümanlarını, yanıtını ve düz bir okuma olmayan her şeyden sonra
ekranı ve onun bir görüntüsünü. `stop` o klasöre, bu arada kaydedilen videoyla, uygulamanın loguyla, çökmeleriyle
ve alınan ölçümlerle birlikte `index.html` yazar. Bir oturumun sonu da yazar. `write` onu herhangi bir anda yazar; `start` olmadan ise ekranın
o anki halinin raporudur.

Sayfa hiçbir şey yüklemez: betiği yoktur ve içerik politikası yalnızca kendi klasörüne izin verir. Listelenen gizli değerler ve
kimlik bilgisine benzeyen her şey bütün metinlerde gizlenir. Yazılan metin ve bir şeyi adlandırdığı bilinmeyen her argüman uzunluğuyla gösterilir. Bir öğenin gizli bir değer tuttuğu ya da
parola alanı olduğu yerde görüntünün üstü boyanır; üstü boyanamıyorsa görüntü dışarıda bırakılır. Arkasında öğe olmadan çizilen metin ayırt edilemez ve bir videonun üstü boyanmaz.

## Dashboard

```sh
appdyno perf survey --app A [--device S]               # o cihazdaki her ölçüm sırayla, sonra sayfa
appdyno perf dashboard [--app A] [--out dir] [--open]  # yalnızca sayfa, saklananlardan
```

Bir uygulamanın bütün cihazlarınızdaki performansı tek sayfada: neyin ilgi beklediği, Play'in tanımlarına göre neyin sayılacağı (bir oturum, asla bir oran değil), cihaza göre her ölçüm (en yeni değeri; bir tahminse ya da gürültü altında alındıysa işaretli, ya da o cihazın onu neden okuyamadığı) ve her birinin baseline bandı ve bütçesiyle eğilimi. Bir emülatörün ya da simülatörün sayılarının bu Mac'e göre olduğunu ve gerçek kare hızlarının, donmuş karelerin, takılmaların ve enerjinin bir telefon gerektirdiğini, bir sayının farklı olduğu yerde ne anlama geldiğini (bir simülatörün kareleri ana thread'in temposudur, enerjisi bu Mac'inkidir) ve bir uygulama için hiçbir telefon ölçülmemişse bunun komutunu söyler. Sayfa `<measurements dir>/dashboard/index.html` dosyasıdır, saklanan her çalıştırmadan sonra yeniden yazılır ve açık bir sayfa kendini yeniden yükler. Sunucu yoktur: betiği olmayan, hiçbir şey yüklemeyen tek bir dosya. `action: dashboard` ile `perf_compare` de onu yazar. `perf_snapshot` `also: surface`, `gfxinfo`'nun hiç görmediği bir `SurfaceView`'un ya da bir oyunun karelerini Play'in yavaş oturumlarına karşı okur. `baselineProfile: true` ile `perf_launch`, bir Android release build'i için Baseline Profile'ının APK'da olup olmadığını, uygulanıp uygulanmadığını ve ne kazandırdığını, onunla ve onsuz soğuk açılışlarla söyler. Bkz. performans başvurusunda [Bir Baseline Profile](../reference/perf.tr.md#bir-baseline-profile). Bir Android uygulamasının pil sinyalleri (etikete göre wake lock'lar, uyanmalar, job'lar; güç modeli olmadan) `perf_snapshot` `also: battery`'den, Play'in değerlendirdiği haliyle belleği (süreç durumuna göre anon RSS ve swap, bitmap'ler) `also: anonMemory`'den, en son neden başladığı da Android 15'ten itibaren `also: startInfo`'dan gelir. Bkz. performans başvurusunda [Dashboard](../reference/perf.tr.md#dashboard). `perf_trace` yavaş karelerin ve donmaların neden yavaş olduğunu, `perf_compare` `action: functions` de iki profil arasında hangi fonksiyonların kaydığını söyler.

## Ağ

`network` `paths`, her yolun bu cihazda neyi gördüğünü, görmüyorsa nedenini söyler. `start` birini seçer, `read` ve `stop` sınırlı bir liste verir.

| yol       | nerede                                                                                                                                                                                                            | ne görür                                                                                                                 | gövdeler                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `proxy`   | Android: `settings put global http_proxy`, bu Mac'teki bir proxy için `adb reverse` üzerinden; `stop`'ta ya da oturumun sonunda eski haline döner. Simülatör: Mac'in proxy'sini izler ve bu araç bunu değiştirmez | sistem proxy'sini kullanan bir uygulamanın her HTTP isteği; HTTPS için, proxy'niz şifresini çözmedikçe yalnızca host     | yalnızca proxy'nin dışa aktarımında, yalnızca şifresini çözdüğü yerde |
| `probe`   | simülatör: uygulamaya enjekte edilen bir `NSURLProtocol`; uygulama yeniden başlar                                                                                                                                 | URLSession istekleri: method, URL, durum, süre, boyut. Arka plan oturumları, `WKWebView` ya da `Network.framework` değil | hayır                                                                 |
| `bytes`   | Android: `dumpsys netstats`                                                                                                                                                                                       | bir uygulamanın baytları ve paketleri; loopback değil                                                                    | hayır                                                                 |
| `packets` | Android 14+: Perfetto'nun `android.network_packets`'i                                                                                                                                                             | bir uygulamanın paketleri, uzak porta ve yöne göre, `stop`'ta okunur                                                     | hayır                                                                 |

Proxy sizin çalıştırdığınız bir proxy'dir. `read`, çalışan bir Proxyman'i kendi dışa aktarımıyla, herhangi bir proxy'yi de bir dosyadan listeler: `har`, Charles'tan (File,
Export Session) ya da mitmproxy'den (`--set hardump=file`). Bir liste, `start`'tan bu yana herhangi bir istemciden proxy'den geçeni tutar. Hiçbir
sertifika asla kurulmaz: HTTPS'i bir proxy üzerinden görmek için onun sertifikasını kendiniz kurun. Bir iPhone'da yalnızca `har` ile `read` vardır: proxy'si Wi-Fi ayarlarındadır.

## Web görünümleri

`webview`: `pages`, `elements` (erişilebilirlik ağacının okuyamadığı yeri okumak için dokunma koordinatlarındaki DOM), `click` (bir CSS
seçicisi), `eval` (bir betik). Android'de, hata ayıklanabilir bir uygulamanın `webview_devtools_remote_<pid>` soketiyle
`adb forward` üzerinden DevTools protokolünü konuşur. Simülatörde Safari'nin Web Inspector'ının kullandığı soketle konuşur; iOS 16.4'ten itibaren bir sayfa yalnızca uygulama
`isInspectable` ayarladıysa görünür. Bir iPhone'a bu yolla ulaşılmaz.

`screen`, bir web görünümünün gösterdiğini `web` olarak işaretler ve sayfanın tutup erişilebilirlik ağacının tutmadığını koordinatlar ve
seçiciyle ekler. Hata ayıklanabilir olmayan bir uygulama da web görünümünün erişilebilirliğe söylediğini yine gösterir.

## Flutter

Bir Flutter uygulamasının semantiği erişilebilirlik ağacındadır, bu yüzden `screen`, seçiciler ve dokunuşlar onda çalışır. Dart VM
servisinin daha zengin ağacı yapılmadı: bu aracın kuralı gönderdiğini test etmektir ve bunun yazıldığı Mac'te bir test uygulaması derleyecek Flutter SDK'sı yok.
`webview`'un yaptığı gibi olurdu: bir debug build'in logunda `Observatory` ya da `Dart VM service` satırını bulmak, portunu
yönlendirmek ve WebSocket'i üzerinden `ext.flutter.inspector.getRootWidgetSummaryTree` çağırmak.

## React Native

`react_native` bu Mac'teki Metro ile konuşur ve cihaz gerektirmez: `targets`, `logs` (Hermes çalışma zamanının DevTools
protokolü üzerinden JS konsolu, `ms` boyunca, gizli değerler gizlenmiş) ve `reload` (Metro'nun yolu, yoksa çalışma zamanınınki). Yalnızca Metro'nun yerine geçen bir taklide karşı test edildi, gerçek bir uygulamaya karşı değil. Dışarıda kalanlar:
bileşen ağacı ve JS profilleri. Android'de bir cihaz Metro'ya sizin kendi `adb reverse tcp:8081 tcp:8081` komutunuzla ulaşır.

## Görsel karşılaştırma

`visual` `baseline` ekranı `dir` altında `name` olarak kaydeder (varsayılan `./appdyno-baselines`, projenizle commit etmek için). `compare`,
`tolerance` aşılınca `CHECK_FAILED` ile reddeder (piksellerin yüzdesi, varsayılan 0,1; bir kanal 16'dan fazla farklıysa piksel sayılır) ve
`name.diff.png` (farklı olan kırmızı, maskeler mavi) ile `name.actual.png` yazar. `masks`, dokunma birimlerinde `x,y,w,h` ya da `text`, `id`, `role`'dür; durum çubuğu her zaman dışarıda bırakılır.
Bir baseline tek bir ekran boyutu için geçerlidir ve ret bunu söyler.
