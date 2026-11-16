# Akışlar

[English](flows.md)

Bir ajanın bir kez yaptığı, model olmadan, bu cihazda ya da bir başkasında ve CI'da yeniden çalışabilir.

```sh
appdyno run-flow record           # ya da run_flow aracı, action record: buradan sonraki her işlem kayda geçer
appdyno tap-screen --json '{"selector":{"text":"Form"}}'
appdyno run-flow stop login.flow  # akışı kaydeder, bakılması gereken her adımla yazdırır
appdyno run-flow run login.flow --param PASSWORD_INPUT=... --from 3
appdyno test flows/ --tag smoke --env-file ci.env --retries 1 \
  --device emulator-5554 --device <udid> --artifacts out --junit out/junit.xml
appdyno run-flow export login.flow > login.yaml
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

| adım                                                                                                                               | çalıştırdığı                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `launch [app] [language=] [arg=] [env=] [probe]`, `stop [app] [background]`                                                        | `launch_app`, `arg=` ya da `env=` için `args` ya da `env` ile, `manage_app stop` |
| `tap`, `long_press [durationMs=]`, `double_tap`                                                                                    | `tap_screen`, `holdMs` ya da `count: 2` ile                                      |
| `type "text" [target] [replace] [submit]`                                                                                          | `type_text`                                                                      |
| `press_key back [count=]`, `swipe up [target] [distance=] [durationMs=] [exact]`, `scroll_to <selector> [direction=] [maxSwipes=]` | `press_key`, `swipe_screen`, `scroll_to` için `until` ile                        |
| `wait_for <selector> [gone] [timeoutMs=]`                                                                                          | `check_element` with `timeoutMs`                                                 |
| `assert <selector> [check=] [equals=] [expect=false] [timeoutMs=]`                                                                 | `check_element`                                                                  |
| `open_link "url"` or `open_link settings=`, `set_location 41.0 29.0`, `alert allow`, `hide_keyboard`                               | `open_link`, `set_device`, `answer_alert`, `press_key`                           |
| `screenshot home`, `visual home [tolerance=] [mask=]...`                                                                           | `file` ile `take_screenshot`, `check_screen`                                     |
| `setting dark_mode on [app=]`, `setting shake`, `setting restore`                                                                  | `set_device`                                                                     |
| `mock api.example.com/items* status=503 [body=] [fail=] [to=] [delayMs=]`                                                          | `mock` ile `capture_network`                                                     |
| `request "/v1/profile" [method=] [status=] [has=] [timeoutMs=]`                                                                    | `check` ile `capture_network`                                                    |
| `network strict`, `network strict off`                                                                                             | `strict` ile `capture_network`                                                   |
| `run shared/login.flow`                                                                                                            | o dosyanın adımları, yerinde                                                     |

Bir seçici `id=`, `role=`, `text=`, `index=` alanlarından herhangi biridir; metin, araçlarda olduğu gibi eşleşir. `launch` bir `language=`, her argüman için bir `arg=`, her değişken için bir `env=NAME=value` ve `probe` alır; `launch_app` da `language`, `args`, `env` ve `probe` alır. `stop background` uygulamayı sistemin arka plandaki bir uygulamayı sonlandırdığı gibi sonlandırır; `background` ile `manage_app stop` da öyle yapar.

Bir `#`, satırın sonuna kadar süren bir yorum başlatır. Bir adımın hedef aldığı yerde `tap`, `long_press`, `double_tap`, `type` ve `swipe`, `screen=` ve `!coordinates` ile birlikte `x= y=` de alır; bir kayıt bunu, yeri hiçbir şeyin adlandırmadığı yerde yazar. Bir `ref=` reddedilir, çünkü bir ref bir öğeyi yalnızca tek bir oturum için adlandırır. Üç işaret bakılması gereken bir adımı gösterir: `!ambiguous`, `!coordinates` ve `!running`; her biri [Kaydetmek](#kaydetmek) bölümünde açıklanır.

## Kaydetmek

