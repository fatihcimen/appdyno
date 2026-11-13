# Akışlar

[English](flows.md)

Bir ajanın bir kez yaptığı, model olmadan, bu cihazda ya da bir başkasında ve CI'da yeniden çalışabilir.

```sh
appdyno flow start            # ya da flow aracı, action start: buradan sonraki her işlem kayda geçer
appdyno tap --json '{"selector":{"text":"Form"}}'
appdyno flow stop login.flow  # akışı kaydeder, bakılması gereken her adımla yazdırır
appdyno flow run login.flow --param PASSWORD_INPUT=... --from 3
appdyno test flows/ --tag smoke --env-file ci.env --retries 1 \
  --device emulator-5554 --device <udid> --artifacts out --junit out/junit.xml
appdyno flow export login.flow > login.yaml
```

Bir akış, her satırında bir adım olan bir metin dosyasıdır:

```text
app dev.appdyno.fixture
tag smoke login
param NAME
secret PASSWORD_INPUT

stop
launch
tap role=button text="Form"
type "${NAME}" id=name_input replace
type "${PASSWORD_INPUT}" id=password_input
tap id=submit
assert id=result check=text equals="Sent: ${NAME}"
tap id=add_button index=1 !ambiguous
```

| adım                                                                                                                               | çalıştırdığı                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `launch [app] [language=] [arg=] [env=]`, `stop [app]`                                                                             | `launch_app`, `arg=` ya da `env=` için `args` ya da `env` ile, `terminate_app` |
| `tap`, `long_press [durationMs=]`, `double_tap`                                                                                    | `tap`, `gesture`                                                               |
| `type "text" [target] [replace] [submit]`                                                                                          | `type_text`                                                                    |
| `press_key back [count=]`, `swipe up [target] [distance=] [durationMs=] [exact]`, `scroll_to <selector> [direction=] [maxSwipes=]` | o adı taşıyan araç                                                             |
| `wait_for <selector> [gone] [timeoutMs=]`                                                                                          | `wait_for`                                                                     |
| `assert <selector> [check=] [equals=] [expect=false] [timeoutMs=]`                                                                 | `assert`                                                                       |
| `open_link "url"` or `open_link settings=`, `set_location 41.0 29.0`, `alert allow`, `hide_keyboard`                               | kendi araçları                                                                 |
| `run shared/login.flow`                                                                                                            | o dosyanın adımları, yerinde                                                   |

Bir seçici `id=`, `role=`, `text=`, `index=` alanlarından herhangi biridir; metin, araçlarda olduğu gibi eşleşir. `launch` bir `language=`, her argüman için bir `arg=` ve her değişken için bir `env=NAME=value` alır; `launch_app` da `language`, `args` ve `env` alır.

