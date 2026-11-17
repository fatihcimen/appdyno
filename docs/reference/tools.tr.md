# Araçlar

[English](tools.md)

Bir MCP istemcisinin çağırabildiği 28 araç. Her biri aynı zamanda [bir komut](cli.tr.md) ve [kütüphanede](library.tr.md) bir çağrıdır. Her birinin neyin üzerinde çalıştırıldığı ve çalıştırmaların ne gösterdiği [Araçlar nasıl test edildi](tools-tested.tr.md) sayfasındadır.

## Bir bakışta

| grup                                | araç                  | ne için                                                                                   |
| ----------------------------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| [Cihazlar](#cihazlar)               | `list_devices`        | neyin bağlı olduğunu ve hangi cihazın kullanıldığını görmek                               |
|                                     | `use_device`          | kullanılacak cihazı ve test edilen uygulamayı seçmek                                      |
|                                     | `set_device`          | bir koşulu okumak ya da değiştirmek: dark mode, konum, ağ, katlanma                       |
|                                     | `manage_simulator`    | bir simulator ya da emulator listelemek, başlatmak, oluşturmak ya da kapatmak             |
| [Pencere](#pencere)                 | `show_mirror`         | bir kişinin izleyip dokunabildiği canlı bir pencere açmak                                 |
|                                     | `ask_person`          | Face ID'de olduğu gibi işi bir kişiye bırakmak ve beklemek                                |
| [Okuma](#okuma)                     | `read_screen`         | ekranı öğeler ya da native view'lar olarak okumak                                         |
|                                     | `check_element`       | bir öğeyi denetlemek ya da denetim tutana kadar beklemek                                  |
|                                     | `take_screenshot`     | bir resim almak ya da neyin hareket ettiğini görmek                                       |
| [İşlem](#i̇şlem)                     | `tap_screen`          | dokunmak, çift dokunmak ya da uzun basmak                                                 |
|                                     | `swipe_screen`        | kaydırmak, bir öğeye kadar kaydırmak, sürüklemek ya da kıstırmak                          |
|                                     | `type_text`           | bir alana yazmak                                                                          |
|                                     | `press_key`           | bir tuşa ya da düğmeye basmak, klavyeyi kapatmak                                          |
|                                     | `run_steps`           | tek çağrıda birkaç araç çalıştırmak                                                       |
|                                     | `answer_alert`        | bir sistem uyarısını okumak ya da yanıtlamak                                              |
| [Uygulamalar](#uygulamalar)         | `open_link`           | bir deep link ya da bir Ayarlar sayfası açmak, bir uygulamanın bağlantılarını listelemek  |
|                                     | `launch_app`          | uygulamayı başlatmak ya da baştan başlatmak                                               |
|                                     | `manage_app`          | kurmak, durdurmak, temizlemek, izin vermek, derleyip çalıştırmak                          |
|                                     | `transfer_files`      | bir uygulamanın verisini almak ya da koymak, galeriye fotoğraf eklemek                    |
|                                     | `send_push`           | uygulamaya bir push bildirimi göndermek                                                   |
| [Denetim](#denetim)                 | `check_screen`        | erişilebilirliği denetlemek ya da kayıtlı bir görüntüyle karşılaştırmak                   |
|                                     | `read_logs`           | uygulamanın logunu ya da crash'lerini okumak                                              |
| [Kanıt](#kanıt)                     | `record_session`      | bir video, bir rapor, bir zaman çizelgesi ya da bir uygulamanın son saniyelerini saklamak |
|                                     | `capture_network`     | HTTP trafiğini incelemek, mock'lamak, yavaşlatmak ve denetlemek                           |
| [Uygulamanın içi](#uygulamanın-içi) | `inspect_app`         | bir web view'a, bir React Native uygulamasına ya da imzasız bir iPhone ekranına ulaşmak   |
| [Ölçüm](#ölçüm)                     | `measure_performance` | açılışı, kaydırmayı, kareleri, CPU'yu, heap'i ya da o anki durumu ölçmek                  |
|                                     | `compare_performance` | çalıştırmaları bir baseline'a karşı denetlemek ya da saklanan bir trace'i sorgulamak      |
| [Yeniden oynatma](#yeniden-oynatma) | `run_flow`            | bir flow kaydetmek, modelsiz yeniden oynatmak, dışa aktarmak                              |

Sonra nereye bakmalı:

- [Her araç](#her-araç), her aracın girdilerini grup grup, ayrıntılara bağlantılarla verir.
- [Bir işlem ne yanıtlar](#bir-işlem-ne-yanıtlar) ve [Hedefler](#hedefler), her dokunuşun nasıl davrandığını anlatır.
- [Önce kişiye sorulanlar](#önce-kişiye-sorulanlar), bir modelin tek başına yapamadıklarını listeler.
- [Her platform neyi yapabilir](#her-platform-neyi-yapabilir), Android, simulator ve iPhone için tek bir tablodur.
- [1.3.0'dan önceki adlar](#130dan-önceki-adlar), her eski aracı yenisiyle eşler.

## Bir çağrı nasıl çalışır

- Bu sayfada _pencere_, bir cihazın `show_mirror`'ın, hub'ın ya da Mac uygulamasının açtığı canlı penceresidir.
- _Runner_, appdyno'nun bir iPhone'daki ya da simulator'daki yardımcı uygulaması, _ajan_ ise Android'deki yardımcısıdır.
- _Koşul_, appdyno'nun değiştirdiği ve geri koyduğu bir cihaz ayarıdır.
- _İzin listesi_, `--allow-devices`, `--allow-apps` ve `--allow-urls` seçeneklerinin bu sunucunun dokunmasına izin verdiği şeylerdir.

Araçlar `device` parametresi almaz. Cihaz, `use_device`'ın seçtiği cihazdır; o yoksa sunucunun `--device`'ı, o da yoksa bu sunucunun yönetebildiği, bağlı tek cihaz.

Bir istemcinin işlem yapan çağrıları, geldikleri sırayla birer birer çalışır. İstemci ikisini aynı anda gönderirse, örneğin bir turda iki ref'in her birine birer `tap_screen`, ikincisi ilkinden sonra çalışır ve ilkinin bıraktığı ekranı hedefler; bu yüzden ilkinin kaldırdığı bir ref `STALE` olarak reddedilir. Sırasını bekleyen bir çağrı bunu ilerlemesinde `waiting its turn` diye bildirir. `read_screen` ve `check_element` gibi yalnızca okuyan çağrılar beklemez; `run_steps`'in çağırdığı bir araç da o `run_steps` çağrısının içinde çalışır.

Sunucu, MCP'nin `initialize` ile açılan 2024-10-07 ile 2025-11-25 arasındaki revizyonlarını ve 2026-07-28 revizyonunu konuşur; sonuncusu `server/discover` ile açılır. Bunu stdio üzerinden de `--http` üzerinden de yapar: hangisi olduğunu istemcinin ilk mesajı söyler. Araçlar ve kendileri hakkında söyledikleri her birinde bayt bayt aynıdır.

## Her araç

Aşağıdaki girdiler her aracın şemasından okunur. Kalın bir girdi zorunludur. İki noktadan sonra girdinin aldığı değerler ya da varsayılanı gelir; varsayılan işaretlenir. İşlem yapan bir araçta `read`, yanıtın ekranın ne kadarını tutacağını seçer: değişeni (`diff`), tamamını (`full`) ya da hiçbirini (`none`). Bir hedef, [Hedefler](#hedefler) bölümünün dediği gibi, bir `ref`, `x` ve `y` ya da bir `selector`'dır.

### Cihazlar

| araç               | ne yapar                                                                                                                                                                                                                                         | girdiler                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_devices`     | Bağlı telefonlar, simulator'lar ve emulator'lar: bu sunucunun hangilerini yönetebileceği, her birini kimin tuttuğu ve neyin engellediği; `selected` ile kullanılan cihaz: modeli, işletim sistemi sürümü, ekranı, ajan sürümü ve öndeki uygulama | `selected`                                                                                                                                                                                                                                                                                                                                                                                                 |
| `use_device`       | Yönetilecek cihazı ve test edilen uygulamayı seçer                                                                                                                                                                                               | **`device`**; `app`; `share`                                                                                                                                                                                                                                                                                                                                                                               |
| `set_device`       | Bir koşulu okur ya da ayarlar: koyu mod, ekran yönü, sahte GPS konumu, pano, metin boyutu ya da yavaş ağ gibi; `value` olmadan okur, ama `orientation` ve `location` bir değer ister                                                             | **`name`**: `orientation`, `location`, `clipboard`, `dark_mode`, `text_size`, `reduce_motion`, `increase_contrast`, `reduce_transparency`, `animations`, `locale`, `network`, `proxy`, `battery`, `airplane`, `wifi`, `mobile_data`, `fold`, `thermal`, `restore`, `biometric`, `call`, `sms`, `keychain`, `memory_warning`, `shake`; `value`; `title`; `app`; `read`: `diff` (varsayılan), `full`, `none` |
| `manage_simulator` | Simulator'ları ve emulator'ları listeler, başlatır, oluşturur ve kapatır                                                                                                                                                                         | **`action`**: `list`, `boot`, `create`, `shutdown`; `name`                                                                                                                                                                                                                                                                                                                                                 |

Ayrıntılar: [Bir cihazı paylaşmak](#bir-cihazı-paylaşmak), [Bir simulator ya da emulator başlatmak](#bir-simulator-ya-da-emulator-başlatmak), [Bir telefona ulaşmak](#bir-telefona-ulaşmak), [Bir cihazı eski haline getirmek](#bir-cihazı-eski-haline-getirmek), [Kablosuz bağlantılar, biyometri ve anahtar zinciri](#kablosuz-bağlantılar-biyometri-ve-anahtar-zinciri), [Yavaş bir ağ](#yavaş-bir-ağ), [Katlanma](#katlanma), [Diller](#diller), [Bir iPhone'un kendi koşulları, verisi ve izinleri](#bir-iphoneun-kendi-koşulları-verisi-ve-izinleri).

### Pencere

| araç          | ne yapar                                                                                      | girdiler                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `show_mirror` | Cihazın, bir kişinin izleyip dokunabildiği canlı penceresi                                    | **`action`**: `open`, `close`, `status`, `stats`; `quality`: `auto` (varsayılan), `high`, `standard`; `wifi`: `false` (varsayılan) |
| `ask_person`  | Kişiden bir aracın yapamadığını, örneğin Face ID'yi, yapmasını ister ve bitirene kadar bekler | **`reason`**; `timeoutS`: `300` (varsayılan)                                                                                       |

Ayrıntılar: [Pencere ve hub](mirror.tr.md).

### Okuma

| araç              | ne yapar                                                                                                    | girdiler                                                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_screen`     | Ekranın öğeleri, her biri bir ref ile; `selector` ile eşleşen öğeler, durumları ve sınırlarıyla             | `selector`; `raw`; `views`                                                                                                                                                                                                         |
| `check_element`   | Bir öğeyi denetler, geçti ya da kaldı; `timeoutMs` ile denetim tutana kadar bekler: tutmazsa `CHECK_FAILED` | `ref`; `selector`; `check`: `exists` (varsayılan), `absent`, `text`, `enabled`, `checked`, `focused`, `moves`; `equals`; `expect`: `true` (varsayılan); `timeoutMs`: `0` (varsayılan); `read`: `diff` (varsayılan), `full`, `none` |
| `take_screenshot` | Ekranın bir görüntüsü ya da `watchMs` ile ekranda neyin hareket ettiği                                      | `points`; `width`; `watchMs`; `strip`; `file`; `overwrite`; `inline`                                                                                                                                                               |

Ayrıntılar: [Ekranı okumak](#ekranı-okumak), [Hedefler](#hedefler), [Ekran görüntüleri](#ekran-görüntüleri).

### İşlem

| araç           | ne yapar                                                                                                                               | girdiler                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tap_screen`   | Bir hedefe dokunur; `count: 2` çift dokunuş, `holdMs` uzun basıştır                                                                    | `ref`; `x`; `y`; `selector`; `count`; `holdMs`; `read`: `diff` (varsayılan), `full`, `none`                                                                                                                        |
| `swipe_screen` | Parmağı hareket ettirir: kaydırma, bir öğe ekrana gelene kadar kaydırma, sürükleme, kıstırma ya da birden çok parmağın serbest yolları | `direction`: `up`, `down`, `left`, `right`; `ref`; `x`; `y`; `selector`; `until`; `maxSwipes`; `distance`; `exact`; `to`; `durationMs`; `holdMs`; `scale`; `pointers`; `read`: `diff` (varsayılan), `full`, `none` |
| `type_text`    | Odaktaki alana ya da bir hedefe en çok 500 karakter yazar                                                                              | **`text`**; `ref`; `x`; `y`; `selector`; `replace`; `submit`; `read`: `diff` (varsayılan), `full`, `none`                                                                                                          |
| `press_key`    | Bir tuşa ya da düğmeye basar; `hide_keyboard` ekran klavyesini kapatır                                                                 | **`key`**; `count`; `read`: `diff` (varsayılan), `full`, `none`                                                                                                                                                    |
| `run_steps`    | Tek çağrıda en çok 30 araç                                                                                                             | **`steps`**; `read`: `diff` (varsayılan), `full`, `none`                                                                                                                                                           |
| `answer_alert` | Açık sistem uyarısını okur ya da yanıtlar                                                                                              | `answer`; `read`: `diff` (varsayılan), `full`, `none`                                                                                                                                                              |

Ayrıntılar: [Bir işlem ne yanıtlar](#bir-işlem-ne-yanıtlar), [Adımlar, hareketler, uygulamalar ve ayarlar](#adımlar-hareketler-uygulamalar-ve-ayarlar), [Sistem uyarıları](#sistem-uyarıları).

### Uygulamalar

| araç             | ne yapar                                                                                                           | girdiler                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open_link`      | Bir bağlantıyı ya da bir Ayarlar sayfasını açar ya da bir uygulamanın açtığı bağlantıları listeler                 | `url`; `settings`; `links`; `read`: `diff` (varsayılan), `full`, `none`                                                                                                                                                                                                         |
| `launch_app`     | Uygulamayı başlatır ya da öne getirir; `restart` onu baştan başlatır                                               | `app`; `restart`; `args`; `env`; `language`; `probe`; `read`: `diff` (varsayılan), `full`, `none`                                                                                                                                                                               |
| `manage_app`     | Uygulamaları ve izinlerini kurar, listeler, durdurur ve yönetir; bir projeyi derleyip çalıştırır                   | **`action`**: `list`, `state`, `install`, `uninstall`, `clear`, `grant`, `revoke`, `build_and_run`, `stop`; `app`; `path`; `files`; `service`; `scheme`; `configuration`; `args`; `env`; `all`: `false` (varsayılan); `read`: `diff` (varsayılan), `full`, `none`; `background` |
| `transfer_files` | Bu Mac ile cihaz arasında dosya taşır: bir uygulamanın verisini dışarı ya da içeri, fotoğraf ve videoları galeriye | **`action`**: `pull`, `push`, `media`; **`path`**; `app`                                                                                                                                                                                                                        |
| `send_push`      | Uygulamaya bir push bildirimi gönderir; `type` verilmezse bu cihazın neleri aldığını söyler                        | `app`; `type`; `title`; `body`; `image`; `data`; `payload`; `read`: `diff` (varsayılan), `full`, `none`                                                                                                                                                                         |

Ayrıntılar: [Önce kişiye sorulanlar](#önce-kişiye-sorulanlar), [Push bildirimleri](#push-bildirimleri), [Bağlantılar](#bağlantılar), [Bellek uyarıları, sallamalar, fotoğraflar ve arka planda bir son](#bellek-uyarıları-sallamalar-fotoğraflar-ve-arka-planda-bir-son).

### Denetim

| araç           | ne yapar                                                                                                    | girdiler                                                                                                                                                                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check_screen` | Ekranın tümünü denetler: erişilebilirlik sorunları ya da ekranın kaydedilmiş bir görüntüyle karşılaştırması | **`check`**: `accessibility`, `visual`, `visual_baseline`; `name`; `dir`; `tolerance`: `0.1` (varsayılan); `masks`; `types`: `contrast`, `elementDetection`, `hitRegion`, `sufficientElementDescription`, `dynamicType`, `textClipped`, `trait`, `imageContrast`, `duplicateLabel`; `maxIssues`: `50` (varsayılan) |
| `read_logs`    | Uygulamanın logu, gizli değerler saklanmış olarak; `source: crashes` ile crash, ANR ve çıkış raporları      | `source`: `app` (varsayılan), `crashes`; `app`; `since`; `level`: `verbose`, `debug`, `info` (varsayılan), `warn`, `error`; `contains`; `limit`; `symbols`                                                                                                                                                         |

Ayrıntılar: [Loglar ve crash'ler](#loglar-ve-crashler).

### Kanıt

| araç              | ne yapar                                                                                                                                                               | girdiler                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record_session`  | Kanıt saklar: ekranın videosu, tek bir HTML dosyasında bir test raporu, bir zaman çizelgesi ya da bir uygulamanın bir crash'te ya da takılmada saklanan son saniyeleri | **`kind`**: `video`, `report`, `timeline`, `flight`; **`action`**: `start`, `stop`, `write`; `file`; `overwrite`; `maxSeconds`: `1800` (varsayılan); `dir`                                                                                                                                                                                                                        |
| `capture_network` | Uygulamanın HTTP trafiği                                                                                                                                               | **`action`**: `paths`, `start`, `read`, `stop`, `mock`, `throttle`, `check`; `via`: `proxy`, `probe`, `packets`, `bytes`; `proxy`; `app`; `bodies`; `har`; `id`; `path`; `shape`; `diff`; `after`; `contains`; `method`; `status`; `limit`: `50` (varsayılan); `save`; `overwrite`; `rules`; `add`; `has`; `timeoutMs`; `from`; `unmatched`: `pass`, `fail`; `strict`; `throttle` |

Ayrıntılar: [Simulator'da ağ](#simulatorda-ağ).

### Uygulamanın içi

| araç          | ne yapar                                                                                                                                                                                                        | girdiler                                                                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect_app` | Bir uygulamanın içi: hata ayıklanabilir bir uygulamanın web görünümü, Metro üzerinden debug bir React Native uygulaması ya da imzalama olmadan, telefonun kendi erişilebilirlik servisiyle bir iPhone'un ekranı | **`action`**: `web_pages`, `web_elements`, `web_click`, `web_eval`, `rn_targets`, `rn_logs`, `rn_reload`, `ax_list`, `ax_press`; `app`; `page`; `selector`; `js`; `metro`: `localhost:8081` (varsayılan); `target`; `ms`: `3000` (varsayılan); `name` |

### Ölçüm

| araç                  | ne yapar                                                                                                                                                                                                         | girdiler                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `measure_performance` | `metric` ile ölçer: açılış süresi, kayarken bir listenin kareleri, karelerin neden yavaş olduğu ve bir iPhone'un takılmaları, CPU zamanının nereye gittiği, bir heap dökümü ya da şu anki CPU, bellek ve kareler | **`metric`**: `snapshot`, `launch`, `scroll`, `frames`, `cpu`, `heap`; `app`; `cpuWindowMs`: `2000` (varsayılan); `also`: `threads`, `network`, `energy`, `anonMemory`, `startInfo`, `surface`, `battery`, `exits`, `size`; `batteryWindowMs`: `30000` (varsayılan); `scenario`; `mode`: `cold` (varsayılan), `warm`, `hot`; `repeats`; `compile`: `speed`, `speed-profile`, `verify`; `trace`; `baselineProfile`; `probe`; `baseline`; `direction`: `up`, `down`; `swipes`: `5` (varsayılan); `x`; `y`; `selector`; `seconds`; `what`: `frames` (varsayılan), `hangs`, `xct_hitches`, `xct_launch`; `dsym`; `profile`: `java_hprof`, `heapprofd` |
| `compare_performance` | Performans kapısı: saklanan çalıştırmalar, temel değere ve bütçelere karşı; `query` ile saklanan bir izden, SQL ya da adıyla bir tablo                                                                           | `action`: `compare` (varsayılan), `why`, `reference`, `budget`, `baseline`, `dashboard`, `functions`, `prune`, `query`; `limitGb`; `dryRun`; `from`; `to`; `app`; `scenario`; `deviceClass`; `last`: `1` (varsayılan); `replace`; `kind`; `max`; `min`; `format`: `text` (varsayılan), `json`, `junit`; `dsym`; `trace`; `sql`; `table`; `limit`: `50` (varsayılan)                                                                                                                                                                                                                                                                               |

Ayrıntılar: [Performans ölçümü](perf.tr.md) ve [Performansı ölçmek](../guides/performance.tr.md) rehberi.

### Yeniden oynatma

| araç       | ne yapar                                                                                                                                                            | girdiler                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run_flow` | İşlemleri tekrarlanabilir bir test olarak kaydeder, onu modelsiz yeniden oynatır, bir klasör dolusunu tek bir karara çalıştırır ve Maestro YAML olarak dışa aktarır | **`action`**: `record`, `stop`, `save`, `run`, `test`, `export`; `file`; `to`; `from`; `params`; `envFile`; `overwrite`; `iterations`; `retries`; `tags`; `scenario` |

`run_flow` `test`, bir `.flow` dosyasını ya da onlardan oluşan bir klasörü, `appdyno test` gibi, seçili cihazda çalıştırır ve [çalıştırmanın raporunu](../guides/flows.tr.md#bir-çalıştırmanın-raporu) `to` ile adlandırılan klasöre yazar; verilmezse `appdyno-artifacts` klasörüne. `verdict.txt` satırlarıyla yanıt verir; verisinde `verdict`, `record` ve `page` yolları ile `failed` olan dosyalar bulunur. Başarısız olan bir çalıştırma bir yanıttır, reddedilmiş bir çağrı değildir. `tags`, içlerinden birini taşıyan dosyaları seçer; `retries` başarısız bir dosyayı yeniden çalıştırır. Birkaç cihazda çalıştırma komut satırının işidir: `appdyno test --device`.

`run_flow` `run`, bir flow'un setup'ını adımlarından önce, teardown'unu adımlarından sonra çalıştırır; başarısız olan bir teardown, adımların geçtiği söylendikten sonra `CHECK_FAILED` ile reddedilir. Bir `prepare` adımı bir projenin kendi komutunu bu Mac'te çalıştırır; bu yüzden her seferinde önce kişiye sorar, `--allow-build` ile başlatılmış bir sunucu ise sormadan çalıştırır. Bir kayıt, adımı olan her işlem için bir adım yazar: bunların arasında `to` ile bir `swipe_screen` için `drag`, bir `send_push` için `push`, bir `set_device` `orientation` ve `clipboard` için `setting orientation` ve `clipboard`, bir `inspect_app` `web_click` için `web_click`, bir `check_screen` `accessibility` için de `audit` vardır. `scale` ya da `pointers` ile bir `swipe_screen` ve bir `inspect_app` `web_eval` için ise yeniden oynatmanın durduğu `unrecorded` yazar. Biçim ve kaydedilen her işlemin neye dönüştüğü [Flow'lar](../guides/flows.tr.md) sayfasındadır.

## Yalnızca bazı araçları listelemek

Bir istemci her oturumda araç listesinin tümünü okur. `--toolsets` ile ya da ortamında `APPDYNO_TOOLSETS` ile başlatılan bir sunucu, yalnızca adı verilen grupları listeler; gruplar virgülle ayrılır: `appdyno mcp --toolsets core,network,perf`. Verilmezse her aracı listeler. Hiçbir grubun adı olmayan bir sözcük reddedilir ve sunucu başlamaz. Boyutlar, istemciye gönderilen listenin karakter sayısıdır; listenin tümü 26.851 karakterdir.

| grup       | araçlar                                                                                                                                                                                         | boyut  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `core`     | `list_devices`, `use_device`, `read_screen`, `take_screenshot`, `check_element`, `tap_screen`, `swipe_screen`, `type_text`, `press_key`, `run_steps`, `answer_alert`, `launch_app`, `open_link` | 10.074 |
| `device`   | `manage_simulator`, `set_device`, `ask_person`, `show_mirror`                                                                                                                                   | 3.240  |
| `apps`     | `manage_app`, `transfer_files`, `send_push`, `inspect_app`                                                                                                                                      | 3.645  |
| `evidence` | `read_logs`, `check_screen`, `record_session`, `run_flow`                                                                                                                                       | 4.100  |
| `network`  | `capture_network`                                                                                                                                                                               | 2.247  |
| `perf`     | `measure_performance`, `compare_performance`                                                                                                                                                    | 3.600  |

Bir grup daha kısa bir listedir, bir izin değildir. Bir sunucunun ne yapabileceğini `--allow-` bayrakları söyler. [Komut satırı](cli.tr.md) ve [kütüphane](library.tr.md), ne listelenmiş olursa olsun her araca ulaşır; `run_steps` ise `run_steps` ve `run_flow` dışında her araca. Sunucunun yönergeleri her gruptan araçların adını anar; yalnızca `core` listeleyen bir istemci, elinde olmayan bir aracın adını okuyabilir.

## Bir işlem ne yanıtlar

Bir işlem durulmuş ekranla yanıt verir. `settled`, ekranın bekleme süresi boyunca durgun kaldığı anlamına gelir. `changed`, ekranın işlemden öncekinden düzende ya da metinde farklı olduğu anlamına gelir; farka işlemin yol açtığını söylemez.

Hiçbir şey değişmediyse yanıt "no change seen in N ms; if a slow reaction is expected, use check_element with timeoutMs" der; listelediği ekran işlemden önce değişmişse "no change seen in N ms after the action: the screen changed before it" der.

### Yapılandırılmış yanıt

Her yanıtın `structuredContent`'i, özetin yanında metninin tamamını `text` olarak taşır, çünkü bir istemci iki kısımdan yalnızca birini gösterebilir; yapılan iş (`done`) metnin ilk sözleridir ve metin onu tuttuğunda `structuredContent`'e konmaz. Başarısız bir çağrı, metni `code` ile başlayıp `hint` ile biten bir `isError` yanıtıdır, ikisi `structuredContent`'te de vardır; başarısız bir işlem de dokunuşunun gidip gitmediğini söyler (`dispatched`).

Bir işlem, kimsenin görmediği bir ekrana dokunmadan önce onu okur ve kilitli bir telefonda `DEVICE_LOCKED` ile reddedilir. Bir isteğin iptali cihaza ulaşır ve uzun işlemler ilerleme bildirir.

### Önde başka bir uygulama varsa

Bir yanıt, uygulama önden kendiliğinden çıktığında önde olmadığını söyleyerek uyarır ve öndeki uygulamayla beklenen uygulamayı adlandırır; onu bilerek bırakan bir tuştan, bir Ayarlar sayfasından, başka bir uygulamanın başlatılmasından ya da bir durdurmadan sonra uyarmaz. Uygulama öndeyken başlayıp başka bir uygulamayı öne getiren bir işlem, Safari'de açtığı bir bağlantı gibi, hangi uygulamanın öne geldiğini söyler.

**Başarısız bir işlem bir şeye dokunup dokunmadığını söyler.** Yanıtı "no touch was sent", "the touch was sent" ya da yanıt vermeyi bırakan bir cihaz için "the touch may have been sent: read the screen before trying again" ile biter ve bir istemcide `dispatched` vardır: `true`, `false` ya da `unknown`. Orada olmayan bir hedef ve cihazın bir reddi her dokunuştan önce gelir; listesi biten bir kaydırma ise önce kaydırma hareketini yapmıştır. Bir işlemden sonraki okuma da, karanlık bir ekranda ya da donmuş bir uygulamada, başarısız olabilir: işlem gitmiştir, bu yüzden o yanıt, başka ne derse desin, dokunuşun gönderilmiş olabileceğini söyler.

**Bir dokunuş önce bakar.** Son işlemden bu yana ve 20 s'den kısa süre önce bir okuma yapılmadıysa her işlem ekranı okur, çünkü bir telefon son dokunuştan yaklaşık bir dakika sonra kendini kilitler ve kör bir kaydırma bir kilit ekranından Spotlight'ı açabilir. Yalnızca okuma olmayan yerde bir okumaya mal olur. Reddedilen bir okuma dayanacak bir şey bırakmaz, bu yüzden bir sonraki dokunuş yeniden okur. Bu 20 s içinde açıkken kilitlenen bir ekrana yine dokunulur; kararan birini ajan reddeder; Android'de ekran sonra uyandırılır ve dokunuş yeniden gönderilir, kilit kalırsa `DEVICE_LOCKED` ile reddedilir.

**Kilitli bir telefon `DEVICE_LOCKED` ile reddedilir**; okumalar da dokunuşlar da. Android'de bu, bir uyandırma ve bir kapatmadan sonra yerinde kalan bir keyguard'dır. Parolası olmayan bir iPhone kilit ekranını ana ekran düğmesiyle geçer: karanlık bir ekranda ilk basış yalnızca onu uyandırır, kilit ekranı hâlâ açıktır, bu yüzden üç kereye kadar basar ve uygulama geri gelir. Parolası olan bir iPhone okumayı `devicectl device info lockState` ile reddeder. Neyin çalıştırıldığı [Araçlar nasıl test edildi](tools-tested.tr.md#kilitli-bir-telefon) sayfasındadır.

## Hedefler

Bir hedef bir `ref`, `x` ve `y` ya da bir `selector` `{ text, id, role, index }`'tir ve işlemden hemen önce yeni bir okumada çözülür.

### Metin nasıl eşleşir

Metin, `selector` ile `read_screen`'deki gibi büyük-küçük harfe ve aksanlara bakmadan eşleşir ("İstanbul", "istanbul"); bir öğenin bütün sözleriyle, listenin uzun bir etiketi kestiği yerin ötesinde de, bir flow'un tutmuş olabileceği kesik etiketle de eşleşir; tam eşleşme kısmi eşleşmeden üstündür. Metni yalnızca bir paragrafın parçası olarak bulan bir dokunuş ya da `until` ile `swipe_screen` bunu söyler, çünkü ekranda onu tek başına okuyan bir şey yoktu.

### Dokunuş nereye düşer

Öğesini, kaydırmalarının yeni şeyleri getirdiği kenarın, benzer komşularının gösterdiğinin yarısından azına kestiği halde bulan `until` ile bir `swipe_screen` bir kez daha kaydırır, çünkü bu kadar azına dokunulamaz. Ortası, başka sözcükleri olan daha küçük bir denetimin olduğu bir denetime dokunuş, bir mini oynatıcının Pause'u gibi, onun o denetimden uzak bir noktasına gider ve nereye gittiğini söyler, uzak bir nokta yoksa ortanın kimin olduğunu söyler; kendi anahtarını tutan bir anahtar satırına, SwiftUI'ın Toggle'ı gibi, o anahtardan dokunulur.

### Eşleşme yoksa ya da birden çoksa

Birden çok eşleşmede işlem reddedilir ve eşleşmeler ref'leriyle listelenir, son eşleşmenin ötesindeki bir index de kaç eşleşme olduğunu söyler; eşleşme yoksa bir an beklenir, sonra en yakın etiketlerle reddedilir; önde başka bir uygulama varsa ve uygulama bilerek ayrılmadıysa, bunun yerine uygulamanın önde olmadığı söylenir. Süresi dolan `timeoutMs` ile bir `check_element` de aynısını ve yeniden çağırmanın daha uzun beklediğini söyler.

`NOT_FOUND` ya da `STALE` ile reddedilen bir dokunuş, bir yanıtın yaptığı gibi ekranı şimdiki haliyle içerir: son gösterilen ekrandan farkını, `read` `full` ise ya da önde başka bir uygulama varsa tamamını, `read` `none` ise hiçbirini. Bir sonraki denemeden önce ekranı okumak gerekmez.

### Klavyenin altındaki bir hedef

Bir hedef ekran klavyesinin altındaysa, yani dokunuş bir harf yazacaksa, ya da klavye pencereyi küçülttüğü için bir seçici hiçbir şey bulamıyorsa, klavye kapatılır ve hedef, onu bekleme başlamadan bir kez daha aranır; yeniden oynatılan bir flow'un adımı da bunu kendi beklemesinden önce yapar. Yatay tutulan bir telefon, uygulamanın tamamının üstünde tam ekran bir klavye gösterir. iOS'ta bir web formunun üstündeki klavye, hangi dilde olursa olsun üstündeki çubuğun Done'ı ile kapatılır. Uygulamanın yine de açık tuttuğu bir klavyeye yazılmaz: dokunuş `UNSUPPORTED` ile reddedilir ve öğenin klavyenin altında olduğunu söyler.

## Ekranı okumak

### Ekran klavyesi

Ekran klavyesi, Android'de olduğu gibi iOS'ta da tek bir öğedir, `@keyboard keyboard`; tuşlarının, çubuklarının ve önerilerinin hiçbiri listelenmez: `type_text` yazar, `press_key` `enter` onun return tuşuna basar, `press_key` `hide_keyboard` onu kapatır ve ona bir dokunuş reddedilir. Onu açan bir alan dokunuşu bunu farkın tek bir satırında söyler.

iOS'ta hedefsiz bir `type_text`, hiçbir alan odakta değilken ve klavye açık değilken, bir tuş gönderilmeden `NO_FOCUS` ile reddedilir: iOS odakta hiçbir şey yokken de tuş alır ve ilk tuş, kalanların içine düştüğü bir alanı odaklayabilir. iOS runner'ı `press_key` `delete` ve `tab`'ı da böyle reddeder; XCTest'in kendi yazması orada onu sonlandırıyordu.

### Bir okumanın dışarıda bıraktıkları

iOS'ta ekranın üstündeki bir gezinme çubuğunun yukarısında, durum çubuğunun altında kalan ve o çubuğun kendi ekranından çubuğun altına kaymış olan, ekranın kenarının ötesindeki gibi dışarıda bırakılır, çünkü iki çubuktan birine bir dokunuş bir listeyi başına kaydırır; çubuğun kendi düğmeleri kalır, o ekranın üstündeki bir sayfa da.

Biri ötekini tutmayan, tek bir noktadaki dört ya da daha çok öğe, bir listenin henüz yerleştirmediği, başladığı yere yığılmış satırlardır: onlar da dışarıda bırakılır.

### Ref'ler

Bir ref bir öğeyi ne olduğuyla adlandırır, bu yüzden kaydırmalarda ve yeniden çizimlerde kalır; kendi kimliği olmayan bir alan çevresindeki sözcüklerle adlandırılır, bu yüzden yer tutucusu gelirken ve içine yazılırken ref'i kalır. Kendi adı olan bir alan, adından sonra içinde ne olduğuyla listelenir, `textField "Search" ="shoes"` gibi; bir parolanınki yazılmaz. İçine yazılan her şey, uygulama ona ne derse desin, bir `textField`'dır.

### Bütün bir ekranda katlananlar

Bir yanıttaki bütün bir ekran, tekrar edeni katlar.

- Etiketi kendisini zaten içeren bir satırın içindeki düz bir metin ya da görsel ayrı bir satır almaz; bir web bağlantısının kendi metni ve bir dipnotun işaretleri de almaz. Satırla aynı adı taşıyan ve satırın tam yerinde duran bir kontrol, uygulamanın bir yerde iki kez verdiği bir öğe ve içindeki düz bir metnin sözleriyle adlanan düz bir öğe de almaz; bir uyarının başlığıyla adlanması gibi, bunlar başlığın yerinde söylenir. İlk satır katlananları sayar.
- Kendi anahtarını içeren bir toggle, SwiftUI'ninki gibi, tek satırdır: içindeki anahtar, içindeki kendi sözlerinden bir kontrol ve onu çevreleyen, sözleri ve durumuyla adlanan hücre ("Bold Text 0") satır almaz; kendi sözlerinden bir toggle'ı çevreleyen bir hücre de almaz.
- İçindeki sözlerle adlanan bir satır, aynısının hemen ardından gelen bir adı bir kez söyler; harfsiz ya da tek karakterli bir değer, 3'e 3 biten bir skor gibi, kaç kez varsa o kadar kalır.
- Art arda gelen, birbirine benzeyen üç ya da daha fazla satır tek bir başlığı paylaşır (`cell x=201 clickable: ref "label" y`).
- Yalnızca bağlamlarının ayırdığı satırlar da bir başlığı paylaşır; her biri bağlamını yerinden sonra taşır (`button x=339 clickable: ref "label" y — context`, ardından `@d62s "Add" 137 — Product 35`).
- Bir öğenin iki kez verdiği etiket bir kez gösterilir; benzer iki öğeyi ayıran bilgi, örneğin yerleri, yalnızca başka bir satır aynı adı taşıdığında gösterilir.

Yalnızca metin katlanır: `selector` ile `read_screen`, seçiciler, ref'ler, diff'ler, flow'lar ve `record_session` yine her öğeye ulaşır. `raw: true`, yapılandırılmış yanıtta ağacın her öğesini de dikdörtgeni ve üst öğesinin sırasıyla verir, [kütüphane](library.tr.md) bunu anlatır; verdiği bir ref `tap_screen`'in aldığı bir ref'tir.

### Android'de native view'lar

Android'de `views` ile `read_screen`, öndeki aktiviteyi sistemin ondan aldığı kendi dökümünden okur; her derlemede, hata ayıklanabilir olsun olmasın, probe olmadan: her görünümün sınıfı, dokunma birimlerinde yeri, kaynak kimliği ve bayrakları (`clickable`, `disabled`, `focused`, `selected`, `gone`, `invisible`), ekranın çoğunu çizen çatının altında. Sözcük vermez: onları `read_screen` okur.

Yanıt, görünümlerin dışarıda bıraktıklarıyla biter: gösterdiğinden fazlasını tutan bir kaydırma görünümünün ya da görünüm sayfalayıcının altında yerler onun yerleşiminin yerleridir, çünkü kaydırması görünümlerini değil çizdiğini taşır; aktivitenin üstündeki bir diyalog ya da menü kendi penceresidir ve orada yoktur; küçültülmüş bir derlemenin küçültücüsünün adlandırdığı görünümler ekranı tutuyorsa, R8'in Flutter'ınkini `V4.v`, Compose'unkini `p3` diye adlandırdığı gibi, framework'ü uygulamanın paketinde taşıdığı söyler: Flutter'ın ya da React Native'in motoru (`libflutter.so`, `libreactnative*.so`, `libhermes*.so`), ya da yeniden adlandırılmış bir görünümün Compose'unki gibi odak alıp çizdiği yerde Compose. Not, etiketin neye dayandığını söyler; paket bir şey söylemiyorsa etiket Android views olarak kalır ve not, orada neyin çizdiğini hiçbir adın söylemediğini belirtir.

Önce ekran, `read_screen`'in okuduğu gibi okunur: hiçbir şey sormayan bir kilit açılır; PIN, desen ya da parola arkasındaki bir kilit `DEVICE_LOCKED` ile reddedilir.

Android'de asistanın sayfası öndeyken bir okuma pencere bulamaz: `read_screen` ve `launch_app` bunu söyleyerek `NOT_FOUND` yanıtını verir, `press_key` `home` sayfayı kapatır. Görevinde başka bir uygulamanın penceresinin arkasında sonlanan bir uygulamayı (`background` ile `manage_app stop`'tan sonraki izin istemi gibi) bir başlatma başlatmaz, yalnızca o pencereyi öne getirir: `launch_app`, öndeki uygulamayı adıyla söyleyerek `APP_NOT_RUNNING` yanıtını verir.

Ana iş parçacığı sisteme 5 s içinde yanıt vermeyen bir uygulama `TIMEOUT` ile reddedilir. Android'de `probe` ile `launch_app` istendiği gibi başlatır ve probe gerekmediğini söyler.

### Bir simulator'da native view'lar

Bir simulator'da `views` ile `read_screen`, uygulamanın görünümlerini, `probe` ile `launch_app`'in uygulamaya koyduğu ve bu aracın uygulamayı sonraki başlatışlarının oturum bitene dek taşıdığı görünüm probe'uyla okur; bir okuma yalnızca probe'a sorar ve uygulamayı asla yeniden başlatmaz.

Okumaların aldığı uygulamaya, probe'un tutulduğu her uygulamaya ve öndeki uygulamaya aynı anda sorar ve ekrandakinin görünümlerini verir: her görünümün sınıfı, çözülmüş bir Swift adıyla, dokunma birimlerinde yeri, erişilebilirlik kimliği ve etiketi, metni (bir etiketin, bir alanın, bir düğmenin başlığı; asla bir güvenli alanınki ya da onun içindeki herhangi bir şeyinki değil), ne kadar saydam olduğu ve değiştiği yerde görünüm denetleyicisi, ekranın çoğunu çizen çatının altında, SwiftUI UIKit'ten ayrılarak. SwiftUI kendi metnini ve şekillerini kendisi çizer, bu yüzden bir SwiftUI ekranının az görünümü ve daha az sözcüğü olur: barındıran görünümleri, üzerine kurulduğu UIKit görünümleri, bir alan, bir liste ya da bir gezinme çubuğu gibi, ve uygulamanın UIKit olarak verdikleri.

Probe'u olmayan bir uygulamanın okunması `UNSUPPORTED` ile reddedilir; uygulamanın paketinin ne tuttuğunu söyler (Flutter, `Flutter.framework` ile; React Native, Hermes ya da `main.jsbundle` ile) ve ipucunda `launch_app restart:true probe:true` vardır; ana iş parçacığı 2 s içinde yanıt vermemiş bir uygulama `TIMEOUT` ile, iOS'un askıya aldığı, başka birinin arkasındaki bir uygulama da `APP_NOT_RUNNING` ile reddedilir.

Bir iPhone 17 simulator'ında, iOS 26.5, bir okuma fixture'ın ekranlarında 2 ile 26 ms, 273 görünüme kadar olan uygulamalarda 2 ile 17 ms sürdü.

Çalışmayan ya da probe'u yanıt verirken iOS'un askıya aldığı bir uygulama (`home`'dan bir saniye sonra sorulan gibi) `APP_NOT_RUNNING` ile reddedilir: başlatmaları bir probe tutuyorsa bu aracın onu bir sonraki başlatması probe'u koyar, tutmuyorsa `probe` ile `launch_app`.

Komut satırından tutulan bir probe, `set_device restore`'a ya da o simulator'da probe tutan bir sunucu bitene dek kalır; sunucunun sonu hepsini bırakır. `restore` ve oturumun sonu, hâlâ süren bir yakalamanın ağ probe'unu tutulu bırakır ve bunu söyler: onu `capture_network` `stop` bırakır.

Görünümler uygulamanın kendisinindir: önlerinde bir sistem uyarısı olduğunda yanıt bunu son satırında ve `warnings` içinde, uyarının sözleri ve düğmeleriyle söyler. Bir iPhone görünüm vermez: orada `views` ve `launch_app` `probe` reddedilir.

### Ekran görüntüleri

Bir ekran görüntüsünün yanıtı, pikselinin nereye dokunulacağını söyler: x ve y'si, dokunuş birimine ölçeğiyle çarpılır; bu bir tam sayıya bölmeyse bölme olarak söylenir, bir iPhone'un tam boyutlu resmi için `x/3`. Ölçek ve `width`, döndürülmüş olsun ya da olmasın ekranın şu anki duruşuna göredir; bir simulator'ın resmi öndeki uygulamasının durduğu gibi dikleştirilir. Ekrandan hâlâ başka türlü duran bir resim ölçek almaz ve yanıt ekranın dokunuş birimindeki boyutunu söyler.

`file` ile resmi tam boyutta, ya da `width` ne kadar genişlik isterse o genişlikte kaydeder ve yanında görüntüyü bir ekran görüntüsünün yaptığı gibi gösterir, yanıt onun boyutunu ve ölçeğini verir; böylece dosyanın geri okunması gerekmez; `inline: false` yalnızca dosyayı kaydeder.

## Adımlar, hareketler, uygulamalar ve ayarlar

### Tek çağrıda adımlar

`run_steps`, ekranlar arasında en fazla 30 adım çalıştırır. Bir ref ya da seçicinin yalnızca kendi adımı çalıştığında var olması gerekir. İlk başarısızlıkta durur, hangi adımda ve neden olduğunu söyler ve ekranı gösterir: `read` `diff` ise son gösterilen ekrandan farkını, değilse tamamını, `read` `none` olsa da. Araç olmayan bir adım, hiçbir şey yapılmadan bütün çağrıyı reddettirir ve yanıt bunu söyler.

`timeoutMs` ile `check_element` ve seçiciler cihazda bekler, böylece ağaç bağlantı üzerinden yalnızca ekran değiştiğinde gönderilir.

### Uygulama bir işlemin altında ölürse

Uygulama bir işlemin altında ölürse işlem `APP_NOT_RUNNING` ile reddedilir: yanıt, işlemin ne yaptığını, crash raporundaki nedeni ve uygulamanın son log satırlarını, nedeni söyleyen ilk satırdan başlayarak verir. `run_steps` içinde bu, çağrıyı adımın adını vererek bitirir.

İzlenen uygulama seçili olandır, yoksa dokunuş hedeflenirken önde olandır; onu aynı çağrıda daha önceki bir başlatma ya da bağlantı açmış olabilir. Önceki bir crash geride uygulama bırakmadığı için başarısız olan sonraki bir adım, kendi hatasına `APP_NOT_RUNNING`'i ve ne yapılacağını ekler; bir flow'un adımı da öyle.

Bir saniyeden uzun süren bir işlemde uygulamanın süreci izlenir ve süreç gider gitmez, cihaz sonra ne yanıtlarsa yanıtlasın, işlem reddedilir: bir dokunuşun altındaki bir crash cihazın yanıtını tam 15 s tutabiliyordu, bu da takılmış bir ajan gibi okunuyordu.

### Beklemeler ve seçiciler

`check_element`, açıklamasının söylediği gibi, bir çağrıda en fazla 15000 ms bekler; bir argümanın sınırını aşan bir sayı, ipucunda sınırıyla reddedilir.

Bir seçici, onu alan her araçta ve adımda, aralarında `read_screen` ve `check_element` de olmak üzere, `selector`'a girer, `{"tool":"tap_screen","selector":{"text":"OK"}}` gibi: sözcükleri en üstte verildiğinde, ipucunda çağrı bu biçimde gösterilerek reddedilir.

### Her araç neleri içerir

- `tap_screen`; `count: 2` ile çift dokunuşu ve `holdMs` ile uzun basışı, `swipe_screen`; `to` ile sürüklemeyi, `scale` ile kıstırmayı ve `pointers` ile serbest yolları içerir.
- `press_key`; düğmeleri (`back`, `home`, `app_switch`, `volume_up`, `volume_down`, `mute`, `siri`, `power`, `lock`), bir klavyenin tuşlarını (`enter`, `delete`, `tab`, `escape`, `space`, `arrow_up`, `arrow_down`, `arrow_left` ve `arrow_right` ok tuşları ve önce basılı tutulan tuşlarla bir harf ya da rakam, `command+a` gibi; Android'de `command` Ctrl'dir) ve `home`'un kapattığı `control_center`, `notification_center` ile `spotlight`'ı içerir. Bir tuşun adı büyük küçük harf fark etmeksizin okunur; `return` `enter`, `esc` `escape`, `backspace` de `delete`'tir. Bir harf küçük harftir, çünkü büyük bir harf aynı zamanda bir shift olurdu.
- `manage_app`; `list`, `state`, `install`, `uninstall`, `clear`, `grant`, `revoke`, `stop` ve bu Mac'teki bir projeden `build_and_run` içerir: `scheme` ve `configuration` ile bir Xcode projesi ya da modülü `scheme`, varyantı `configuration` olan bir Gradle klasörü. `install` tek bir dosyayı `path` olarak, ya da bir Android uygulamasının APK'sını `.dm` dosyaları ya da split APK'larıyla birlikte `files` olarak alır.
- `transfer_files`; bir uygulamanın verisini yeni ya da boş bir klasöre alan `pull`, bir klasörden koyan `push` (uygulamayı durdurur ve klasörde olmayanı kaldırır) ve `media` içerir.
- `set_device`; `orientation`, `location`, `clipboard`, `dark_mode`, `text_size`, `reduce_motion`, `increase_contrast`, `reduce_transparency`, `animations`, `locale`, `network`, `thermal`, `proxy`, `battery`, `airplane`, `wifi`, `mobile_data` ve `fold`'u; tek seferlik `biometric`, `call`, `sms`, `keychain`, `memory_warning` ve `shake`'i; ve değiştirileni geri koyan `restore`'u içerir. `dark_mode` iki platformda da ayarlandığı gibi okunur, `on` ya da `off`.

### Bir uygulamayı başlatmak

`launch_app` uygulamayı başlattığını mı, yoksa çalışan birini olduğu ekranda öne mi getirdiğini söyler; `restart`, `args`, `env` ya da `language` ile çalışan birini önce durdurur ve uygulamayı başlattığını mı, yeniden mi başlattığını söyler. iOS'ta uygulamayı başlatan bir açılış, ekranı durgunlaştıktan sonra 1 sn daha izler; o sırada toplu gelen, bir ilk açılış kâğıdı ya da yüklenen bir ızgara, beklenip 2 sn daha izlenir: yanıt onu gösterir. Cihazda olmayan bir uygulama iki platformda da `NOT_FOUND` olarak reddedilir; ipucunda `manage_app list` vardır. Başlarken sona eren bir uygulama, `read` ne olursa olsun ve hangi uygulama seçili olursa olsun, crash raporunun nedeni ve son günlük satırlarıyla `APP_NOT_RUNNING` ile reddedilir; nedenini söyleyen satır bütün verilir.

### Bir değişiklik geri okunur

Her değişiklik geri okunur: yanıt `changed`'i yalnızca cihaz sonra öncekinden başka okunduğunda söyler, `restore` da yalnızca yeniden eskisi gibi okunan için "geri konuldu" der. `text_size` iOS'ta kendi boyutlarından biridir, `extra-small`'dan `accessibility-extra-extra-extra-large`'a kadar; Android'de 0,25 ile 5 arasında bir ölçek ya da `default`: başkası, aldıklarıyla birlikte reddedilir. `set_device` `location`'ın sabitlediği bir konum da bir koşul gibi yazılır, böylece `restore` ve oturumun sonu onu gerçek konuma geri götürür.

## Önce kişiye sorulanlar

Bunlar bir kişinin isteyebileceği bir şeyi kaybettirir, bu yüzden her biri kişinin evet demesini bekler:

- `manage_app uninstall`: uygulama ve cihazda tuttuğu her şey
- `manage_app clear`: uygulamanın tuttuğu her şey
- `transfer_files push`: uygulamanın şu an tuttuğu her şey; yerini klasördeki veri alır
- `manage_app revoke`: uygulamaya verilmiş bir izin
- `manage_app grant`: yalnızca bir iPhone'da; orada `grant` izni "sor" durumuna sıfırlar ve kişinin daha önce verdiği yanıt kaybolur. Bir simulator'ınki ve Android'inki hiçbir şey kaybettirmez ve hiçbir şey sormaz
- `set_device keychain`: uygulamaların anahtar zincirinde tuttuğu her öğe

### Cihazın kendi denetimleri

Sistemin kendi güç, acil durum ya da silme denetimlerine bir girdi de sorar, çünkü bunlar cihazın kendisine etki eder. Girdi herhangi bir araçtan, `run_steps`'ten ya da bir flow'dan gelen bir dokunuş, hareket, kaydırma, uzun basış, yazma ya da tuş olabilir. Denetimler şunlardır:

- Android'de: güç menüsü (Kapat, Yeniden başlat, Acil durum) ya da hızlı ayarlardaki düğmesi, bir kilit ekranının acil araması, Ayarlar'ın sıfırlamaları ve tüm verileri silme ekranı, bir de sistemin sunduğu bir yeniden başlatma ya da sistem güncellemesi (Şimdi yeniden başlat, Şimdi güncelle)
- iOS'ta: Vazgeç'i dışındaki kapatma ekranı, güç düğmesinin kendine ait bir işareti olmayan Denetim Merkezi'nin herhangi bir yeri, bir de Ayarlar'ın Sıfırla ve Tüm İçerikleri ve Ayarları Sil'i
- ikisinde de: güç ya da yan tuşa 5 saniye içinde üçüncü basış; bu birçok telefonda yardım çağırır

Dokunuş nereye düşerse düşsün sistem uygulamasından, her dilde aynı kimliklerden ve İngilizce ve Türkçe sözlerden tanınırlar.

appdyno hiçbir cihazı yeniden başlatmaz, sıfırlamaz ya da silmez; `manage_simulator` `shutdown` ile kapattığı bir simulator ya da emulator dışında hiçbirini kapatmaz; geri kalanında yanıt bunu kişinin yaptığını söyler. Böyle bir ekranı okumak hiçbir şey sormaz, ondan çıkaran geri ve ana ekran tuşları da.

Bunların hiçbir şey sorulmadan yapılmasına yalnızca `--allow-power virtual` ya da `all` izin verir, asla `--allow-data-loss` değil.

### Aramalar, diller ve sözcükle basış

Bir arama da sorar: arama başlatan bir bağlantıyla (`tel:`, `telprompt:`, `facetime:` ya da `facetime-audio:`) `open_link` ve bir telefon uygulamasındaki (numara çevirici, arama ekranı ya da FaceTime, kişiler ve mesajlar uygulamaları ya da bir Android cihazın kendi varsayılan çeviricisi) bir dokunuş, tuş ya da metin ya da metni yalnızca bir telefon numarası olan bir iOS sistem uyarısının, her dilde, Vazgeç dışındaki bir düğmesine ya da Call veya Ara diyen bir düğmeye bir dokunuş. appdyno hiçbir arama başlatmaz; bunların seçeneği de `--allow-power`'dır.

Ayarlar'ı ya da tüm cihazı `launch_app` `language` ya da `set_device` `locale` ile İngilizce ve Türkçe dışında bir dile almak da sorar, çünkü sıfırlamaları ve silmesi o zaman hiçbir sözden tanınmazdı. `--allow-power` bunu sormadan geçirir.

Bir iPhone'da `inspect_app` `ax_press` her basışta sorar: bir öğeye yalnızca sözcükleri ya da kimliğiyle, ekranda bunlardan biri olup olmadığını söyleyecek bir yeri olmadan basar. `--allow-apps` ya da `--no-home` altında reddedilir, `--allow-power all` da hiçbir şey sormadan geçirir.

### Soru nasıl sorulur

Sunucu, istemcinin bunu yapabildiğini bildirdiği yerde istemcinin kendi sorusuyla, yani MCP elicitation ile sorar; istemci bunu bir 2025 revizyonunda `initialize`'da, 2026-07-28'de ise her istekte bildirir; soru cihazı, uygulamayı ve neyin kaybolacağını söyler. Model onu yanıtlayamaz.

Hayır yanıtında ya da kapatılan bir soruda hiçbir şey yapılmaz; yanıt, sorusuna evet gelmediğini söyler, asla bir kişinin reddettiğini değil: bir istemci kendi kendine yanıt verebilir; arayüzü olmadan çalışan biri, soruyu hiçbir kişiye göstermeden 9 ms'de hayır dedi. Her reddin ipucu, bir hayırınki de, bir kişinin buna önceden nasıl izin vereceğini aşağıdaki seçeneklerle söyler.

2026-07-28'de hiçbir istek istemciye geri gitmez, bu yüzden çağrı turunu soruyla bitirir ve istemci yanıtı çağrıyla geri getirir: çağrı durduğu yerde bekler, böylece aynı `run_steps` içinde ondan önceki bir adım yeniden yapılmaz; 5 dakika içinde gelmeyen bir yanıt hayır sayılır.

### Sorulacak kimse yoksa

Soramayan bir istemci `PERMISSION_REQUIRED` ve bir kişinin buna nasıl izin vereceğiyle reddedilir; `--http` üzerinden her istemci de öyle, bir 2026-07-28 istemcisi de: token'ı elinde tutan, kendisine sorulan soruyu kendisi yanıtlardı, bu yüzden orada bir çağıranın verdiği hiçbir yanıt bir kişinin evet'i değildir ve bunların yapılmasına yalnızca sunucunun kendi seçenekleri izin verir.

### Önceden izin vermek

Sunucunun komut satırındaki `--allow-data-loss virtual`, bunların simulator'larda ve emulator'larda hiçbir şey sorulmadan yapılmasına izin verir, `all` ise telefonlarda da. Bunu yalnızca bir kişinin sunucuyu kaydetmesi ayarlar: bir aracın hiçbir argümanı, adımı ya da dosyası evet yerine geçmez. Bir komut kendi terminalinde sorar ve yanıt olarak `--yes` alır; ikisi de yoksa yalnızca seçenek onun yapılmasına izin verir.

### Kurmak ve derlemek

`manage_app install` bunlardan biri değildir: önce bir uygulamayı kaldırmaz.

`manage_app build_and_run` da sorar; her seferinde ve her cihazda, çünkü bir projenin derlemesi kendi Gradle ya da Xcode betiklerini bu Mac'te çalıştırır: soru projenin adını verir. Sormadan derlemesine yalnızca sunucunun komut satırındaki `--allow-build` izin verir, `--allow-data-loss` asla; bu seçenek yokken istemci soramıyorsa reddedilir, projeyi bir kişi derler ve `manage_app install` derlemenin ürettiğini kurar. `path`, bu seçenek verilse de, sunucunun yazdığı klasörlerin içindeki bir projedir.

`manage_app install`, kurduğu uygulamayı dosyanın tuttuğu kimlikle adlandırır. `--allow-apps` ile `manage_app install` yalnızca listenin adlandırdığı bir uygulamayı, dosyanın tuttuğu kimlikle, cihaza bir şey ulaşmadan okuyarak kurar, başkasını da adlandırarak reddeder; `build_and_run` reddedilir, çünkü bir projenin ne derlediği derlenmeden bilinmez.

Android'de cihazın reddettiği bir kurulum nedenini ve bir kişinin ne yapabileceğini söyler: başka bir anahtarla imzalanmış bir uygulama `PERMISSION_REQUIRED`'dır, çünkü ona yer açan yalnızca uygulamanın tuttuğu her şeyi kaybettiren ve bu yüzden bir kişiye soran `manage_app uninstall`'dır; daha eski bir sürüm `INVALID_ARGUMENT`'tır; yer kalmaması, uygulamanın minSdk'sından eski bir Android ya da başka bir işlemcinin native kütüphaneleri `UNSUPPORTED`'dır.

`files` ile `manage_app install`, bir Android uygulamasının APK'sını `.dm` dosyalarıyla (Baseline Profile taşıyan dex metadata) ya da split APK'larıyla birlikte, `adb install-multiple` gibi tek bir session'da kurar ve telefonun sorularını tek bir dosyada olduğu gibi yanıtlar. Cihaza bir şey ulaşmadan önce farklı uygulamaların dosyalarını ve aralarında kendi adında bir APK olmayan bir `.dm`'yi (`app.dm`, `app.apk` ile gider) reddeder; cihaz onu atardı. Cihaz uygulamayı kurup bir uyarı verdiğinde, başka bir API aralığı için yapılmış bir `.dm`'de olduğu gibi, yanıt uyarıyı aktarır; Android 17 böyle bir `.dm`'yi reddeder ve ret bunu söyler. Bir iOS uygulaması tek bir `.app` ya da `.ipa`'dır: birden çok dosya `UNSUPPORTED` olarak reddedilir.

### Bir araç nereye yazar

Bir araç, çağıranın söylediği yere yalnızca sunucunun çalıştığı klasörün (diskin kökü ya da ev klasörü değilse), appdyno'nun durum klasörünün ya da `--allow-write` ile verilen bir klasörün içinde dosya yazar: `take_screenshot` `file`, `check_screen` `dir`, `record_session` `file` ve `dir`, `transfer_files` `pull` `path`, `capture_network` `save`, `run_flow` `file` ve `to`. Başka bir yerdeki yol `POLICY_DENIED` ile reddedilir. Bu, bir istemcinin yaptığı araç çağrısı için geçerlidir; komut satırına yazılan bir yol söylediği yere yazılır.

Listelenen sırlar yalnızca metinde gizlenir: bir ekran görüntüsü, bir `watchMs` şeridi ve bir video ekranı olduğu gibi gösterir; sır listelenmişse yanıtları bunu söyler.

### Soran bağlantılar

Seçili uygulamanın almadığı bir şemayla gelen bağlantı kişiye sorar: `open_link` bir web bağlantısını, Ayarlar'a giden bir bağlantıyı ve cihazın seçili uygulamada açılacağını söylediği ya da şemasını o uygulamanın açtığını söylediği bir bağlantıyı sormadan açar. Başkası sorar; örneğin uygulama seçili değilken `itms-services:`, `shortcuts:`, `sms:` ya da `mailto:`. Bir kişi bağlantılara önceden `--allow-urls` ile izin verir.

## Her platform neyi yapabilir

Bir platformun yapamadığı şey, nedeni söylenerek reddedilir (`UNSUPPORTED`):

| özellik                                  | Android                                                             | simulator                                                                                              | iPhone                                           |
| ---------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| ses düğmeleri                            | evet                                                                | evet (geri okumanın yolu yok)                                                                          | runner                                           |
| bir uygulamanın verisini silmek          | `pm clear`                                                          | container'ını boşaltır                                                                                 | geliştirme imzalı uygulamalar                    |
| imzalamadan okuma                        | gerek yok                                                           | gerek yok                                                                                              | `inspect_app` `ax_list`: sözcükler ve id'ler     |
| yerel görünümler (`read_screen` `views`) | sistemin dökümü, probe yok                                          | görünüm probe'u: `launch_app` `probe`                                                                  | hayır                                            |
| uygulama verisini indirmek, değiştirmek  | hata ayıklanabilir build'ler                                        | evet                                                                                                   | geliştirme imzalı uygulamalar                    |
| bir izni vermek, geri almak              | `pm grant`, `pm revoke`                                             | `simctl privacy`                                                                                       | sorulacak hale sıfırlar, sonra `answer_alert`    |
| başlatma ortamı                          | hayır: argümanlar intent extra'larıdır                              | evet                                                                                                   | evet                                             |
| karanlık mod, metin, hareket, kontrast   | evet                                                                | evet                                                                                                   | `devicectl`                                      |
| saydamlığı azaltma                       | hayır: bulanıklıkları bir geliştirici seçeneğidir                   | evet                                                                                                   | `devicectl`                                      |
| animasyonlar                             | evet                                                                | hayır: `reduce_motion` kullanın                                                                        | hayır                                            |
| dil                                      | uygulama başına, API 33+; altında bütün cihaz                       | uygulama başına; `app ""`: bütün simulator                                                             | uygulama başına, aracın başlattıkları            |
| yavaş ağ, ısıl durum                     | emulator; bir telefonun indirmeleri, 13+                            | hayır                                                                                                  | Xcode'un koşulları                               |
| biyometri                                | bir emulator'ın parmak izi                                          | evet                                                                                                   | hayır: `devicectl` hiçbirini taklit etmez        |
| uçak modu, Wi-Fi, mobil veri             | evet, geri okunur                                                   | hayır: Mac'in ağını kullanır                                                                           | hayır                                            |
| anahtar zinciri                          | hayır: Android'de yok                                               | boşaltılır, sayılır                                                                                    | hayır                                            |
| katlanma duruşu                          | katlanabilir bir cihaz, API 31+: listelediği her duruş, geri alınır | iki ekranlı bir simulator (iPhone Duo, Xcode 27.1+): closed, half, open, geri alınır; diğerleri: hayır | hayır                                            |
| gelen arama, SMS                         | yalnızca emulator                                                   | hayır: telefon hizmeti yok                                                                             | hayır                                            |
| pil seviyesi                             | evet                                                                | hayır: yalnızca bir tane çizer                                                                         | hayır                                            |
| proxy                                    | evet, geri alınır                                                   | Mac'inkini izler                                                                                       | hayır: Wi-Fi ayarlarında                         |
| bellek uyarısı                           | uygulamanınkinin üstünde bir trim düzeyi                            | oradaki her uygulama, çağrı başına bir                                                                 | `devicectl` (henüz bir telefonda çalıştırılmadı) |
| sallamak                                 | bir emulator'ın ivmeölçeri                                          | evet                                                                                                   | hayır: yalnızca elle                             |
| kitaplığa fotoğraf ve video              | gönderilir, taranır, `restore`'da çıkarılır                         | `simctl addmedia`, silme yok                                                                           | hayır                                            |
| arka planda bir son                      | `am kill`                                                           | işleminin SIGKILL'i                                                                                    | `devicectl` (henüz bir telefonda çalıştırılmadı) |

API 37'yi hedefleyen bir Android uygulaması bu Mac'e, bir emulator'dan `10.0.2.2` üzerinden, ya da yerel ağa yalnızca `ACCESS_LOCAL_NETWORK` izniyle ulaşır: o olmadan istekleri takılı kalır, `measure_performance snapshot` ve `capture_network` de 0 bayt sayar.

## Push bildirimleri

`send_push` uygulamaya `type`'a göre bir push gönderir: alanlardan (`title`, `body`, `image`, `data`) ya da platformun kendi JSON'u olan `payload`'dan; iOS'ta APNs'inki, Android'de bir FCM mesajı. İkisi birden verilirse reddeder. Bir push her zaman uygulamanın kendisinindir: hiçbir şey bir bildirimi uygulamanınkinden başka bir adla göstermez; uygulamaya bir push verilemeyen yerde `send_push` neye ihtiyacı olduğunu söyleyerek reddeder.

Tür ve başka hiçbir şey verilmezse bu cihazın kabul ettiği her türü, izlediği yolu ve orada aldığı alanları, göndereceği payload'un bir şablonuyla ya da neden gönderemeyeceğiyle yanıtlar; `data`'sı aynısını `types` olarak tutar; orada APNs ya da FCM üzerinden giden bir yol, dayandığı token türlerini `tokens` içinde adlandırır; bunları bir kişi bir pencereye yazabilir. Türü olmayan bir `title` ya da `body`, cihazın bir `alert` aldığı yerde onun olarak gider ve yanıt bunu söyler; almadığı yerde, ve türü olmadan tek başına `image`, `data` ya da `payload` için, giden türleri adlandırarak reddeder. Bir push, bir işlem gibi, sonraki ekranla yanıtlanır.

| tür           | Android emulator'ı ve telefon                                                             | simulator                                                                                              | iPhone                                                            |
| ------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| alert         | aşağıdaki gibi FCM'in kendi mesajı ya da kurulduktan sonra FCM                            | `simctl push`: uygulama öndeyse uygulamanın kodu alır, değilse yalnızca bir dokunuşta                  | kurulduktan sonra APNs                                            |
| rich          | alert gibi, bir bağlantıyla gelen bir görselle                                            | kurulduktan sonra APNs'in sandbox'ı; `simctl push` hiçbir Notification Service Extension çalıştırmaz   | kurulduktan sonra APNs                                            |
| background    | aşağıdaki gibi FCM'in kendi veri mesajı ya da kurulduktan sonra FCM, yalnızca veri olarak | kurulduktan sonra APNs'in sandbox'ı; `simctl` görülecek bir şeyi olmayan bir push'u reddeder           | kurulduktan sonra APNs                                            |
| live_activity | background push gibi, uygulamanın kendi Live Update'ini yapması için                      | kurulduktan sonra APNs'in sandbox'ı; `simctl push` bir bildirim yapar, bunu hiçbir Live Activity almaz | kurulduktan sonra APNs                                            |
| voip          | hayır: bir iOS push'u                                                                     | kurulduktan sonra APNs'in sandbox'ı, VoIP bildiren bir uygulama için; `simctl` hiçbirini almaz         | kurulduktan sonra APNs, VoIP bildirdiği bilinen bir uygulama için |
| widgets       | hayır: bir iOS push'u                                                                     | kurulduktan sonra APNs'in sandbox'ı, iOS 26'dan itibaren; `simctl` hiçbirini almaz                     | kurulduktan sonra APNs, iOS 26'dan itibaren                       |
| tapped        | launcher activity ya da `click_action`'ınki, veri extra'lar olarak                        | hayır: `simctl` hiçbir şeye dokunmaz                                                                   | hayır: yalnızca bir kişinin dokunuşu                              |

`tapped` hiçbir şey çizmez. Uygulama arka plandayken dokunulan bir push için [Firebase'in belgelediği](https://firebase.google.com/docs/cloud-messaging/android/receive) şeydir, "the data payload is delivered in the extras of the intent of your launcher Activity": aktivite, Firebase'in kendi dokunuşunun açtığı gibi, uygulamanın görevinin üstünde yeniden açılır.

Gerçek bir iPhone push'u yalnızca Apple'ın sunucularından, bir kişi APNs'i [Apple ve Google üzerinden bir telefona ve bir simulator'a push](#apple-ve-google-üzerinden-bir-telefona-ve-bir-simulatora-push) bölümündeki gibi kurduktan sonra alır. O zamana kadar uygulamanın deep link'iyle `open_link`, o bağlantıyı taşıyan bir push'un ulaşacağı koda ulaşır ya da push'u bir simulator alır. Xcode 27.1'in `devicectl`'inin kendine ait bir push'u yoktur: `devicectl device notification post`, yardımında yazdığı gibi, yalnızca adıyla bir Darwin bildirimi yayımlar, bu bir push değildir. Anahtar olmadan Apple'ın Push Notifications Console'u, ekibin hesabıyla oturum açılmış bir tarayıcıdan, uygulamanın yazdırdığı token'a bir push gönderir, [Apple'ın gösterdiği gibi](https://developer.apple.com/videos/play/wwdc2023/10025/): appdyno onu yönetemez ve bu denenmedi.

Bu cihazın ya da uygulamanın derlemesinin alamadığı bir tür nedeniyle reddedilir; ipucu orada hâlâ çalışan türleri adlandırır, örneğin `tapped`.

### Bir simulator'da uygulamanın koduna ne ulaşır

Bir simulator'da yanıt, uygulamanın koduna neyin ulaştığını, push anında uygulamanın nerede olduğuna göre söyler; bu, push'tan hemen önce okunur: öndeyse kodu alır; arka plandaysa ya da çalışmıyorsa push yalnızca gösterilir ve kod onu banner'ına dokunulduğunda alır. Bildirimlerine kimsenin izin vermediği bir uygulama hiç bildirim göstermez ve `simctl` başarısız olur ("Source is not authorized"); yine de öndeki bir uygulama push'u kodunda alır: yanıt o durumda bunu söyler; uygulama önde değilse `send_push` bildirimlere nasıl izin verileceğini söyleyerek reddeder.

Bir simulator `simctl push` için hiçbir Notification Service Extension çalıştırmaz, bu yüzden rich bir push uygulamanın koduna değişmeden ulaşır; `simctl push` bir uygulamanınkinden başka topic de almaz, bu yüzden bir Live Activity'nin push'u activity'ye hiç ulaşmaz. Apple bu push'ları bir simulator'da APNs'in sandbox'ı üzerinden, macOS 13 ya da sonrasında Apple silicon ya da T2'li bir Mac'ten, activity'nin kendi push token'ıyla test eder. Yani rich bir push, bir background push, bir Live Activity'ninki, bir VoIP push'u ve bir widget'ınki bir simulator'a yalnızca APNs'in sandbox'ından, uygulamanın ekibinin bir anahtarıyla ulaşır: bir kişi aşağıdaki gibi bir anahtar kurduktan sonra `send_push` onları oraya gönderir; o zamana kadar her ret bunu söyler.

### Android'de FCM'in kendi mesajı, proje ve anahtar olmadan

Firebase Messaging içeren bir Android uygulaması bir alert'i, rich bir push'u, bir background push'u ve bir Live Activity'ninkini, Firebase projesi ve anahtar olmadan FCM'in kendi mesajı olarak alır. `send_push`, Google Play hizmetlerinin bir uygulamaya verdiği `com.google.android.c2dm.intent.RECEIVE` broadcast'ini, Firebase Messaging SDK'sının bildirdiği `com.google.firebase.iid.FirebaseInstanceIdReceiver` alıcısına, SDK'nın okuduğu extra'larla, [kaynağında](https://github.com/firebase/firebase-android-sdk/tree/main/firebase-messaging) olduğu gibi gönderir: verildiği haliyle veri, `gcm.n.` altında bir bildirim, her push için yeni bir `google.message_id`, FCM'in kendi payload'u `NORMAL` demedikçe yüksek olan öncelik ve collapse key'i.

Alıcı yalnızca sistemi, root'u ve uygulamanın kendisini içeri alır, bu yüzden `send_push` onu hata ayıklanabilir bir build'de `run-as` ile, uygulamanın kendi uid'i olarak, ya da adbd zaten root olarak çalışıyorsa root olarak gönderir; bunu sağlamak için adbd'yi asla yeniden başlatmaz. Shell'in kendi uid'inden bir broadcast sessizce atlanır. Alıcının sonucu mesajı aldığını söyler: hiçbir şey almayan reddedilir, çünkü zorla durdurulmuş bir uygulama FCM'den de hiçbirini almaz.

SDK sonra Google'dan gelen bir mesaj için yaptığını yapar: bir veri mesajı uygulama nerede olursa olsun `onMessageReceived`'e gider ve uygulama çalışmıyorsa onu başlatır; bir bildirim, uygulama öndeyse verisiyle `onMessageReceived`'e gider, değilse SDK onu uygulamanın adı ve simgesiyle, kendi kanalında çizer; orada bir dokunuş, [Firebase'in belgelediği gibi](https://firebase.google.com/docs/cloud-messaging/android/receive), uygulamayı veriyle açar; böyle bir dokunuş denenmedi ve `tapped` uygulamayı aynı şekilde açar.

Uygulamaya bildirim izni verilmediğinde yanıt bunu söyler, çünkü SDK o zaman hiçbir şey çizmez. Tür verilmezse `send_push` ve bir pencerenin Bildirim paneli, adı verilen uygulama için her türün izlediği yolu, build'inden okuyarak adlandırır; liste de bir push gibi izin listesinden geçer. FCM kurulduğunda bu push'lar onun yerine Google'ın sunucularından gider.

Denenmeden kalanlar: Google'ın sunucuları hiçbir şey taşımaz, bu yüzden onların teslimatı, Doze'un ertelemesi, bir TTL ya da gönderimler arası bir collapse ve bir token'ın geçerliliği denenmez; `from` alanında da `appdyno` yazar, bu yüzden onu kendi gönderen kimliğine karşı denetleyen bir uygulama mesajı geri çevirir. Bir görsel, SDK'nın indirdiği bir bağlantıyla gider.

FCM'in kendi adı olan bir veri anahtarı, `from`, `notification`, `message_type`, `collapse_key` ya da `google` veya `gcm` ile başlayan biri, FCM'in reddettiği gibi reddedilir. Uygulamada, bir push'un bir Android uygulamasının koduna ulaşmasının tek yolu olan Firebase Messaging yoksa bunların her biri reddedilir ve yanıt bunu söyler; adbd'si root olmayan bir telefonda bir release build ise her biri, onu neyin alabileceği söylenerek reddedilir: hata ayıklanabilir bir build ya da `appdyno push setup fcm` ile kurulmuş FCM.

Android'in inbox, messaging ya da media gibi bir stili ayrı bir push değildir: bir uygulama onu koduna verilenden çizer, bu yüzden onun push'u, o kodun okuduğu veriyle `background`'dır.

### Apple ve Google üzerinden bir telefona ve bir simulator'a push

Yalnızca Apple'ın ya da Google'ın sunucularının teslim ettiği şey, bir kişi bu Mac'in bir terminalinde onların kimlik bilgilerini kurduktan sonra onlar üzerinden gider: `appdyno push setup apns` ekibin APNs anahtarını, `.p8` dosyasını, anahtar kimliğini, ekip kimliğini ve bir dağıtım build'inin production'dan push alıp alamayacağını sorar; `appdyno push setup fcm` bir Firebase service account'unun JSON dosyasını sorar. Her biri durum klasöründe, `push/apns.json` ya da `push/fcm.json` olarak, yalnızca bu kullanıcının okuyabileceği biçimde (mod 0600, mod 0700 olan bir klasörde) saklanır ve `--forget` onu siler. Bir MCP istemcisinin gönderdiği hiçbir şey bunları ayarlamaz, okumaz ya da silmez: istemciye yalnızca birinin kurulu olup olmadığı söylenir. İki komut da terminal olmadan çalışmaz ve hiçbiri bir anahtarı, bir kimliği ya da bir token'ı geri söylemez.

APNs kurulduğunda `send_push`, bir simulator'ın rich, background, Live Activity, VoIP ve widget push'larını, kabloyla bağlı bir iPhone'a da bunların her birini ve bir alert'i APNs üzerinden, şu denetimlerin arkasında gönderir:

- **Host'lar.** Kodda yazılı `api.sandbox.push.apple.com` ve `api.push.apple.com`, başkası değil; bir simulator yalnızca sandbox'ınkini alır. Bir istek node'un `http2`'siyle, node'un `crypto`'suyla imzalanmış, 40 dakika tutulan bir ES256 provider token'ıyla gider, çünkü Apple 20 dakikada birden sık yapılanı ve 60 dakikadan eskisini reddeder.
- **Token.** Yalnızca bu aracın bu oturumda, cihazın kendi logunda uygulamanın kendi satırlarından okuduğu ya da bir kişinin pencereye yazdığı bir token; bir MCP istemcisinin gönderdiği hiçbir şey token değildir. Bir simulator'da satırlar, oturumun başından itibaren yalnızca uygulamanın sürecine ait `log show` satırlarıdır.
- **Bir iPhone'da.** Bu araç orada çalışan hiçbir uygulamanın logunu okumaz, bu yüzden token'ı olmayan bir push uygulamayı `devicectl device process launch --console` ile yeniden başlatır (uygulamanın `os_log` ve `NSLog` çıktısı, Xcode altındaki gibi o konsola düşer) ve yazdırdıklarını en çok 15 s boyunca okur: bunu yalnızca o zaman yapar ve yanıt uygulamanın yeniden başlatıldığını ve durumunu kaybettiğini söyler. Konsol, sonradan yazdırılan bir token için oturum boyunca izlenir ve SIGKILL ile bırakılır; devicectl bunu, yakaladığı bir sinyali uygulamaya ilettiği gibi iletemez. Telefonun kendi logunu geliştirici servisleri üzerinden okumak yeniden başlatmayı gereksiz kılardı; bu sonraki bir iyileştirmedir.
- **Bir token neye benzer.** Bir token, 32 bayt ya da daha uzun bir hex'tir ve token'dan söz eden bir satır varsa öyle bir satırdan alınır, çünkü bir uygulamanın logunda aynı uzunlukta başka hex'ler de vardır; satırın sözcükleri onun hangisi olduğunu söyler: push to start, bir activity, VoIP (ya da PushKit) ya da bir widget anan bir satır o token'ı verir, diğer her satır cihaz token'ını. Uygulama onu `NSLog` ya da `os_log` ile yazdırır; token'ı olmayan bir push bunu ve nasıl yapılacağını söyler. Apple'ın geçersiz ya da artık kayıtlı değil dediği bir token atılır ve sonraki push uygulamanın satırlarını yeniden okur. Hiçbir yanıt, hata ya da log bir token'ı, anahtarı ya da provider token'ı söylemez: bir token türüyle ve okunduğu zamanla adlandırılır.
- **Uygulama.** Topic, adı verilen ve o cihaza kurulu uygulamadır ve token o uygulamadandır. Bir iPhone'da build'in imzası ve Info.plist'i yalnızca bu aracın `manage_app install` ya da `manage_app build_and_run` ile kurduğu bir build'den okunur: telefondaki hiçbir şey bunları vermez.
- **Ortam.** Sandbox; ancak bir iPhone'da, bu aracın kurduğu bir build'in imzasından dağıtım build'i olduğu bilinen ve kurulumda production açılmış bir uygulama için production. İmzası burada okunamayan bir uygulama sandbox'a gider, asla production'a değil; bir host'ta reddedilen bir push asla diğerine gitmez: `BadDeviceToken`'da yanıt, token'ın diğer ortam için olabileceğini ve bir kişinin ne yapabileceğini söyler. Bir sandbox push'u hiçbir production build'ine ulaşmaz, bu yüzden onunla hiçbir şey kaybedilmez.
- **Payload.** En çok 4 KB, VoIP için 5, `aps` bir nesne olmak üzere. Her türün APNs push türü, topic eki ve önceliği vardır: `alert` ve `rich` `alert` olarak, öncelik 10; `background` öncelik 5 ile; `live_activity` `.push-type.liveactivity` üzerinde `liveactivity` olarak; `voip` `.voip` üzerinde, yalnızca VoIP bildirdiği bilinen bir uygulama için; `widgets` `.push-type.widgets` üzerinde, iOS 26'dan itibaren. `apns-expiration` 0'dır: bir push ya şimdi teslim edilir ya hiç. Bir Live Activity'nin payload'u ActivityKit'inkidir: `event` start, update ya da end, uygulamanın `ContentState`'i olarak `content-state`, bir tane başlatmak için de `attributes-type`, `attributes` ve bir alert; `timestamp` verilmezse doldurulur; start push-to-start token'ıyla, update ve end activity'ninkiyle gider.
- **Hız.** Bir cihaza dakikada en çok 10, çağrı başına bir push.
- **Yanıtlar.** Apple'ın nedeni, bir kişi için sözcüklerle: `BadDeviceToken`, `TopicDisallowed`, `ExpiredProviderToken` ve Apple'ın listelediği diğer her biri.

FCM kurulduğunda `send_push`, bir Android cihazın alert, rich, background ve Live Activity push'larını FCM üzerinden gönderir: alert ve rich push `image` ile bir bildirim olarak, background push ve Live Activity'ninki uygulamanın kendi kodu için yalnızca veri olarak (Live Update, uygulamanın bir veri mesajından kurduğu kendi bildirimidir); FCM'in kendi `message`'ı olan payload aksini söylemedikçe yüksek öncelikle ve 0 TTL ile, yani ya şimdi ya hiç teslim edilecek biçimde. `tapped` yukarıdaki gibi kalır. Aynı türden denetimlerin arkasında:

- **Host.** Kodda yazılı `fcm.googleapis.com`, başkası değil: service account, Google'ın "service account authorization without OAuth" belgesinin anlattığı gibi FCM'in audience'ı için kendi RS256 token'ını imzalar, bu yüzden başka bir host'tan token alınmaz. FCM'in HTTP v1 API'sinin böyle bir token'ı kabul edip etmediği canlı bir gönderime kadar doğrulanmamıştır; kabul etmezse token onun yerine Google'ın token endpoint'inden, kodda yazılı ikinci bir host'tan gelir.
- **Token.** Uygulamanın bu oturumda, şu an çalışan sürecinin kendi logcat'ine (`getToken` ya da `onNewToken` ile) yazdırdığı bir registration token ya da bir kişinin pencereye yazdığı bir token; asla bir MCP istemcisinin gönderdiği değil. FCM'in artık geçerli değil dediği bir token atılır ve sonraki push uygulamanın logunu yeniden okur.
- **Uygulama.** O cihaza kuruludur ve payload kendine ait bir token, topic ya da koşul adlandırmaz: bir mesaj uygulamaya yalnızca bu cihazda ulaşır.
- **Payload.** En çok 4 KB, verisi yalnızca string'lerden oluşur; bir cihaza dakikada 10; FCM'in hata kodları sözcüklerle, hiçbiri bir anahtarı ya da token'ı anmadan.

Apple'a ve Google'a giden istekler, her birinin belgelediği biçimde kaydedilmiş isteklere karşı, Apple'a gönderim de yerel bir HTTP/2 sunucusuna karşı test edilir; hiçbir test ikisine de ulaşmaz. Denemelerde henüz hiçbir push Apple'ın ya da Google'ın sunucularından geçmedi: bu, bir ekibin anahtarını, bir projenin hesabını ve bir telefonu bekliyor. Neyin hangi cihazlarda çalıştırıldığı [Araçlar nasıl test edildi](tools-tested.tr.md#push-bildirimleri) sayfasındadır.

## Bağlantılar

Bir uygulamanın kimliğiyle `open_link` `links`, kurulu uygulamadan okuyarak onun açtığı bağlantıları listeler: bir simulator'da URL şemalarını ve imzasının universal link'ler için adını verdiği alan adlarını, Android'de bir bağlantıyı görüntüleyen her filtreyi `scheme://host/path` olarak ve her App Link alan adını Android'in doğrulama durumuyla. `data.links` alanı aynısını tutar; her biri `url`'i, `kind`'ı (`scheme`, `domain` ya da `filter`) ve Android'in doğruladığı yerde bir alan adının `state`'i ile, bir istemcinin sunması ya da tek tek geçmesi için. Bir iPhone'un kurulu uygulaması okunmaz.

Android'de bir bağlantı seçili uygulamaya, orada tutularak gider; `--allow-apps` yoksa o uygulamanın açmadığı bir web bağlantısı onu açan uygulamaya, çoğu zaman bir tarayıcıya gider ve yanıt, uygulamanın onu açmadığını söyler. Hiçbir uygulamanın tutmadığı bir web bağlantısı, ekranda bir web sayfası ya da başka bir uygulama olunca ve ekran artık bağlantının gönderildiği ekran olmayınca yanıtlanır, çünkü tarayıcı, cihaz bağlantıyı aldıktan bir an sonra öne gelir; 3 sn içinde ikisi de gelmediyse yanıt bunu söyler.

### Bir bağlantı ne zaman açılmış sayılır

`open_link`, yalnızca bağlantının bıraktığı ekranın üstünde bir sistem uyarısı yoksa `opened` der; o ekranı kıpırdamadan durunca, en çok 5 s içinde okur, çünkü bir bağlantının başlattığı uygulama öne geldikten sonra da çizmeyi sürdürür; bir işlem 3 s bekler.

Bir simulator, bir uygulamanın şeması onu ilk kez açmadan önce "Open in …?" diye sorar ve bu yanıtlanana kadar hiçbir şey açılmaz. Seçili uygulamanın kendi şemasındaki bir bağlantı, o uygulama öne gelene kadar, en çok 15 s izlenir ve sorusu, o uygulamayı adlandıran tek bir satırsa, yolda yanıtlanır; böylece tek çağrı uygulamanın ekranıyla yanıt verir ve onu yanıtladığını söyler. Zaten önde olan uygulamanın üstüne gelen soru bir saniye izlenir. Bir soruyu yanıtlayan dokunuş, simulator'ın yardımcısı göndermediğinde runner ile gider ve runner Open'a dokunmadan önce soruyu kendisi okur, böylece soruyu dikeyde olduğu gibi yatayda da yanıtlar.

Başka bir soru bırakılır ve yanıt o zaman uyarının sözcükleri ve düğmeleriyle `sent` der ve onu `answer_alert` ile yanıtlamayı söyler. `read: none` ile hiçbir şey okunmaz ve `opened` der.

### Sistem uyarıları

Ekranı okuyan her yanıt, üstündeki bir sistem uyarısını böyle adlandırır, bir Android uygulamasının crash penceresini ("keeps stopping") de, yanıtlamak için `answer_alert` ile; yataydaki bir iOS cihazında uyarı, onu çizen ana ekran uygulaması pencerelerini dik tutsa da ekranın onu gösterdiği yerde okunur. `answer_alert`'in bir uygulamanın üstündeki bir iOS uyarısına yanıtı ve böyle bir uyarıyı kapatan bir `tap_screen`, `count: 2` ya da `holdMs` ile de, o uygulamayı yeniden öne gelince okur: uyarı giderken ana ekran uygulaması bir an önde durur ve yalnızca uygulamanın kartını gösterir.

### Ayarlar sayfaları

`open_link` `settings`, bir kişinin her yere gidebildiği, kendi başına bir uygulama olan Ayarlar'ı açar: `--allow-apps` ile onu, bir sayfasında ya da bir uygulamanınkinde, yalnızca Ayarlar'ın kendi kimliği listedeyse açar, iOS'ta `com.apple.Preferences`, Android'de `com.android.settings`; yoksa `POLICY_DENIED` ile reddeder ve bir kişinin onu nasıl ekleyeceğini söyler. Ayarlar'ı açan bir `url` bağlantısı da aynı kurala bağlıdır: iOS'un `App-prefs:`, `prefs:`, `app-settings:` ve `settings-navigation:` bağlantıları, Android'in `package:` ve `android.settings.…:` bağlantıları. Bu cihazda olmayan bir sayfa, bu cihazın sayfalarıyla, yanlış bir sözcük olarak reddedilir.

## Simulator'da ağ

Simulator'da `capture_network` probe üzerinden çalışır.

### Bir yakalama başlatmak

`bodies` ile `start`, her isteğin başlıklarını ve metin gövdelerini, her biri 64 kB'ye ve yakalama başına 20 MB'ye kadar, durum klasörünün altında yakalamanın kendi klasöründe, yalnızca bu kullanıcı için tutar; `stop` ile ve oturumun sonunda silinirler.

### İstekleri okumak

Bütün isteklerin bir `read` çağrısı katlanmış gelir: önce başarısız ve reddedilen istekler, her biri bütün olarak; her ana makine bir kez, altında her yöntem ve yol bir kez, sorgu adlarıyla, yinelenenler sayıları, durumları ve ortanca süreleriyle tek satırda; görseller sayılmış olarak. `contains`, `method` ya da `status` (`404`, `4xx`, `failed`) her isteğe kendi satırını verir. Her yanıt son kimliği söyler; `after` yalnızca bir kimlikten sonra başlayanları verir. Başlamış ve bitmemiş bir istek listenin ardından `in flight` olarak durur.

`id` ile `read` tek bir isteğin tamamını verir: oturumun ölçtüğü protokol, adres ve aşamalar (uygulamanın değil, probe'un kendi bağlantısı), ardından başlıklar ve gövdeler; Authorization, Cookie, Set-Cookie ile kimlik bilgisi adı taşıyan başlıklar ve alanlar gizlenir.

`save`, isteneni aynı biçimde temizlenmiş olarak HAR 1.2 biçiminde yazar; klasörsüz bir ad `appdyno-network/` altına gider.

### Mock kuralları

`mock` kuralları koyar: `*` ile `host/path` ya da yol için `regex=`, `method=`, `query=`; ardından `status=`, `type=`, `header=`, `body=` (sunucunun klasörü içinde `body=@file`) ya da `fail=offline|timeout|reset` ya da bu Mac'te veya onun kendi ağında bir ana makineye `to=` (başkası için `--allow-urls` gerekir; yalın bir `localhost`, `http://127.0.0.1` demektir); `delayMs=`, `times=` ve `off` ile birlikte. Verilen kurallar listenin yerini alır, `add` listeye ekler, `[]` temizler, hiçbiri verilmezse her birinin aldıklarıyla listelenir.

### Yavaşlatma

`throttle` şunları alır: `full`, `slow`, `gsm`, `gprs`, `edge`, `umts`, `3g`, `hsdpa`, `lte`, `offline`, saniyede indirilen bayt ya da `delayMs= down= up= loss=`.

### Mock ve throttle'ın ulaştıkları

İkisi de çalışan bir yakalama yoksa probe ile bir yakalama başlatır, bu da uygulamayı yeniden başlatır; ikisi de `stop` ile biter. Yalnızca uygulamanın URLSession isteklerine ulaşırlar: arka plan oturumlarına, WKWebView'a ya da Network.framework'e ulaşmazlar ve sistem Mac'in ağını olduğu gibi okumayı sürdürür. Probe içindeyken uygulamanın bir sunucunun sertifikasına ilişkin kendi denetimi (pinning) ile bir oturum açma ya da istemci sertifikası sorgusuna verdiği yanıtlar sorulmaz. Simulator'da `set_device network` reddedilir ve `capture_network throttle` adını verir.

### Bir işlemin yanıtında başarısız istekler

Probe ile bir yakalama çalışırken, bir eylemin yanıtı o eylem başladığından beri başarısız olan istekleri, her biri bir satırda ve en çok üç satırla söyler: `network: POST api.example.com/v1/pay 500 (id 44)`. Sunucunun reddettiği (4xx, 5xx) ya da yolda başarısız olan istek sayılır; uygulamanın vazgeçtiği sayılmaz. Son yanıttan sonra biten istek bir sonraki eylemle söylenir ve `before this action` der. `strict` (`start`, `mock` ya da `throttle` ile), bir kuralın yapmadığı 5xx ya da yol hatasında eylemi `CHECK_FAILED` ile başarısız kılar.

### Bir isteği beklemek

`check`, `contains`, `method`, `status` ve `has` ile uyan, bitmiş bir isteği `timeoutMs` (5 s) kadar bekler ve satırını yanıtlar. `has`, JSON bir gövdede yoluyla verilen bir değerdir (`user.name=Grace`) ya da gövdenin herhangi bir metni; isteğin gövdesinde aranır, başına `response:` yazılırsa yanıtın gövdesinde. `bodies` ister. Bulunamazsa `CHECK_FAILED` olur, en yakın isteği ve neyin farklı olduğunu söyler. `after`, eylemden önceki bir isteği dışarıda tutar. `read`, `paths` ve `check` cihazda sıra beklemez.

### Gövdeye ve başlığa göre, bir de yakalamadan kurallar

Bir kural isteği `has=` (isteğin gövdesi, yukarıdaki gibi) ve `when="Name: value"` (bir başlık, değerde `*`) ile de alır; böylece tek bir GraphQL adresi her işlemi ayrı yanıtlar.

`from` ile `mock`, yakalanmış bir isteğin yanıtından kimliğiyle bir kural yapar; gövdesi kimlik bilgileri gizlenerek `appdyno-network/` altındaki bir dosyaya yazılır. Bir `.har` verilirse içindeki her yanıt için bir kural yapar. `from` ile yapılanlar kurallara eklenir.

`unmatched: fail`, hiçbir kuralın almadığı her isteği başarısız kılar.

### Tek değer, biçim, fark

`id` ve `path` ile `read`, yanıt gövdesinden tek bir değer verir (isteğinki için başına `request:`); `shape` değerler olmadan anahtarları ve türleri, `diff` ise başka bir istekten adres, durum, sorgu ve gövdelerde neyin farklı olduğunu verir. `read`, uygulamanın yaptığı ama probe'un göremediği şeylerle biter: `not seen here: 1 web view, 1 background session, 1 WebSocket task`.

### Sınırlar

Sınırlar: bir WebSocket görevi sisteme bırakılır, bu yüzden probe yokken olduğu gibi açılır ve listede görünmez; akış olarak gönderilen bir istek gövdesi `has=` ve `bodies` için yalnızca 64 kB'ye kadar ve yalnızca uzunluğunu belirttiğinde okunur.

Kaynaklardan, burada denenmedi: Server-Sent Events bitene kadar yolda görünür; kendi taşıması üzerinden gRPC ve AVPlayer'ın yüklediği medya görünmez; React Native'in `fetch`'i URLSession'dır ve görünür, WebSocket'i görünmez; Flutter'ın `dart:io`'su görünmez, `cupertino_http` kullanan bir uygulama görünür.

Probe altında istekler varsayılan yapılandırmanın tek bir oturumundan geçer; bu yüzden bağlantı sınırları, HTTP/3 seçimi ve önbellek uygulamanınkinden farklı olabilir.

## Loglar ve crash'ler

### Hangi log okunur

`read_logs` Android'de uygulamanın logcat'ini, bir simulator'da simulator logunu okur. Bir iPhone için `devicectl` çalışan bir uygulamanın logunu okuyamaz ve yanıt bunu söyler. Bir simulator'da, `debug`'ın altında, uygulamanın kendi satırlarını, aralarında `NSLog`'unkileri, Apple'ın çerçevelerinden de yalnızca hatalarını okur; bir simulator'ın klavyesinin çizilirken logladığı binlerce satır bunun dışındadır. `debug` uygulamanın sürecinin hepsini okur. XCTest'in orada logladığı hiç okunmaz: appdyno'nun runner'ı ekranı uygulamanın içinden okur ve dokunur.

### Satırlar nasıl gösterilir

Birkaç satırlık bir ileti yanıtın tek satırıdır ve `limit` hiçbirinin ortasından başlamaz. Her satırın yinelediği şey ilk satırın altındaki bir satırda bir kez söylenir (`every line: 11-15, pid 6178, left out below`): gün ve hepsini tek bir süreç yazdıysa süreç; böylece bir satır saatiyle başlar. Gece yarısını aşan bir log günlerini, iki sürecin logu süreçlerini korur.

### Süzme: `contains` ve `since`

`contains`, sözcüklerini büyük küçük harf fark etmeksizin taşıyan satırları tutar; eşleşme gizli değerler saklandıktan sonra yapılır. `since`, burada da `source: crashes` ile de, bir ISO 8601 zamanı ya da ne kadar önce olduğudur: `30s`, `5m` ya da `2h`. `since` verilmezse son işlemin başladığı andan okur, çünkü bir push'un ya da bir dokunuşun tetiklediği şey o sürerken loglanır.

Android'de uygulamanın sürecini ve ölen son sürecini, exit info'nun verdiği pid ile okur. Sistem çöken bir süreci hemen bitirip uygulamayı yeniden başlatabilir ya da onu, pid'iyle birlikte, "keeps stopping" ("sürekli olarak duruyor") penceresi yanıtlanana kadar tutabilir; bir emulator da bir Xiaomi REDMI 15C de böyle yaptı: appdyno böyle tutulan bir süreci crash olarak okur. Her iki durumda da crash'in kendi satırları ondan sonra da okunur.

### Crash'ler

`source: crashes` ile `read_logs`, sistemin uygulama için tuttuğu crash kayıtlarını (Android exit info ve dropbox, simulator'ın DiagnosticReports'u, bir iPhone'un sistem crash logları) sınırlı bir özet ve bir dosya yolu olarak toplar.

Her simulator'ın raporları tek bir klasördedir, bu yüzden bir simulator'ınkiler yalnızca onu adlandıranlardır: uygulamanın yolundan ya da sürecinin içinde çalıştığı coalition'dan, ki bir sistem uygulamasınınkinde de vardır; not kaçının neden dışarıda bırakıldığını söyler. Bir iOS raporu kendi verdiği zamanla tarihlenir, çünkü macOS uygulamanın 25 raporunu tuttuktan sonra her yeni crash'te eski bir raporun dosya zamanını ileri alır; yakalanmamış bir istisnanın raporu da uygulamayı bitiren abort ile değil, istisnanın atıldığı yerle verilir. Gizli değerler çıkarılır.

Bir iPhone'un crash klasörü her sürecin raporlarını tutar ve her rapor kendi sürecinin adını taşır, bu yüzden bu Mac'e yalnızca uygulamanınkiler kopyalanır: bundle klasörünün adıyla, `Shop-…` için `Shop.app`. Aynı adlı başka bir uygulamanın sürecine ait bir rapor, ki her Flutter uygulamasınınki `Runner`'dır, okunur okunmaz silinir. Bir extension'ın raporları kendi sürecinin adını taşır ve telefon bunu söylemez, bu yüzden iPhone'da verilmezler. Telefonda olmayan bir uygulamaya hiç rapor verilmez, not nedenini söyler. Bir güncellemeden sonraki ilk okuma, önceki bir sürümün başka süreçlerden kopyaladıklarını siler.

Android'de dropbox her uygulamanın kayıtlarını listelese de yalnızca uygulamanınkiler tutulur: crash dosyasında ve bir `measure_performance` `exits` okumasında. Sistemin tuttuğu her çıkışı da nedenini eksiksiz yazarak sayar, çünkü kendiliğinden çıkan ya da öldürülen bir uygulama çökmemiştir: `SIGNALED status 9`, `USER REQUESTED KILL BACKGROUND`, `EXIT_SELF status 3`.

### Bir release build için semboller

`symbols` ile bir release build'in yığınını adlandırır.

iOS'ta bu bir `.dSYM` ya da build'in ürünleri gibi onları tutan bir klasördür; bir imaj `atos` ile yalnızca `dwarfdump`'a göre UUID'si çöken imajınki olan dSYM'den adlandırılır: başka biri yanlış fonksiyonları adlandırırdı ve yine de doğru görünürdü, bu yüzden eşleşen dSYM bulunmayan bir rapor hangi UUID'yi istediğini ve klasörde hangisinin olduğunu söyler.

Android'de bu, sembollerini tutan kütüphanelerin bir klasörüdür, bir build'in `lib` klasörü gibi (`merged_native_libs/.../out/lib`, ABI tombstone'dan bulunur); SDK'daki en yeni NDK'nın `ndk-stack`'i ile okunur, bu da başka bir build'in kütüphanesini okumadan bırakır ve yanıt hangi kimliklerin farklı olduğunu söyler.

Bir tombstone crash'ten bir an sonra gelir ve bir Java crash'inin hiç tombstone'u yoktur. Android az tombstone tutar: API 34'te bir uygulamanın birkaç dakika içindeki ilk 6 native crash'inden biri bir tombstone bıraktı, sonraki hiç bırakmadı. Yanıt bunu söyler; çöken çalıştırmalardan oluşan bir döngü buna rastlayacaktır. Bütün yığın `named`'in verdiği dosyada bırakılır. Optimize edilmiş Swift, satırı olmayan bir fonksiyon verebilir.

## Bir cihazı eski haline getirmek

Bir koşulu değiştirmek, önce eski değeri onu değiştiren süreçle birlikte not eder. Değer, o oturum bittiğinde ya da `set_device` ile `restore` adıyla geri döner; bu, başka bir canlı sürecin değiştirdiğine dokunmaz ve bunu söyler.

Ölen bir oturum dosyayı bırakır; o cihazdaki sonraki oturum yalnızca ölü bir sürecin bıraktığını geri koyar ve bunu söyler; geri konamayan bildirilir, okunamayan bir dosya da yanında `.bad` olarak tutulur.

Komut satırında her komut ayrı bir süreçtir, bu yüzden onun değişiklikleri oturumlar gelip gitse de `restore`'a kadar kalır. Bir değişikliğin yanıtı bu ikisinden hangisi olduğunu söyler.

Bir kayıt, bir ağ yakalaması, açık bir rapor ve bir flow kaydı da aynı yoldan gider. Sonraki oturum ölü bir sürecin bıraktığını bitirir ve bunu söyler (bir flow kaydı adımları saklanarak durur), canlı bir sürecin çalıştırdığına dokunmaz ve bir komut satırının başlattığını onun sonraki komutu için bırakır.

## Kablosuz bağlantılar, biyometri ve anahtar zinciri

### Kablosuz bağlantılar

Bir kablosuz bağlantı, cihaz 10 s içinde istendiği gibi okunduğunda tamamdır: Wi-Fi radyonun durumuna göre, çünkü önce onun ayarı değişir; uçak modu ve mobil veri ise kullanıcının anahtarına göre, böylece uçak modu sırasında yapılan bir geri yükleme kullanıcının seçtiğini geri getirir. Değişmeyen bir cihaz, söylediğiyle reddedilir. Kendi ağı üzerinden ulaşılan bir cihaz (`adb connect`, kablosuz hata ayıklama) `wifi off` ve `airplane on`'u reddeder, çünkü onları geri almak için hiçbir şey ona ulaşamazdı. Bir emulator'da mobil verinin kapatılması ya da uçak modunun açılması cihazın bu Mac'e giden yolunu keser, `restore` da onu geri getirir. Bir anahtar bir bağlantı hakkında hiçbir şey söylemez.

### Biyometri

Bir emulator'da `biometric` sensörüne dokunur ve yalnızca parmak izi servisi dokunuşu saydığında tamamdır: `match`, `nomatch`; hiçbir uygulama sormuyorsa her biri reddedilir. Parmak izi olmayan bir emulator'da `enroll` kendiliğinden bir tane ekler: ekran kilidini, önce not ederek, PIN 1234'e ayarlar, Ayarlar'ın kayıt adımlarından kontrollerin sözcüklerine değil türlerine göre geçer (PIN alanı, sonra en alttaki ve en sağdaki düğme) ve servis bir tane tutana kadar sensöre dokunur. `restore` PIN'i kaldırır, Android da parmak izlerini onunla birlikte siler.

Kendine ait bir kilidi olan bir emulator reddedilir, çünkü PIN'i yazılamaz; `--no-home` ile başlatılmış bir sunucu da öyle, çünkü Ayarlar uygulamadan çıkar. Gerçek bir telefon reddedilir: sensörü yalnızca bir kişinin parmağını kabul eder ve kilidi sahibinindir. Bir simulator'ın `enroll`'u Face ID ya da Touch ID'yi açar.

Android'de bir uygulamanın sorusu sistemindir ve odağı tutar: her ekran gibi öğeler halinde okunur, ama ekran görüntüsü boştur, çünkü güvenli bir penceredir.

Bir iPhone'da `devicectl device simulate biometrics`, `Device does not support any biometric simulation, nothing to do` yanıtını verir ve 0 ile çıkar, bu yüzden kullanılmaz: bir yanıt, hiç olmamış bir dokunuş için tamam derdi.

### Anahtar zinciri

`keychain` `reset` bir simulator'ın anahtar zincirini boşaltır ve uygulamaların kaç öğe tuttuğunu deponun kendi satırlarından söyler; bu satırlar sonrasında boş olduğunu da kanıtlar. Sistemin kendi satırları kalır ve sayılmaz. Tek seferliktir: hiçbir şey onları geri getirmez.

## Bellek uyarıları, sallamalar, fotoğraflar ve arka planda bir son

### Bellek uyarıları

`memory_warning` uygulamaya, `app`'e ya da seçili olana, sistemin bellek azaldığında gönderdiği uyarıyı gönderir. Bir simulator'da orada çalışan her uygulama onu alır, Simulator'ın kendi menüsündeki gibi, her çağrıda bir kez; bir düzey reddedilir.

Android'de `value`, `am send-trim-memory`'nin aldığı trim düzeyidir, verilmezse `RUNNING_CRITICAL`: `RUNNING_MODERATE`, `RUNNING_LOW` ve `RUNNING_CRITICAL` öndeki bir uygulamaya, `HIDDEN`, `BACKGROUND`, `MODERATE` ve `COMPLETE` arka plandakine ulaşır. Android bir düzeyi yalnızca işleme en son verdiğinin üstündeyse alır ve yeni bir işlem hiçbir düzeyde değildir; bu yüzden bir ret uygulamanın hangi düzeyde olduğunu söyler. Sistem ana ekrana gönderilen bir uygulamayı yaklaşık bir saniye daha önde saydığı için bir arka plan düzeyi 3 s boyunca yeniden istenir. Her düzey API 35 ve API 36'da fixture'ın `onTrimMemory`'sine ulaştı.

Bir iPhone'da `devicectl device process sendMemoryWarning` onu uygulamanın işlemine gönderir; henüz bir telefonda çalıştırılmadı.

### Sallamalar

`shake`, bir simulator'ın UIKit'inin sallama olarak aldığı bildirimi gönderir; öndeki uygulama onu alır, her çağrıda bir kez. Bir emulator'da ivmeölçer yerçekiminin eksenine dik olarak bir yandan öbür yana, 80 ms'lik dört hamleyle çekilir ve okuması geri konur: fixture her çağrıda bir sallama saydı. Bir telefon ve bir iPhone yalnızca elle sallanır ve onu reddeder.

### Fotoğraflar ve videolar

`transfer_files` `media`, sunucunun klasöründeki bir fotoğrafı ya da videoyu, ya da bir klasörün fotoğraf ve videolarını cihazın kitaplığına ekler.

Bir simulator onları `simctl addmedia` ile alır ve yanıt Fotoğraflar'ın sonra kaç öğe tuttuğunu sayar; Fotoğraflar'ında silme yoktur, bu yüzden hiçbir şey onları çıkarmaz. Her dosya kendi çağrısıyla gider, çünkü birkaç dosya verilen `simctl addmedia` alabildiklerini içe aktarır, sonra hiçbirini adıyla söylemeyen bir istisnayla biter. Fotoğraflar'ın içe aktaramadığı bir dosya adıyla `INVALID_ARGUMENT` olarak reddedilir; yanıt ötekilerden kaçının eklendiğini, neyin işe yarayabileceğini (bir `.mp4` ya da `.mov` içinde H.264 video, `.png` ya da `.jpg` fotoğraf) ve altında simctl'in satırını verir; bir klasörde bu satır, simctl'in reddettiği son dosya için verdiği satırdır.

Android'dekiler her biri yolu ve boyutuyla not edilir, `Pictures/appdyno`'ya gönderilir ve MediaProvider'ın kendi `scan_file`'ı ile taranır, çünkü gönderilen bir dosya taranana dek kitaplığın göremeyeceği yerde kalır; yanıt kitaplığın sonra onlardan kaçını listelediğini sayar. `restore` ve oturumun sonu tam olarak bunları, her birini yalnızca gönderildiği boyuttayken siler ve o zamandan beri değişeni adıyla söyler. Bir iPhone reddeder.

### Arka planda bir son

`background` ile `manage_app stop`, bir uygulamayı sistemin bellek için arka plandaki bir uygulamayı sonlandırdığı gibi sonlandırır: ana ekran, uygulama önden çıktıktan sonra durumunu kaydetmesi için 1,5 s, sonra işlemi öldürülür; bir simulator'da SIGKILL ile, Android'de `am kill` ile, bir iPhone'da `devicectl device process terminate --kill` ile, ki henüz bir telefonda çalıştırılmadı. Hâlâ çalışan bir işlem reddedilir, çünkü `am kill` yalnızca sistemin sonlandırabileceği bir işlemi sonlandırır ve bir ön plan hizmeti bir işlemi ayakta tutar.

Android'de bulunduğu aktivite, görevi `launch_app` başlattıysa kaydedilmiş örnek durumuyla geri gelir; görevi önce bir bağlantı başlattıysa yeni bir başlatıcı aktivitesinin altında geri gelir. Bir simulator'da fixture'ın `@SceneStorage` ile tuttuğu değer yeni bir işlemde geri geldi; bir başlatmada kaydedilmiş sahneyi bir kez atan bir simulator, yeniden açılana dek her başlatmada bunu yaptı (iOS 26.5).

## Bir iPhone'un kendi koşulları, verisi ve izinleri

Bir iPhone'da `network` ve `thermal`, telefonun kendi koşullarıdır; Xcode'un Devices penceresinin onları ayarladığı gibi, telefonun instruments'ı üzerinden: `network` `slow`, telefonun listelediği ilk EDGE profili ya da adıyla bir profildir, `full` hiçbiri; `thermal` `fair`, `serious` ya da `critical`, `nominal` hiçbiri. Bir seferde biri geçerlidir.

Telefon, onu ayarlayan süreç gittikten sonra da tutar: SIGKILL ile öldürülen bir oturum `SlowNetworkEdgeBad`'i açık bıraktı ve sonraki oturumun başlangıcı onu not edilmiş buldu ve kapattı. Bir ısıl profil her yönde saniyelerce kademeli değişir ve telefon bu arada hiçbir şey yanıtlamaz, bu yüzden telefon onu öyle okuduğunda tamamdır. Bunlar, canlı penceresinin kullandığı telefonun özel servisleri üzerinden gider ve bu servislere ulaşılamadığı yerde nedeni söylenerek reddedilir.

Bir iPhone'da `manage_app clear`, boş bir klasörle `transfer_files push`'un yaptığı gibi uygulamanın veri container'ını boşaltır: yalnızca geliştirme imzalı uygulamalar. iOS'ta grant yoktur: `grant` ve `revoke` uygulamanın yanıtını sıfırlar, böylece uygulama yeniden sorar ve `answer_alert` yanıtlar. Bir uygulamayla `locale`, bir simulator'da olduğu gibi, bu aracın yaptığı her başlatmada onu bir dilde tutar.

## Yavaş bir ağ

Bir emulator'da `network` `slow` konsolu üzerinden gider: iki yönde EDGE hızı ve 40 ile 100 ms arası gecikme. Android 13'ten itibaren bir telefonda yalnızca Android'in kendi sınırı vardır, `ingress_rate_limit_bytes_per_second`: `slow` indirmeyi bir EDGE ağının indirme hızı olan 30 kB/s ile sınırlar; bir sayı da onu bir telefonda ya da emulator'da saniyede o kadar bayta sınırlar. Gecikme eklemez ve yüklemeleri tam hızda bırakır, yanıt da bunu söyler. Sınır cihazın tuttuğu bir ayardır, bu yüzden eskisi not edilir ve `restore` onu siler.

## Katlanma

### Katlanabilir bir Android cihaz

Android'de `fold`, `cmd device_state`'ten o adın durumunu oradaki kimliğiyle ister; bu kimlik cihaza göre değişir, cihaz o duruma geçtiğinde tamamdır. Cihazın listelediği her duruşu alır: `open`, `closed`, `half_opened` (`half` de olur), `rear_display` ve iki ekran birlikte için `dual`. Okuma durumu, ardından listeyi söyler. Bir değişiklik, uygulamaların artık gördüğü ekran boyutunu ve yoğunluğunu, öndeki activity'nin yeniden oluşturulduğunu ya da korunduğunu sistemin kendi yeniden başlatma satırından söyler.

Masaüstü ve kitap duruşları cihaz durumu değildir: menteşesi yatay ya da dikey duran yarı açık duruştur, bunu uygulama kendisi okur.

İstek, menteşe ne yaparsa yapsın ve bu araca ne olursa olsun sıfırlanana kadar geçerlidir, bu yüzden bir koşuldur: `restore` onu sıfırlar ve `default (now open)` bir istek değildir.

API 31'den itibaren emulator'da de telefonda da aynıdır. Gerçek katlanabilir bir cihazda çalıştırılmadı. Katlanmış bir emulator'da canlı pencere konuğun kendi görüntüsünü alır; bu daha küçüktür ve gecikir, çünkü emulator kapak ekranını iç ekranın çerçevesine gererek çizer.

### Bir iPhone Duo simulator'ı

İki yerleşik ekranı olan bir iOS simulator'ında, yani Xcode 27.1 ve sonrasıyla iPhone Duo'da, `fold` `closed`, `half` ve `open` alır. `devicectl device info displays`'in hangi ekranı etkin dediğinden okunur, simulator'ın menteşe kaydırıcısının gönderdiği menteşe olayıyla ayarlanır; bu özel API'dir. Ekran menteşeyi en çok 2,5 s sonra izler; izlemezse reddedilir, simulator'ı yeniden başlatmak bunu giderir.

Simulator sıfırlanacak bir istek tutmaz; bu yüzden bulunan duruş yazılır, `restore` ve oturum sonu onu yeniden ayarlar. Simulator'ın dışından yarı açık ile açık ayırt edilemez: `half` yalnızca bu oturum ayarladıysa öyle okunur, yarı açık bulunan bir cihaz açık olarak geri alınır.

Açıkken okumalar, dokunuşlar, `take_screenshot` ve `record_session` iç ekranındır; uygulama sürecini korur, sahnesi oraya taşınır. Üç şey farklıdır: ana ekranın öğeleri kapak ekranının koordinatlarında okunur, kayıt döndürülmeden çıkar ve orada yalnızca doğrudan girdi yolu dokunur, runner'ınki değil. Başka her simulator reddeder.

## Diller

### Android'de dil

Android'de `locale`, API 33'ten itibaren, uygulama verildiğinde ya da biri seçiliyken, `cmd locale` ile uygulamanın kendisinindir. Uygulamaların dili olmadığı API 33'ün altında bütün cihazındır ve ajan onu Ayarlar'ın ayarladığı gibi ayarlar: Android onu `persist.sys.locale` içinde tutar, bu yüzden eski değer önce not edilir ve geri konur. Hiç dil seçmemiş bir cihaz sonrasında eski dili seçilmiş olarak tutar.

### Bir simulator'da dil

Bir simulator'da, bir uygulama verildiğinde ya da seçiliyken `locale`, bu aracın yaptığı her başlatmada o uygulamayı bir dilde tutar; bunu bu Mac'te tutulan `-AppleLanguages` ve `-AppleLocale` ile yapar: simulator'da hiçbir şey değişmez. Bir uygulama seçiliyken değişmeyenler, izin soruları ve Ayarlar gibi sistemin kendi metni ve bu aracın yapmadığı bir başlatmadır: bir simge dokunuşu, uygulamayı başlatan bir bağlantı ya da push, uygulamanın kendini yeniden başlatması.

`app ""` bütün simulator'ı ayarlar ve yanıt hangisini aldığını adlandırır. Çalışan bir uygulama o dilde yeniden başlatılır, `restore`'da da yeniden. XCTest'in açılış ölçümüne de aynı argümanlar verilir, bu denetlenmedi.

`launch_app` `language` yalnızca o başlatmanındır, bir simulator'da ve bir iPhone'da: sonraki başlatma tutulan dilde, yoksa sistemin dilinde olur. Bir seferde bir uygulamanın dili tutulur: bir başkası `restore`'a kadar reddedilir.

## Bir cihazı paylaşmak

Bir cihazı yöneten süreç onu tutar: durum klasöründe pid'ini ve başlangıç zamanını taşıyan bir dosya. Ölü bir sahibin talebi geçersizdir. İkinci bir süreç, paylaşmak istemedikçe sahibin pid'i ve adıyla reddedilir: `share: true` ile `use_device`, iki komut satırından birinde `--share` ya da `APPDYNO_SHARE=1`.

`list_devices` kimin neyi tuttuğunu gösterir. Daemon yoktur. Bitmiş bir sunucunun bıraktığını geri koyan süreç, bunu yaparken cihazı `appdyno put-back` olarak tutar; bu arada başlayan bir oturum onu en çok 40 s bekler, oysa başka her tutucu onu hemen reddettirir.

Seçili bir cihaz yokken bu sunucunun sürebileceği birden fazla cihaz varsa, cihaz gerektiren bir çağrı reddedilir ve her birini seri numarası, türü ve modeliyle adlandırır; `use_device` birini seçer, seri numarası ya da UDID'si, bir simulator'ın ya da bir AVD'nin adı ya da modeliyle, izin listesi her birine karşı denetlenerek; süremeyeceği bir cihaz, sürebilecekleri adlarıyla söylenerek reddedilir. `list_devices` her cihazın `kind`'ını verir: `phone`, `simulator` ya da `emulator`; bir emulator'ın `link`'i yoktur, çünkü onu hiçbir kablo bağlamaz.

## Bir simulator ya da emulator başlatmak

`manage_simulator` simulator'ları ve emulator'ları yalnızca istek üzerine başlatır ve kapatır. Ad verilmezse kapatma yalnızca bu aracın başlattıklarına dokunur. `APPDYNO_EMULATOR_ARGS` emulator'ın varsayılan seçeneklerinin yerini alır, `APPDYNO_EMULATOR_FIRST_PORT` da boş bir port aramasının başladığı yerdir.

`--allow-devices` burada bir simulator'ı ya da emulator'ı kimliğiyle, seri numarasıyla ya da adıyla alır, `name` gibi; böylece `shutdown` için izin verilene ondan sonraki `boot` için de izin verilir. Durmuş bir emulator'ın kendi seri numarası yoktur: bu araç onu kapattığında çalıştığı seri numarasıyla anılır ve o port boşken o porttan geri gelir; hub'ın yeniden başlattığı biri de en son listelendiği porttan geri gelir, penceresi de onu orada bekler. Ondan sonraki `boot`'un reddedeceği bir `shutdown` önce reddedilir ve cihaz açık kalır.

Seçili cihazın `shutdown`'ı üzerindeki oturumu ve uygulamalarının bellekte tuttuğunu bitirir ve kimseye sormaz, çünkü cihazın diskinde tuttuğu hiçbir şey gitmez: ilerlemesi bunu başlamadan önce söyler, yanıtı da bittiğinde. Oturumun değiştirdiği, oturumun sonundaki gibi önce, cihaz hâlâ yanıt verirken geri konur: karanlık mod, metin boyutu, animasyonlar, bir döndürmenin ayarladığı dönüş ve ötekiler; yanıt her birini, ya da geri konamayanı adlandırır. Yeniden başlatma yoktur: [SECURITY.tr.md](../../SECURITY.tr.md)'nin dediği gibi bir `shutdown` ile bir `boot` iki çağrıdır.

`--allow-devices` varken `create` kapalıdır, hub'ın Yeni Simulator'ı de, hiçbir şey yapılmadan reddedilir: yeni bir simulator'ın UDID'si yapılmadan önce bilinmez, bu yüzden hiçbir liste onu adlandırmaz; yalnızca reddetmek için bir tane yapan bir sunucu da onu geride bırakıyordu. Yapılıp başlamayan biri, bir kişinin onu nasıl kaldıracağını söyler, çünkü burada hiçbir şey birini silmez.

## Bir telefona ulaşmak

### Bir Android telefon

USB hata ayıklamayı açın, bağlayın ve `appdyno devices` ile kontrol edin.

Bir Xiaomi, USB üzerinden her yeni kurulumdan önce ekranında sorar ve 10 s sonra kendiliğinden hayır der: `manage_app install` telefonu uyandırır ve o sorunun evet düğmesine dokunur, ama yalnızca kendi başlattığı bir kurulum sırasında; yanıt ve `record_session` bunu söyler (`--no-install-consent` bunu size bırakır).

Play Protect'in uygulamayı Google'a gönderme sorusu her zaman hayırla yanıtlanır: özel bir build Google'a gönderilmez. Sunucu `--accept-install-warnings` ile çalışmıyorsa bir Play Protect uyarısına dokunulmaz, metni aktarılır. Hangi telefonda neyin görüldüğü için bkz. [Bir telefonun kurulum soruları](protocol.tr.md#bir-telefonun-kurulum-soruları).

One UI'lı bir Samsung'un kendine ait bir sorusu yoktur, Play Protect'inkiler de yalnızca "Verify apps over USB" açıkken gelir. İkisi arasındaki öteki farklar [One UI ile HyperOS karşılaştırması](perf.tr.md#one-ui-ile-hyperos-karşılaştırması) bölümündedir.

### Bir iPhone

Geliştirici modunu açın. Bir telefon, bir geliştirme imzalama kimliğine ve onu adlandıran bir provisioning profile'a ihtiyaç duyar. Wildcard bir uygulama kimliği için kurulu ve imzalama kimliği kilidi açık giriş anahtar zincirinde olan bir profil kendiliğinden bulunur. Başka birini seçmek için `APPDYNO_IOS_PROFILE=<profile.mobileprovision>`, `APPDYNO_IOS_KEYCHAIN=<keychain-db>` ve `APPDYNO_IOS_KEYCHAIN_PASSWORD=<password>` ayarlayın. Ne bulduğunu görmek için `appdyno doctor` çalıştırın.

Telefona USB üzerinden ulaşılır. Ağ üzerinden yalnızca bir pencere gider.

Bir telefonun panosu, runner olmadan ve telefonda hiçbir şey sorulmadan Xcode'un `devicectl`'i üzerinden gider, bir simulator'ınki de Mac'ten okunur. iOS'ta metin tuş vuruşlarıyla girilir: bir yapıştırma iOS'un "Allow Paste" uyarısını açar.

## 1.3.0'dan önceki adlar

1.3.0'da 48 araç 28 oldu ve eski adlar kalktı: eski bir adla yapılan çağrı, yeni adı söyleyen bir ipucuyla reddedilir. Aşağıda "aynı", argümanların değişmediği anlamına gelir.

| önce              | şimdi                 | argümanlar                                                                                                                                                                                                       |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `device_info`     | `list_devices`        | `{ selected: true }`                                                                                                                                                                                             |
| `set_orientation` | `set_device`          | `{ orientation, read }`, `{ name: 'orientation', value: orientation, read }` olur                                                                                                                                |
| `set_location`    | `set_device`          | `{ lat, lon }`, `{ name: 'location', value: '<lat>,<lon>' }` olur; `{ clear: true }`, `value: 'none'` olur                                                                                                       |
| `clipboard`       | `set_device`          | `{}`, `{ name: 'clipboard' }` olur; `{ text }`, `{ name: 'clipboard', value: text }` olur                                                                                                                        |
| `device_setting`  | `set_device`          | aynı; ama `{ name: 'media', value }`, `transfer_files` `{ action: 'media', path: value }` olur                                                                                                                   |
| `simulator`       | `manage_simulator`    | aynı                                                                                                                                                                                                             |
| `screen`          | `read_screen`         | aynı                                                                                                                                                                                                             |
| `find`            | `read_screen`         | aynı (`selector`)                                                                                                                                                                                                |
| `wait_for`        | `check_element`       | `{ ref, selector, read }` aynı; `gone: true`, `check: 'absent'` olur; `timeoutMs` verilmelidir (varsayılanı 5000'di); süresi dolan bir bekleme `TIMEOUT` değil, `CHECK_FAILED` olur                              |
| `assert`          | `check_element`       | aynı                                                                                                                                                                                                             |
| `screenshot`      | `take_screenshot`     | aynı                                                                                                                                                                                                             |
| `audit`           | `check_screen`        | `{ check: 'accessibility', types, maxIssues }`                                                                                                                                                                   |
| `visual`          | `check_screen`        | `action: 'compare'`, `check: 'visual'` olur; `action: 'baseline'`, `check: 'visual_baseline'` olur; gerisi aynı                                                                                                  |
| `tap`             | `tap_screen`          | aynı                                                                                                                                                                                                             |
| `gesture`         | `tap_screen`          | `kind: 'double_tap'`, `count: 2` olur; `durationMs` ile `kind: 'long_press'`, `holdMs` olur; hedef ve `read` aynı                                                                                                |
| `gesture`         | `swipe_screen`        | `kind: 'drag'`: `kind` kalkar, `to`, `durationMs`, `holdMs` aynı; `kind: 'pinch'`: `scale`, `x`, `y` aynı; `kind: 'plan'`: `pointers` aynı                                                                       |
| `swipe`           | `swipe_screen`        | aynı                                                                                                                                                                                                             |
| `scroll_to`       | `swipe_screen`        | `selector`, `until` olur; `direction`, `maxSwipes`, `x`, `y`, `read` aynı                                                                                                                                        |
| `keyboard`        | `press_key`           | `dismiss`, `{ key: 'hide_keyboard' }` olur; `enter`, `{ key: 'enter' }` olur; `status`: klavye açıkken `@keyboard`'u listeleyen `read_screen`                                                                    |
| `steps`           | `run_steps`           | her adımın `action`'ı, bu tablodaki ad ve argümanlarla `tool` olur; yalın `double_tap`, `long_press` ve `drag` türleri, `gesture`'ın yukarıdaki satırlarındaki gibi `tap_screen` ve `swipe_screen` adımları olur |
| `alert`           | `answer_alert`        | aynı                                                                                                                                                                                                             |
| `terminate_app`   | `manage_app`          | `{ action: 'stop', app, background }`                                                                                                                                                                            |
| `app`             | `manage_app`          | `list`, `state`, `install`, `uninstall`, `clear`, `grant`, `revoke`, `build_and_run` için aynı                                                                                                                   |
| `app`             | `transfer_files`      | `download_data`, `{ action: 'pull', app, path }` olur; `replace_data`, `{ action: 'push', app, path }` olur                                                                                                      |
| `push`            | `send_push`           | aynı                                                                                                                                                                                                             |
| `logs`            | `read_logs`           | `maxLines`, `limit` olur; gerisi aynı                                                                                                                                                                            |
| `crashes`         | `read_logs`           | `{ source: 'crashes', app, since, limit, symbols }`                                                                                                                                                              |
| `record`          | `record_session`      | `{ kind: 'video', action, file, overwrite, maxSeconds }`                                                                                                                                                         |
| `report`          | `record_session`      | `start`, `write`, `stop`, `{ kind: 'report', action, dir }` olur; `timeline`, `{ kind: 'timeline', action: 'start', dir }` olur; `flight`, `{ kind: 'flight', action: 'start', dir }` olur                       |
| `mirror`          | `show_mirror`         | aynı                                                                                                                                                                                                             |
| `inspector`       | `inspect_app`         | `list`, `ax_list` olur; `press`, `ax_press` olur, `name` aynı                                                                                                                                                    |
| `hand_off`        | `ask_person`          | aynı                                                                                                                                                                                                             |
| `network`         | `capture_network`     | aynı                                                                                                                                                                                                             |
| `webview`         | `inspect_app`         | `pages`, `elements`, `click`, `eval`; `web_pages`, `web_elements`, `web_click`, `web_eval` olur; gerisi aynı                                                                                                     |
| `react_native`    | `inspect_app`         | `targets`, `logs`, `reload`; `rn_targets`, `rn_logs`, `rn_reload` olur; gerisi aynı                                                                                                                              |
| `perf_snapshot`   | `measure_performance` | `{ metric: 'snapshot', ... }` aynı                                                                                                                                                                               |
| `perf_launch`     | `measure_performance` | `{ metric: 'launch', ... }` aynı                                                                                                                                                                                 |
| `perf_scroll`     | `measure_performance` | `{ metric: 'scroll', ... }` aynı                                                                                                                                                                                 |
| `perf_trace`      | `measure_performance` | `{ metric: 'frames', ... }`; `scroll`, `direction` olur                                                                                                                                                          |
| `perf_profile`    | `measure_performance` | `{ metric: 'cpu', ... }`; `scroll`, `direction` olur                                                                                                                                                             |
| `perf_heap`       | `measure_performance` | `{ metric: 'heap', ... }` aynı                                                                                                                                                                                   |
| `perf_compare`    | `compare_performance` | aynı                                                                                                                                                                                                             |
| `perf_query`      | `compare_performance` | `{ action: 'query', trace, sql, table, limit }`                                                                                                                                                                  |
| `flow`            | `run_flow`            | `start`, `record` olur; `stop`, `save`, `run`, `export` aynı                                                                                                                                                     |