Bir kayıt, başarılı olan her işlemi, o anda o ekranda hedefini tek başına bulan bir seçiciyle
yazar: id, yoksa rol ve metin, yoksa metin. Bir kontrol ile içindeki kendi metni orada tek hedeftir,
bir dokunuş için olduğu gibi. Ref'ler dosyaya asla ulaşmaz. Hiçbir seçicinin tek başına
bulamadığı hedef index'ini korur ve `!ambiguous` olarak işaretlenir. Yalnızca hiçbir öğenin üstünde olmayan bir nokta, bir kaydırıcı ya da büyük bir
alan koordinat olarak kalır ve geçerli olduğu ekran boyutuyla `!coordinates` olarak işaretlenir; başka boyuttaki bir
ekran o adımı reddeder. Bir rol, iki platform onu aynı adla andığında korunur (`button`, `textField`...);
Android'in kendi id'leri (`android:id/button1`) korunmaz. Adımı olmayan bir işlem (bir pinch, bir web görünümünde bir tıklama)
`unrecorded "..."` olarak yazılır; yeniden oynatma orada durur, böylece o işlem olmadan geçemez. İşlemin kendi yanıtı bunu hemen, `not recorded:` ile başlayan bir satırda söyler; yerine kaydedilen bir işlem varsa onu da: düz bir sürükleme için `direction` ile `swipe_screen`, panoya konan bir metin için `type_text`, bir web görünümündeki tıklama için `tap_screen`. Kural koyan bir `capture_network` `mock`, her kural için bir `mock` satırı olur; bir şeyi değiştiren öteki eylemleri ise kaydedilmez. Bir değerle verilen bir `set_device`, `setting` olur, değere gerek duymayan `shake` ve `memory_warning` de öyle, `restore`'u da `setting restore`; `background` ile bir `manage_app stop`, `stop background` olur; bir `check_screen` `visual`, toleransı ve maskeleriyle `visual` olur ve bir yeniden oynatma onu akışın kendi temel görüntüleriyle karşılaştırır, bu yüzden akışı bir kez `--update-baselines` ile çalıştırın; bir dosyaya kaydedilen bir `take_screenshot`, dosyanın adıyla `screenshot` olur. Bir ölçüm yolculuk değil, ajanın ölçmesidir: ekrana yaptığı, aynısını yapan düz adımlar olarak kalır (`measure_performance launch` cold: `stop`, `launch`; `measure_performance scroll`: kaydırmaları) ve hiçbir yeniden oynatmayı durdurmaz. Uygulamayı başlatan bir `launch_app`, `stop`, `launch` olarak yazılır, böylece bir yeniden oynatma da onu yeniden başlatır; çalışan bir uygulamayı öne getiren biri `launch !running` olur, çünkü bir yeniden oynatma uygulamanın o an olduğu ekrandan devam eder. `language` ile bir `launch_app`, `launch language=tr` olur, böylece bir yeniden oynatma da uygulamayı o dilde başlatır; uygulamayı yeniden başlattığı için işaretlenmez. `restart`, `args` ya da `env` ile bir `launch_app` her platformda çalışan bir uygulamayı başlatmadan önce durdurur, bu yüzden uygulama çalışsa da çalışmasa da argümanları ve ortamıyla `stop`, `launch` olarak yazılır. `probe` ile bir `launch_app`, `launch probe` olur; probe uygulamayı yeniden başlattıysa önünde bir `stop` ile. `run_flow stop` ve
`run_flow save` bakılması gereken her adımı listeler.

Ajanın yazdığı ya da okuduğu bir değer, `run_flow record`, `stop` ya da `save` üzerinde `params` ile bir parametre olur (komut satırında `--param NAME=Grace`): yazıldığı ya da okunduğu her yerde, önce ya da sonra, `${NAME}` olur, `param NAME` olarak bildirilir ve `run_flow run` değerini `params` içinde alır. Hiçbir kaydedilmiş adımın tutmadığı bir ad `stop` ve `save`'de reddedilir. `file` ile `stop`, `save` gibi kaydeder; `save` son kaydı yeniden yazar. `save` dosyayı, `export` `to` gibi, sunucunun çalıştığı klasörün ya da durum klasörünün içine yazar: başka bir yerdeki bir yol ya da bir bağlantının onların dışına çıkardığı bir yol reddedilir; `overwrite` verilmedikçe var olan bir dosya da reddedilir. Yazdığı dosyayla yanıt verir.

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

## Sahte yanıt kuralları

`mock`, bir simülatörde uygulamanın istekleri için bir kural koyar; `mock` ile `capture_network` de öyle yapar ve `mock` sözcüğünden sonraki satır, o aracın aldığı biçimiyle kuralın kendisidir:

```
mock api.example.com/v1/items* status=200 body=@items.json
mock api.example.com/v1/pay method=POST fail=timeout
mock "*.example.com" regex="/v\\d+/profile" query="lang=tr" status=404 body="{}" header="X-Test: 1"
mock cdn.example.com to=http://127.0.0.1:8080 delayMs=300
launch
```

İlk sözcük istektir: bir ana makine ve ardından bir yol; `*` herhangi bir karakter dizisidir, tek başına `*` ise her istektir. `regex=` yolun yerine, yolun tamamı için bir kalıptır; `method=` tek bir yöntemdir; `query=` ise isteğin sorgusunda bulunması gereken çiftlerdir. `has=` isteğin gövdesinde bulunması gerekendir: gövde JSON ise yoluyla verilen bir değer (`has=operationName=Cart`, `has=variables.items[0].id=7`) ya da gövdenin herhangi bir metni; `when="Name: value"` ise isteğin taşıdığı bir başlıktır, değerinde `*` olabilir. İkisi de birden çok kez verilebilir ve hepsinin tutması gerekir. Böylece tek bir GraphQL adresi her işlemi ayrı yanıtlar: `mock api.example.com/graphql has=operationName=Cart body=@cart.json`. Akış olarak gönderilen bir gövde `has=` için yalnızca 64 kB'ye kadar okunur. Ardından kuralın ne yaptığı gelir, üçünden biri: kendi yanıtı (`status=`, verilmezse 200; `type=`; her başlık için bir `header=`; ve `body=`, burada `body=@file` akışın yanındaki, çalıştırmanın başladığı klasörün içindeki bir dosyadır); `fail=offline`, `timeout` ya da `reset`; ya da isteğin gönderileceği başka bir ana makine olan `to=`. Bu ana makine bu Mac'te ya da onun kendi ağında olmalıdır (`127.0.0.1`, `10.…`, `192.168.…`, `name.local`), çünkü istek oraya çerezleri ve belirteçleriyle gider; başka bir ana makine için sunucunun onu adlandıran `--allow-urls` ile başlatılması gerekir. Yalın bir `to=localhost:8080`, `http://127.0.0.1:8080` demektir: yerel bir sunucu nadiren TLS konuşur ve bir uygulamanın bir adrese gitmesine izin verilirken bir ad reddedilebilir. `delayMs=` bunlardan önce, tek başına verilirse gerçek istekten önce bekler; `times=` bir kuralın tükenmesini sağlar, `off` ise onu etkisiz tutar. Bir isteği alan ilk kural geçerlidir.

İki kalıp sık kullanılır. Bir kez başarısız olup sonra çalışan bir istek, yani bir yeniden denemenin atlatması gereken durum, tükenen tek bir kuraldır: `mock api.example.com/v1/pay fail=timeout times=1`. Bu Mac'ten hiçbir şeyin çıkmadığı bir çalıştırma bunu bir kez söyler: `mock unmatched=fail`, hiçbir kuralın almadığı her isteği ağ yokmuş gibi başarısız kılar ve liste bunların her birini `[failed: no rule took it]` diye işaretler.

Bir çalıştırma, kaydedilmiş olanı yeniden oynatabilir. `save` ile `network` `read`, bir yakalamanın yanıtlarını bir HAR dosyası olarak saklar; `mock from=checkout.har` ise içindeki her yanıttan bir kural yapar ve dosya akışın klasöründen bulunur: iki kez yapılan istek son yanıtlandığı gibi yanıtlanır, birkaç sorguyla yapılan isteğin her sorgusu için bir kuralı olur ve gövdeler `appdyno-network/checkout/` klasörüne yazılır; bu klasör de HAR gibi git'in dışında tutulmalıdır. Böylece `mock from=checkout.har unmatched=fail` bir akışı sunucu olmadan çalıştırır ve uygulamanın kayıtta olmayan bir şey istediği gün akışı başarısız kılar. Bu aracın kaydettiği bir HAR'da kimlik bilgisi adı taşıyanlar gizlidir (`•••`) ve ondan yapılan kural da bununla yanıt verir: çalışan bir belirteç döndürmesi gereken bir girişin kendi kuralı olmalıdır. Aynı anda en çok 50 kural geçerli olur.