Bir `#`, satırın sonuna kadar süren bir yorum başlatır. Bir adımın hedef aldığı yerde `tap`, `long_press`, `double_tap`, `type` ve `swipe`, `screen=` ve `!coordinates` ile birlikte `x= y=` de alır; bir kayıt bunu, yeri hiçbir şeyin adlandırmadığı yerde yazar. Bir `ref=` reddedilir, çünkü bir ref bir öğeyi yalnızca tek bir oturum için adlandırır. Üç işaret bakılması gereken bir adımı gösterir: `!ambiguous`, `!coordinates` ve `!running`; her biri [Kaydetmek](#kaydetmek) bölümünde açıklanır.

## Kaydetmek

Bir kayıt, başarılı olan her işlemi, o anda o ekranda hedefini tek başına bulan bir seçiciyle
yazar: id, yoksa rol ve metin, yoksa metin. Ref'ler dosyaya asla ulaşmaz. Hiçbir seçicinin tek başına
bulamadığı hedef index'ini korur ve `!ambiguous` olarak işaretlenir. Yalnızca hiçbir öğenin üstünde olmayan bir nokta, bir kaydırıcı ya da büyük bir
alan koordinat olarak kalır ve geçerli olduğu ekran boyutuyla `!coordinates` olarak işaretlenir; başka boyuttaki bir
ekran o adımı reddeder. Bir rol, iki platform onu aynı adla andığında korunur (`button`, `textField`...);
Android'in kendi id'leri (`android:id/button1`) korunmaz. Adımı olmayan bir işlem (bir pinch, bir cihaz ayarı, bir web görünümünde bir tıklama)
`unrecorded "..."` olarak yazılır; yeniden oynatma orada durur, böylece o işlem olmadan geçemez. Bir ölçüm yolculuk değil, ajanın ölçmesidir: ekrana yaptığı, aynısını yapan düz adımlar olarak kalır (`perf_launch` cold: `stop`, `launch`; `perf_scroll`: kaydırmaları) ve hiçbir yeniden oynatmayı durdurmaz. Uygulamayı başlatan bir `launch_app`, `stop`, `launch` olarak yazılır, böylece bir yeniden oynatma da onu yeniden başlatır; çalışan bir uygulamayı öne getiren biri `launch !running` olur, çünkü bir yeniden oynatma uygulamanın o an olduğu ekrandan devam eder. `language` ile bir `launch_app`, `launch language=tr` olur, böylece bir yeniden oynatma da uygulamayı o dilde başlatır; uygulamayı yeniden başlattığı için işaretlenmez. `restart`, `args` ya da `env` ile bir `launch_app` her platformda çalışan bir uygulamayı başlatmadan önce durdurur, bu yüzden uygulama çalışsa da çalışmasa da argümanları ve ortamıyla `stop`, `launch` olarak yazılır. `flow stop` ve
`flow save` bakılması gereken her adımı listeler.

Ajanın yazdığı ya da okuduğu bir değer, `flow start`, `stop` ya da `save` üzerinde `params` ile bir parametre olur (komut satırında `--param NAME=Grace`): yazıldığı ya da okunduğu her yerde, önce ya da sonra, `${NAME}` olur, `param NAME` olarak bildirilir ve `flow run` değerini `params` içinde alır. Hiçbir kaydedilmiş adımın tutmadığı bir ad `stop` ve `save`'de reddedilir. `file` ile `stop`, `save` gibi kaydeder; `save` son kaydı yeniden yazar. `save` dosyayı, `export` `to` gibi, sunucunun çalıştığı klasörün ya da durum klasörünün içine yazar: başka bir yerdeki bir yol ya da bir bağlantının onların dışına çıkardığı bir yol reddedilir; `overwrite` verilmedikçe var olan bir dosya da reddedilir. Yazdığı dosyayla yanıt verir.

## Gizli değerler

Bir parola alanına yazılan metin ve `APPDYNO_SECRETS` içindeki metin, adıyla bir `secret` olur:
alanın id'si ya da `APPDYNO_SECRETS`'in ilki için `SECRET_1`. O andan itibaren aynı metin başka her yerde,
örneğin onu geri gösteren bir etikette, o ad olur. Dosya hiçbir zaman bir değer tutmaz. Komutlar arasında saklanan
kayıt da tutmaz; o, tuzlanmış bir özet tutar. `param` ve `secret` değerleri önce
`--param`'dan (araçta `params`), sonra `--env-file`'dan (`envFile`; bir `.env` dosyasındaki gibi `NAME=value` satırları, onları depo dışında tutmak size kalır), sonra, komut satırında ve kütüphanede, o adı taşıyan ortam değişkeninden gelir; `$${`, düz bir `${` demektir. Bir sunucu kendi ortamından hiçbir şey almaz, çünkü o hiçbir akışın yazacağı şey değildir; bir çalıştırmanın bir ortam dosyasından aldığı her değeri de o andan sonra bir gizli değer gibi gizler. Bir gizli değer
bir yeniden oynatmanın yanıtlarından, raporundan ve kaydedilen ağacından gizlenir. Bir ekran görüntüsü ekranın gösterdiğini gösterir, bu yüzden
düz bir alana yazılmış bir gizli değer onda görülebilir.

## Yeniden oynatma

Bir yeniden oynatma her adımı, bir ajanın çağırdığı işlemin aynısıyla, onun durulmasıyla çalıştırır. Bir hedef dokunulmadan önce
300 ms boyunca yerinde durmalıdır, çünkü hâlâ kayan bir liste dokunuşu "dur" olarak alır. Bir hedefin gelmesi için
10 s, bir `assert`'ün tutması için 10 s vardır (`timeoutMs=` bunu değiştirir); sonra çalıştırma durur. İkinci bir deneme ya da yakın bir eşleşme bir tahmin olurdu. Bir hata `file:line`'ı, adım numarasını, en yakın adayları ve ekranı verir. Birden çok
eşleşme de reddedilir. Uygulamanın sırasında öldüğü bir adım, çökmenin nedeniyle başarısız olur. Bir akışın bütün satırları
ilk adım iş yapmadan önce denetlenir ve eksik bir değer, hiçbir şey çalışmadan önce adıyla reddedilir. Her adımın
işlemden durulmaya kadarki süresi yanıtta ve raporda yer alır: bir dokunuş ya da bir tuş için cihazın kendi süresi,
`launch`, `open_link` ve `scroll_to` için adımın tamamı.

## Akışları CI'da çalıştırmak

`appdyno test`, `.flow` dosyalarını ya da klasörlerini her `--device` üzerinde sırayla, birer birer çalıştırır.
JUnit yazar (cihaz başına bir suite, dosya başına bir case; varsayılan `appdyno-artifacts/junit.xml`), bir hatada `screen.jpg` ve
`tree.json` dosyalarını `<artifacts>/<device>/<file>/` altına kaydeder, sonraki dosyaya geçer ve herhangi biri
başarısız olduysa ya da çalıştırılacak bir şey yoksa 1 ile çıkar. Doğrulamalar birer adımdır.

## Etiketler

Adımlardan önce `tag smoke login`; `--tag smoke` adı verilen etiketlerden herhangi birini taşıyan dosyaları çalıştırır, `--exclude-tag slow` bunlardan herhangi birini taşıyanları dışarıda bırakır. Okunamayan bir dosya seçimde kalır ve başarısız olur, çünkü nasıl etiketlendiğini kimse bilemez. Hiçbir şey seçilmezse 1 ile çıkılır: hiçbir şey çalıştırmamış bir job geçmiş sayılmaz.

## Bir akışın bir başkasını çalıştırması

`run shared/login.flow` o dosyanın adımlarını kendi yerine koyar; yolu, onu anan dosyaya göre alınır. Adımlar ilk adım iş yapmadan önce okunur; böylece eksik bir dosya, bozuk bir satır ya da doğrudan ya da başka dosyalar üzerinden kendini çalıştıran bir dosya, döngü adıyla söylenerek reddedilir ve hiçbir şey çalışmaz. Bir ad hepsinde tek bir şey anlamına gelir, çünkü hepsi değerlerini tek bir yerden alır. Tek bir çalıştırmaya değer geçiremezsiniz ve bir dosyada gizli olan bir ad hepsinde gizlidir. Başka bir uygulamaya ait bir dosya reddedilir. Bir hata, bulunduğu dosyayı ve satırı adıyla söyler; adımlar `--from`, rapor ve bir yolculuğun türleri için çalıştıkça sayılır. Bir dışa aktarma adımları yerinde yazar. Bir etiket içinde bulunduğu dosyaya aittir.

## Yeniden denemeler

`--retries N`, bir adımda başarısız olan bir dosyayı ilk adımından başlayarak bütünüyle, kendi çalıştırmasında yeniden çalıştırır: bir çalıştırmanın içinde başarısız bir adım başarısız kalır. Bir yeniden denemede geçen dosya kararsızdır (flaky), geçmiş değildir. Satır `FLAKY login.flow: passed on attempt 2 of 3` der, çalıştırma çalıştırdığı her şeyin sayısıyla biter (`2 passed, 1 flaky, 0 failed`, yeşil bir çalıştırmada da) ve onu adıyla söyler, JUnit case'i her başarısız denemeyi `<flakyFailure>` olarak tutar ve suite'inde `flakes="1"` bulunur, her başarısız denemenin kanıtı da kalır, sonrakiler `attempt-<n>/` altında. Kararsız bir dosya 0 ile çıkar, yoksa yeniden deneme boşuna olurdu. Birinde durmak için `flakes`'i okuyun ya da `--retries`'ı kullanmayın. Her denemede başarısız olan bir dosya, denemeleri `<rerunFailure>` olarak taşır. Bir dosyanın hiç çalışmasını engelleyen şey (ayrıştırılamayan bir satır, eksik bir değer) yeniden çalıştırılmaz ve `--measure`, `--retries`'ı reddeder, çünkü kapı başarısız bir denemenin bıraktığını sonrakinin okuduğuyla karşılaştırırdı.

## Dışa aktarma

`flow export` Maestro YAML'ı yazar ya da karşılığı olmayan her adımı adıyla söyleyerek reddeder (bir `alert`, `replace`,
koordinatlar, id'si ya da metni olmayan bir rol). Bir metnin yanındaki rol dışarıda bırakılır, çünkü o biçimde rol yoktur ve YAML
bunu bir yorumda söyler. Oradaki bir metin bütün bir etiketle eşleşir, bizimki ise bir etiketin bir parçasını da kabul eder. İçe
aktarma yoktur.

Araç YAML ile yanıt verir; `to` (komut satırında `--to`) onu ayrıca bir `.yaml` dosyasına yazar, sunucunun çalıştığı klasörün ya da durum klasörünün içine, çünkü bir istemcinin bir dosya yazmanın başka yolu olmayabilir. Başka bir yerdeki bir yol ya da bir bağlantının onların dışına çıkardığı bir yol reddedilir; `overwrite` verilmedikçe var olan bir dosya da reddedilir.

## Ölçülen ve kapıyla denetlenen bir yolculuk

`appdyno test flows/login.flow --measure [--iterations 5]` ya da `iterations` ile `flow` `run`, bir akışı bir performans senaryosu olarak çalıştırır: ısınma olarak dışarıda bırakılan ilk çalıştırma, sonra her adım için bir süreyle ve cihazın bir anda okuduklarıyla her yineleme. Hepsi, adını dosyanın deposundaki yolundan alan bir senaryonun, `journey-flows-login`'in, saklanan tek bir çalıştırmasıdır; böylece iki klasördeki iki `smoke.flow` iki ayrı senaryo olur. Kapı her zamankidir:

```sh
appdyno test flows/login.flow --measure --device <id>       # üç kez, sonra:
appdyno perf baseline --app A --scenario journey-flows-login --last 3
appdyno test flows/login.flow --measure --device <id>
appdyno perf compare --app A --scenario journey-flows-login       # 1 ile çıkar, yavaşlayan adımı adıyla söyler
```

Bir adımın türü satırından gelir, `journey.04_tap_id_load.ms`; bir `${NAME}` yazıldığı gibi kalır, böylece bir değer türü değiştirmez, araya eklenen bir adım da kendisinden sonrakileri yeniden numaralar. Android'de bir adımın kareleri (p95, en kötü) ve belleği vardır, bir iPhone'da ise yalnızca süresi, çünkü belleğini okumak saniyeler süren bir kayıttır. Yanıt bunu söyler. İkisi de bir telefonda, bilinen bir maliyete karşı kanıtlandı; bir iOS simülatörü de, burada ve bir GitHub runner'ında, bir tane çalıştırdı; bir emülatör henüz çalıştırmadı. Her yinelemenin aynı biçimde başlaması için bir akışa `stop` ve `launch` ile başlayın. Başarısız olan bir yineleme çalıştırmayı bitirir: ondan önce geçenler saklanır ve dosyanın case'i başarısız olur. [Dashboard](../reference/perf.tr.md#dashboard) üzerinde bir yolculuk, adımlara bölünmüş tek bir çubuktur ve her adımın sayılarını içeren bir tablosu vardır.

Koddan, [kütüphanenin](../reference/library.tr.md) `replay(file, { onStep })` çağrısı her adımın işleminin etrafında `onStep`'i çağırır ve bekler:
hedefi ekrana geldiğinde `before`, ekran durulduğunda süresiyle `after`.