Kurallar uygulamaya ağ sondasıyla girer; bu yüzden ilk `mock`, çalışan bir yakalama yoksa sondayla bir yakalama başlatır ve bu, uygulamayı yeniden başlatır: `mock` satırlarını `launch` satırından önce yazın. Bir kural, dosyası çalışıp bitene kadar, başarıda da hatada da geçerlidir; sonra yalnızca o kural kaldırılır: çalıştırmadan önce bir ajanın ya da Mac uygulamasının koyduğu kural kalır. Yakalama, `capture_network` `stop` çağrısına ya da oturumun sonuna kadar sürer. Yalnızca uygulamanın kendi URLSession istekleri alınır: bir web görünümününkiler ya da arka plan oturumununkiler alınmaz ve sistem Mac'in ağını olduğu gibi okumayı sürdürür. Bir Android cihazı ve bir iPhone bu adımı reddeder.

## Başarısız olan istekler

Bir simülatörde ağ sondasıyla bir yakalama çalışırken, altında uygulamanın bir isteği başarısız olan adım bunu uyarıları arasında, her istek için bir satırla söyler: `network: POST api.example.com/v1/pay 500 (id 44)`. Sunucunun reddettiği (4xx, 5xx) ya da yolda başarısız olan istek sayılır; uygulamanın kendi vazgeçtiği istek sayılmaz.

`network strict` bunu bir hataya çevirir: o satırdan sonra, bir istek 5xx aldığında ya da yolda başarısız olduğunda ve bunu bir kural yapmadıysa adım başarısız olur; böylece ekranda geçen ama arkasındaki bir çağrısı bozulan akış geçmez. 4xx yanıtları ile bir `mock` kuralının verdiği yanıtlar ve hatalar uyarı olarak kalır. `network strict off` bunu bitirir, dosyanın sonu da öyle. Çalışan bir yakalama yoksa sondayla bir yakalama başlatır ve bu, uygulamayı yeniden başlatır; bu yüzden onu `launch` satırından önce yazın. Bir isteğe, altında gerçekleştiği adım bittiğinde bakılır: daha sonra başarısız olan istek bir sonraki adımı başarısız kılar ve ondan önce geldiğini söyler.

`request`, uygulama uyan bir istek yaptıysa geçer; henüz gelmemiş bir isteği de bekler, `timeoutMs=` başka bir süre vermedikçe 10 sn: `request "/v1/profile" method=PUT status=2xx has="name=Grace"`. İlk sözcük adresin bir parçasıdır; `status=` tek bir durum kodu, bir kod sınıfı (`2xx`) ya da `failed` olur; `has=` isteğin gövdesinde bulunması gerekendir: JSON bir gövdede yoluyla verilen bir değer (`user.name=Grace`, `items[0].id=7`) ya da gövdenin herhangi bir metni; `has="response: ok=true"` ise aynısını yanıtın gövdesi için sorar. `has=`, gövdeleri saklayan bir yakalama ister (`bodies` ile `network` `start`). Yalnızca çalıştırma başladıktan sonraki istekler sayılır; böylece ondan önceki bir istek adımı geçiremez. Bulunamadığında, en yakın isteği ve onun neyinin farklı olduğunu söyler: `nearest: PUT api.example.com/v1/profile 409 (id 52): 409, not 2xx`.

## Ekran görüntüleri, görsel denetimler ve ayarlar

`screenshot home` ekranı `home.png` olarak kaydeder: `appdyno test` içinde `<artifacts>/<device>/<file>/` altına, bir hatanın bıraktıklarının yanına, `run_flow run` içinde ise `./appdyno-screenshots/` altına. Yeniden bir çalıştırma onu yeniden çeker.

`visual home` ekranı, akış dosyasının klasöründeki `baselines/home.png` ile `check_screen` `visual`'ın yaptığı gibi karşılaştırır; başka bir akışın çalıştırdığı bir dosyanın adımı o dosyanın klasörüne bakar. `tolerance=` farklı olabilecek piksellerin yüzdesidir, verilmezse `0.1`; her `mask=` bir parçayı dışarıda bırakır: dokunma birimlerinde `x,y,w,h` ya da `mask="id=clock"` gibi seçici sözcükleri. Durum çubuğu her zaman dışarıda bırakılır. Bir `screenshot` ya da `visual` adımı önce ekranın 500 ms boyunca aynı görünmesini bekler, en çok 5 s; yoksa karanlık moda geçişin solması resimde olurdu. Toleransın ötesinde farklı olan bir ekran adımı başarısız kılar; hata, farklı olanın kırmızı olduğu diff görüntüsünü ve okuduğu ekranı adıyla söyler. `--update-baselines` ile `appdyno test` ya da `appdyno run-flow run`, karşılaştırmak yerine her temel görüntüyü kaydeder. Bir `visual` adımı, `!ambiguous` işaretli ve bir `tap` gibi işlem yapan (bir `assert` ya da `wait_for` yapmaz) bir adımdan sonra gelen akışın hiçbir temel görüntüsünü kaydetmez: o adım o çalıştırmada başka bir öğeye ulaşabilir, bu yüzden akış ilk adımından önce, iki satırı da söyleyerek reddedilir. Temel görüntüsü eksik olan bir akış, ilk adımından önce, bunu söyleyerek reddedilir. Bir temel görüntü tek bir ekran boyutunundur: başka boyutta bir cihazda adım, iki boyutu da söyleyerek başarısız olur; birkaç `--device` üzerinde `--update-baselines` sonuncununkini tutar.

`setting dark_mode on` bir cihaz ayarını `set_device` gibi, onun adları ve değerleriyle değiştirir: `setting text_size accessibility-large`, `setting locale tr-TR app=org.example`, `setting biometric match`, `setting sms "Your code is 1234" title=5551234`; değersiz olarak da `setting shake` ve değeri olarak Android'in trim düzeyini alan `setting memory_warning`. `setting restore` değiştirilen her birini geri koyar. `appdyno test` her dosyanın değiştirdiğini, bir ayarı, sabitlenmiş bir konumu ya da döndürme kilidini, dosya çalıştıktan sonra, her yeniden denemesinden sonra da geri koyar; böylece bir dosyanın karanlık modu bir sonrakine geçmez. Ölçülen bir dosya yinelemelerinden sonra geri koyar, aralarında değil. Çalıştırmadan önce değiştirilmiş olan olduğu gibi bırakılır. Bir `setting media` adımının eklediği fotoğraflar ve videolar da, cihaz onları çıkarabiliyorsa (bir Android cihaz ya da emülatör) aynı şekilde çıkarılır; bir simülatörün Fotoğraflar'ında silme yoktur, orada kalırlar.

## Etiketler

Adımlardan önce `tag smoke login`; `--tag smoke` adı verilen etiketlerden herhangi birini taşıyan dosyaları çalıştırır, `--exclude-tag slow` bunlardan herhangi birini taşıyanları dışarıda bırakır. Okunamayan bir dosya seçimde kalır ve başarısız olur, çünkü nasıl etiketlendiğini kimse bilemez. Hiçbir şey seçilmezse 1 ile çıkılır: hiçbir şey çalıştırmamış bir job geçmiş sayılmaz.

## Bir akışın bir başkasını çalıştırması

`run shared/login.flow` o dosyanın adımlarını kendi yerine koyar; yolu, onu anan dosyaya göre alınır. Adımlar ilk adım iş yapmadan önce okunur; böylece eksik bir dosya, bozuk bir satır ya da doğrudan ya da başka dosyalar üzerinden kendini çalıştıran bir dosya, döngü adıyla söylenerek reddedilir ve hiçbir şey çalışmaz. Bir ad hepsinde tek bir şey anlamına gelir, çünkü hepsi değerlerini tek bir yerden alır. Tek bir çalıştırmaya değer geçiremezsiniz ve bir dosyada gizli olan bir ad hepsinde gizlidir. Başka bir uygulamaya ait bir dosya reddedilir. Bir hata, bulunduğu dosyayı ve satırı adıyla söyler; adımlar `--from`, rapor ve bir yolculuğun türleri için çalıştıkça sayılır. Bir dışa aktarma adımları yerinde yazar. Bir etiket içinde bulunduğu dosyaya aittir.

## Yeniden denemeler

`--retries N`, bir adımda başarısız olan bir dosyayı ilk adımından başlayarak bütünüyle, kendi çalıştırmasında yeniden çalıştırır: bir çalıştırmanın içinde başarısız bir adım başarısız kalır. Bir yeniden denemede geçen dosya kararsızdır (flaky), geçmiş değildir. Satır `FLAKY login.flow: passed on attempt 2 of 3` der, çalıştırma çalıştırdığı her şeyin sayısıyla biter (`2 passed, 1 flaky, 0 failed`, yeşil bir çalıştırmada da) ve onu adıyla söyler, JUnit case'i her başarısız denemeyi `<flakyFailure>` olarak tutar ve suite'inde `flakes="1"` bulunur, her başarısız denemenin kanıtı da kalır, sonrakiler `attempt-<n>/` altında. Kararsız bir dosya 0 ile çıkar, yoksa yeniden deneme boşuna olurdu. Birinde durmak için `--fail-on-flaky` ekleyin: çalıştırma o zaman 1 ile çıkar ve son satırı her birini adıyla söyler, `failed by --fail-on-flaky: flaky, passed only on a retry: emulator-5554/login.flow` gibi; ya da `flakes`'i okuyun, ya da `--retries`'ı kullanmayın. Her denemede başarısız olan bir dosya, denemeleri `<rerunFailure>` olarak taşır. Bir dosyanın hiç çalışmasını engelleyen şey (ayrıştırılamayan bir satır, eksik bir değer) yeniden çalıştırılmaz ve `--measure`, `--retries`'ı reddeder, çünkü kapı başarısız bir denemenin bıraktığını sonrakinin okuduğuyla karşılaştırırdı.

## Dışa aktarma

`run_flow export` Maestro YAML'ı yazar ya da karşılığı olmayan her adımı adıyla söyleyerek reddeder (bir `alert`, bir `visual`, bir `setting`, `replace`,
koordinatlar, id'si ya da metni olmayan bir rol); bir `screenshot`, `takeScreenshot` olur. Bir metnin yanındaki rol dışarıda bırakılır, çünkü o biçimde rol yoktur ve YAML
bunu bir yorumda söyler. Oradaki bir metin bütün bir etiketle eşleşir, bizimki ise bir etiketin bir parçasını da kabul eder. İçe
aktarma yoktur.

Araç YAML ile yanıt verir; `to` (komut satırında `--to`) onu ayrıca bir `.yaml` dosyasına yazar, sunucunun çalıştığı klasörün ya da durum klasörünün içine, çünkü bir istemcinin bir dosya yazmanın başka yolu olmayabilir. Başka bir yerdeki bir yol ya da bir bağlantının onların dışına çıkardığı bir yol reddedilir; `overwrite` verilmedikçe var olan bir dosya da reddedilir.

## Ölçülen ve kapıyla denetlenen bir yolculuk

`appdyno test flows/login.flow --measure [--iterations 5]` ya da `iterations` ile `run_flow` `run`, bir akışı bir performans senaryosu olarak çalıştırır: ısınma olarak dışarıda bırakılan ilk çalıştırma, sonra her adım için bir süreyle ve cihazın bir anda okuduklarıyla her yineleme. Hepsi, adını dosyanın deposundaki yolundan alan bir senaryonun, `journey-flows-login`'in, saklanan tek bir çalıştırmasıdır; böylece iki klasördeki iki `smoke.flow` iki ayrı senaryo olur. Kapı her zamankidir:

```sh
appdyno test flows/login.flow --measure --device <id>       # üç kez, sonra:
appdyno perf baseline --app A --scenario journey-flows-login --last 3
appdyno test flows/login.flow --measure --device <id>
appdyno perf compare --app A --scenario journey-flows-login       # 1 ile çıkar, yavaşlayan adımı adıyla söyler
```

Bir adımın türü satırından gelir, `journey.04_tap_id_load.ms`; bir `${NAME}` yazıldığı gibi kalır, böylece bir değer türü değiştirmez, araya eklenen bir adım da kendisinden sonrakileri yeniden numaralar. Android'de bir adımın kareleri (p95, en kötü) ve belleği vardır, bir iPhone'da ise yalnızca süresi, çünkü belleğini okumak saniyeler süren bir kayıttır. Yanıt bunu söyler. İkisi de bir telefonda, bilinen bir maliyete karşı kanıtlandı; bir iOS simülatörü de, burada ve bir GitHub runner'ında, bir tane çalıştırdı; bir emülatör henüz çalıştırmadı. Her yinelemenin aynı biçimde başlaması için bir akışa `stop` ve `launch` ile başlayın. Başarısız olan bir yineleme çalıştırmayı bitirir: ondan önce geçenler saklanır ve dosyanın case'i başarısız olur. [Dashboard](../reference/perf.tr.md#dashboard) üzerinde bir yolculuk, adımlara bölünmüş tek bir çubuktur ve her adımın sayılarını içeren bir tablosu vardır.

Koddan, [kütüphanenin](../reference/library.tr.md) `replay(file, { onStep })` çağrısı her adımın işleminin etrafında `onStep`'i çağırır ve bekler:
hedefi ekrana geldiğinde `before`, ekran durulduğunda süresiyle `after`.
