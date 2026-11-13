# Değişiklik günlüğü

[English](CHANGELOG.md)

## Yayımlanmamış

### Değişti

- README hızlı bir başlangıçla açılıyor: tek komut, tek istek ve gerçek bir yanıt.
- Ölçülen bir akışın senaryosu artık yalnızca dosyanın adından değil, deposundaki yolundan adlandırılır: `flows/login.flow` için `journey-flows-login`. 1.0.0'ın `journey-login` altında sakladığı bir baseline'ın yeni adla yeniden saklanması gerekir.
- Kapı, ne baseline'ı ne bütçesi olan, yani hiçbir şeyin karar vermediği bir senaryo için 1 ile çıkar: geçiyordu ve yalnızca çıkış koduna bakan bir job hiçbir karşılaştırma yapılmadan yeşil oluyordu. Baseline'ı olan bir senaryoya eklenen bir adım `new` olarak geçmeye devam eder.
- Kendisi sanal makine olan bir Mac'te, bir CI runner'ında olduğu gibi, bir sayının yanında `host-load-unread` yazar ve Mac'in ne kadar meşgul olduğunu söylemeyen bir load average yüzünden artık `high-host-load` işaretlenmez: 3 çekirdekli bir GitHub runner'ı boştayken 115 ile 650 arası okudu ve her çalıştırmayı baseline olarak reddetti. `APPDYNO_HOST_VIRTUAL=0` onu yine de okutur. Örnek `perf-gate.yml` orada yük beklemez, başarısız bir adımın ekran görüntüsünü ve ağacını saklar başarısız bir çalıştırmadan sonra job'ı bitirmek yerine tabanı yeniden ölçer ve süre sınırını aşan bir adım süre bırakmadığı için pull request'i yedi kez ölçer.
- Örnek `perf-gate.yml` olduğu gibi GitHub'ın `macos-latest` runner'ında çalıştı: hiç kod değiştirmeyen bir pull request geçti, bir adımı yavaşlatan bir pull request ise o adımda bir gerileme olarak başarısız oldu.

### Düzeltildi

- `check: text` ve `expect: false` ile `assert`, öğe o metni okuduğunda başarısız olur: metin kontrolü `expect`'i dışarıda bıraktığı için geçiyordu.
- İki klasördeki aynı adlı iki akış, örneğin `login/smoke.flow` ve `checkout/smoke.flow`, artık bir hatanın ekran görüntüsünü ve ağacını, JUnit case'ini ya da performans senaryosunu paylaşmaz.
- Bir simülatörde, açılıştan hemen sonraki bir dokunuş, uygulamanın öne geldiğini runner gördüğünde de, yardımcının gördüğünde olduğu gibi, uygulamanın açılmasını bekler: runner'ın ilk başlangıcında, CI'da olduğu gibi, dokunuş açılış sırasında gidip kayboluyordu ve akışın sonraki adımı başarısız oluyordu.
- Bir iPhone'da ya da simülatörde bir uygulamayı durdurmak, yüklü bir Mac'te yeni açılmış runner, uygulamanın önden çekilip çekilmediği sorusunu yanıtlamadığında artık başarısız olmaz: uygulama durdurulmuştu ve bir CI runner'ının ilk `stop`'u bu yüzden 15 sn sonra başarısız oluyordu.
- Bir yolculuğun hiç durulmayan adımı da, yinelemesinin bütünü de, en az o kadar sürdükleri aracın süre sınırında sayılır: süre tutmuyordu, bu yüzden sınırı aşacak kadar yavaşlayan bir adım karar için çok az örnek bırakıyordu ve yanıt yalnızca `journey.unsettled`'ın arttığını söylüyordu. Artık o adımda, adıyla bir gerilemedir; bir pencere de böyle bir yolculuğu en az süresiyle söyler.
- Maestro YAML'a aktarılan bir akış bir tuşun sayısını korur: `press_key back count=3` bir değil üç basıştır.
- Android'de iki başlatıcı etkinliği olan bir uygulama, LeakCanary'li bir debug build gibi, açılır: sistem ikisini kendi seçicisine çözüyordu; `launch_app` uygulamanın yerine onu başlatıp uygulamayı ölmüş sayıyor, `perf_launch` da 0 ms'lik soğuk açılış ölçüyordu. Uygulamanın kendi etkinliklerinden manifestinde ilk adı geçen başlatılır.
- `perf_launch` yalnızca sistemin istenen durumda ölçtüğü açılışları saklar ve değerlendirir: sistemin `UNKNOWN` dediği 0 ms'lik bir açılış ya da soğuk bir seride `WARM` diye ölçülen biri, medyana girmese de çalıştırmanın sayılarına ve en uzun açılışına giriyordu.
- İki satıra bölünen bir web bağlantısına dokunuş, ilk satırının sonuna iner: kutusunun ortası satırlar arasındaki metindir; dokunuş indi deniyor ama hiçbir şey açılmıyordu.
- Aynı kutuyu paylaşan bir web bağlantısıyla kendi metnine uyan seçici, tek hedef sayılır, bağlantı: iki öğeye uyduğu için reddediliyordu.
- `perf_scroll`, hiçbir tur yeterince kare çizmediğinde, kendi yüzeyine çizen bir uygulamada (Flutter, bir oyun motoru) olduğu gibi, hiçbir şeyi değerlendirmediğini ve o kareleri neyin okuduğunu söyler: eşik aşılmadı diyordu.
- `perf_scroll`, sonuna zaten gelmiş bir listeyi sonraki turlarda olduğu gibi ilk turda da geri getirir: üstünü açılır bir pencere örtmüş bir ekran gibi reddediliyordu.
- Sistemin uygulamanın toplamı olmadan yanıtladığı bir bellek okuması, bir kez uygulama yanıt vermezken görüldü, yeniden sorulacak bir `TIMEOUT` olur ve sistemin ne dediğini taşır: kodsuz çıplak bir hataydı.
- Komut satırında `--ref`, başına `@` yazılmadan verilen bir ref'i alır.
- Açılışı süresini dolduran bir iOS runner'ı, açılmadığını, ne kadar sonra ve nereye kadar geldiğini söyler: onu bitiren öldürme önce geldiği için runner'ın durduğunu, `xcodebuild exit null` diyordu. Runner'ı başlatma aşamasına geçmiş bir açılışa o andan itibaren 90 sn daha verilir: orada öldürülen bir açılış sıfırdan yeniden başlatılıyordu.

## 1.0.0

appdyno 1.0.0 ilk herkese açık sürümdür: simülatörlerde, emülatörlerde ve gerçek telefonlarda iOS ve Android uygulamalarını kullanan, test eden ve ölçen bir MCP sunucusu, bir komut satırı aracı ve bir Mac uygulaması. 48 aracının her biri aynı zamanda bir komut ve kütüphanede bir çağrıdır; 0.6.0'dan geçiyorsanız önce Değişenler'i okuyun.

### Eklenenler

- Mac uygulaması `Appdyno.app`, bir disk imajından ya da bir Homebrew cask'inden, imzalı ve noter onayından geçmiş olarak gelir: kendi Node'unu, Android ajanını, cihaz görüntüleyicisini ve Perfetto'nun trace processor'ını taşır, menü çubuğunda durur; açıldığında ve günde bir kez daha yeni bir sürüm arar, onu da ancak siz derseniz kurar. Google'ın koşulları adb'yi onun dışında tutar; onu `appdyno tools install adb --accept-license` indirir.
- `appdyno install` sunucuyu bu Mac'teki MCP istemcilerine ekler: bir yedek aldıktan sonra yalnızca kendi girdisini değiştirir, değişikliği görmek için `--dry-run`, onu geri almak için `--remove` alır. `appdyno path` uygulamanın komutunu her kabuğun PATH'ine koyar.
- `appdyno update` en son sürüme ancak o doğrulandıktan sonra geçer, paket için npm'in provenance kaydıyla, uygulama için imzalı bir appcast ile; `--check` hiçbir şeyi değiştirmez. `appdyno doctor` sürümü ve nasıl kurulduğunu söyler.
- `appdyno mcp --http 127.0.0.1:PORT`, bu Mac'te bir program başlatamayan bir istemci için aynı araçları Streamable HTTP üzerinden sunar: yalnızca bu Mac'in loopback'inde, bir token arkasında, bir seferde tek bir istemciye.
- `appdyno hub` bu Mac'in her cihazını başlatmak, durdurmak, oluşturmak ve izlemek için tek bir pencerede gösterir; bir telefonu kablosundan hazır hale getiren Telefon Bağla, her MCP istemcisini ekleyip test eden bir sayfa, Araçlar ve Yardım da onunla birlikte, Türkçe ve İngilizce.
- `appdyno mirror` bir simülatörün, bir emülatörün, bir Android telefonun ya da USB ile bağlı, iOS 27'deki bir iPhone'un canlı penceresini açar; bir MCP istemcisi aynı cihazı yönetirken pencere de fare, trackpad ve klavyeyle yönetilir. `appdyno pair` bir pencerenin bir telefona Wi-Fi ile ulaşmasını sağlar.
- Bir pencerenin Denetçi'sinde on panel vardır, Performans, Akışlar, Uygulamalar, Etkinlik, Loglar, Ağ, Erişilebilirlik, Cihaz, Bağlantılar ve Bildirim; araçların yaptığını elle yaparlar, canlı sayılar ile açılış ve kaydırma ölçümleri de aralarındadır.
- **Akışı Kayda Al**, bir kişinin bir pencerede yaptığını seçiciyle bir akış olarak yazar, bir parolayı da bir gizli değerin adı olarak tutar. **Bunun Yanında Göster** ya da iki `--device` ve `--pair` ile `appdyno mirror` iki cihazı yan yana koyar, bir dokunuş da ikisine birden gider.
- `mirror` aracı bir istemciden bir pencere açar ve kapatır, `hand_off` da bir aracın yapamadığını, Face ID gibi, kişiden yapmasını ister ve bekler. `--silent` onu sessiz tutar, CI ve paylaşılan bir Mac için.
- `push` bir uygulamaya yedi türde push bildirimi gönderir: bir simülatörde `simctl` ile, Android'de hiçbir Firebase projesi olmadan FCM'in kendi mesajıyla, bir kişi kimlik bilgilerini `appdyno push setup` ile sakladıktan sonra da APNs ya da FCM ile.
- `open_link` `settings` Ayarlar'ı adıyla verilen bir sayfada açar, `links` de kurulu bir uygulamanın açtığı şemaları ve alan adlarını listeler.
- `press_key` artık `control_center`, `notification_center`, `spotlight`, `escape`, `space`, ok tuşlarını, `mute` ve `siri`'yi, basılı tutulan tuşlarla bir harf ya da rakamı, `command+a` gibi, ve bir `count` alır.
- `screenshot` bir `file` kaydeder ve resmini `points` ya da `width` ile boyutlandırır, `watchMs` ile de ekranda neyin hareket ettiğini sözcüklerle söyler. `assert` `check: moves` bir şeyin hareket etmesini şart koşar.
- Ağacında hiç sözcük olmayan bir ekran, bir oyun ya da bir canvas gibi, resminden Mac'in kendi metin tanımasıyla okunur; `find`, `tap`, `wait_for` ve `assert` onun okuduğunu alır.
- `swipe` `exact` içeriği `distance` kadar kaydırıp durur, `gesture` `drag` hareket etmeden önce basılı tutmak için `holdMs` alır, `set_location` `clear` da sabitlenmiş bir konumu bitirir.
- `simulator` `create` yeni bir iOS simülatörü oluşturup başlatır. `app` bir `.ipa` kurar, `build_and_run` ile bir projeyi derleyip çalıştırır, `download_data` ve `replace_data` ile de bir uygulamanın verisini dışarı ve geri kopyalar.
- `device_setting` artık `increase_contrast`, `reduce_transparency`, `airplane`, `wifi`, `mobile_data`, `thermal` ve `keychain` alır. Android'de bir telefonun ağını da yavaşlatır, API 31'den itibaren bir cihazı katlar, API 33'ün altında bir dil ayarlar ve bir emülatöre parmak izi kaydeder.
- `list_devices` her cihazın önünde neyin durduğunu ve nasıl düzeltileceğini söyler, `use_device` de bir cihazı seri numarasıyla, bir simülatörün ya da bir AVD'nin adıyla ya da modeliyle alır.
- Bir iPhone'da `clipboard` runner olmadan çalışır, `inspector` da imzalama kimliği olmadan ekrandakileri listeler ve onlara basar.
- `crashes` `symbols` bir release build'inin yığınını iOS'ta dSYM'inden, Android'de sembollerini taşıyan kütüphanelerinden adlandırır.
- `appdyno perf why` ya da `perf_compare` `action: why` bir gerilemenin en olası nedenini, onu gösterenle birlikte bulur: bir fonksiyon, bir açılışın bir evresi, bir karenin nedeni ya da bir takılma. `perf reference`, `perf functions` ve `perf comment` de onunla birlikte gelir.
- Bir yolculuk ölçülür ve kapıyla denetlenir: `appdyno test --measure` ya da `iterations` ile `flow` `run` her adımın sayılarını tutar, `perf compare` da yavaşlayan adımı adlandırır. `perf_launch` `baseline` tek çağrıda bir baseline tutar, `perf_compare` `budget` da bir bütçe koyar.
- Android'de `perf_snapshot` `also`, `surface`, `startInfo`, `anonMemory` ve `battery` okur, sayılar Google Play'in tanımlarına göre konur, `perf_trace` yavaş karelerin neden yavaş olduğunu söyler, `perf_launch` `baselineProfile` da bir Baseline Profile'ı ölçer.
- Bir iPhone'da bir pencerenin sayıları runner olmadan her saniye gelir; `perf_trace` `what: hangs` da her takılmanın meşgul mü yoksa bekler halde mi olduğunu ve hangi fonksiyonda olduğunu söyler, o fonksiyonu `dsym` adlandırır.
- Tutulan trace'ler bir sınırın, varsayılan olarak 10 GB'ın (`--trace-limit-gb`) altında kalır, `appdyno perf prune` da neyin gideceğini listeler. Sabitlenmiş ve doğrulanmış Perfetto trace processor'ı, bir Android trace'i ona ilk kez ihtiyaç duyduğunda indirilir.
- `report` `timeline` (`appdyno timeline`) bir yolculuğun videosunu, dokunuşlarını, adımlarını, karelerini, isteklerini, logunu ve belleğini tek bir saatte, gönderilecek tek bir HTML dosyasında toplar. `report` `flight` (`appdyno flight`) açıldığında bir uygulamanın son 30 s'sini tutar ve bir çökmede ya da bir takılmada kaydeder.
- Akışlar `${NAME}` olarak parametre alır, `run` ile başka bir akışı çalıştırır ve etiket taşır; `appdyno test` de `--tag`, `--env-file` ve bir yeniden denemede geçen dosyayı kararsız (flaky) diye bildiren `--retries` alır. `flow` `export` `to` Maestro YAML'ı bir dosyaya yazar.

### Değişenler

- `app`'in `launch`'ı yoktur: `launch_app`, `restart`, `args` ve `env` alır ve uygulamayı bunlarla baştan başlatır, bir uygulamayı kimliğinin yanı sıra adıyla da alır ve uygulamayı başlattığını mı yoksa öne mi getirdiğini söyler.
- `find`, `wait_for` ve `assert`, hedeflerini her dokunuşun yaptığı gibi `selector`'da alır. Bir aracın ya da bir adımın en üstünde verilen seçici sözcükleri reddedilir, ipucunda çağrı o biçimde gösterilir.
- iOS'ta ekran klavyesi, Android'deki gibi tek bir öğedir, `@keyboard keyboard`, ona bir dokunuş da reddedilir. Hiçbir şey odakta değilken hedefsiz bir `type_text`, `NO_FOCUS` ile reddedilir.
- Her yanıtın `structuredContent`'i bütün metnini `text` olarak taşır, metin `done`'ı taşıdığında da onu dışarıda bırakır. Bir reddin metni koduyla başlar ve ipucuyla biter.
- `press_key` bir tuşun adını büyük küçük harf fark etmeksizin okur, `return`'ü de `enter` olarak; bir kısayoldaki harf küçük harftir.
- `logs`, `contains` alır, `since` verilmediğinde son işlemin başladığı andan okur, bir simülatörde de uygulamanın kendi satırlarına ve Apple'ın çerçevelerinin hatalarına bağlı kalır.
- Protokol 2: host her isteği bir cihaza ulaşmadan önce şemasına göre denetler, karanlık bir ekran `SCREEN_OFF` olur, `device_info` hiçbir yetenek listelemez, başka bir sürümün runner'ı ya da ajanı da ilk yanıtında reddedilir.
- `push`, `device_setting`'in dışında, kendi başına bir araçtır ve `alert`, `background`, `rich`, `live_activity`, `tapped`, `voip` ve `widgets` alır.
- `set_orientation`, `landscape`'in yerine `landscape_left`, `landscape_right` ve `upside_down` alır ve ekran döndükten sonra yanıt verir.
- `device_setting`, `changed`'i yalnızca cihaz değişiklikten sonra başka türlü okuduğunda söyler, `dark_mode` `on` ya da `off` okur, iOS'ta `text_size` da iOS'un kendi adlı boyutlarını alır.
- Bir simülatörde, bir uygulama verilmiş ya da seçilmişken `locale` o uygulamayı o dilde tutar ve simülatöre dokunmaz; simülatörün tamamını `app ""` ayarlar. iOS'ta `launch_app` `language` yalnızca o açılış içindir.
- Sunucuyu başlatmanın tek yolu `appdyno mcp`'dir, çünkü `appdyno-mcp` kalktı; `bench` `--driver` almaz, kütüphane de tek bir fonksiyon dışa aktarır, `connect`.
- Bir istemcinin işlem yapan çağrıları geldikleri sırayla birer birer çalışır ve beklerken `waiting its turn` der; yalnızca okuyan çağrılar onların yanında çalışır.
- Süresi dolan bir `wait_for`, `TIMEOUT` ile, uyarı yokken bir `alert` de `NOT_FOUND` ile reddedilir; bu yüzden komut satırında ikisi de 1 ile çıkar.
- Performans kapısı bir gerilemede olduğu gibi `noisy`, `few-samples` ve `refused`'da da başarısız olur, `perf baseline` de bir karşılaştırmanın gereksindiği 3 çalıştırmayı tutana kadar 1 ile çıkar.
- Birkaç sayı yeni baştan ölçülür, bu yüzden 0.6.0 ile tutulan bir baseline'ı yeniden alın: çıkış sayıları çalıştırma başınadır, her yüzdeliğin tek bir tanımı vardır, hiç durulmayan bir adım süre tutmaz, bir iOS adımı da runner'ın bir uyarıyı beklemesini dışarıda bırakır.
- `perf_scroll` bir tur okur, bir `scenario` altında üç tur. `perf_profile` ve `perf_compare` artık salt okunur olarak işaretlenmez, çünkü ikisi de kaydırabilir ya da uygulamayı yeniden başlatabilir.
- Komut satırı seçili cihazını çalışma dizini başına tutar, değiştirdiği bir koşul `restore`'a kadar kalır, indirilen araçlar da `~/Library/Caches/appdyno/tools`'ta tutulur.

### Düzeltilenler

- Bir yanıt artık olmayanı söylemez: alanı başka bir metin okunan bir yazma Enter'a basmaz ve `submitted: false` der, gitmiş olabilecek bir dokunuş da `TIMEOUT` ya da `dispatched: "unknown"` ile yanıtlanır ve asla iki kez yapılmaz.
- Uygulaması altında ölen bir işlem hemen `APP_NOT_RUNNING`, çökme raporunun nedeni ve uygulamanın son log satırlarıyla reddedilir; `steps`'te ve akışlarda da, Android'in çökme penceresinin arkasında da.
- Durulma artık yavaşça kayan ya da bir uyarının geç geldiği bir ekrana durgun, duran bir ilerleme çubuğu için de meşgul demez.
- Durdurulan ya da süresi dolan bir çağrı cihazda da durur: Android'de, bir simülatörde ya da bir iPhone'da ondan sonra hiçbir kaydırma, tuş ya da yazma gitmez.
- Koşullar, aralarında Android'in metin boyutu, dili, karanlık modu, kontrastı, döndürme kilidi ve Wi-Fi'ı, bir istemci sunucuyu öldürdüğünde de olduğu gibi geri gelir, `simulator` `shutdown` da önce onları geri koyar.
- Bir simülatörün ilk dokunuşu artık runner'ının başlamasını beklemez; `launch_app`, `open_link`, `type_text` ve `list_devices` daha çabuk yanıt verir.
- `logs` çöken bir Android uygulamasının ölürken yazdığını okur, `crashes` Android'in çıkışlarını cihazın kendi saatine göre, bir simülatörün raporlarını da yalnızca o simülatörünkiler olarak okur, Android ajanı da eski build'lerinin ve kayıtlarının cihazda bıraktığını temizler.
- Xcode'un araçları geride bir şey bırakmaz: bir runner'dan ya da bir kayıttan sonra `DTServiceHub`, geçici klasörde `instruments*.ktrace`, eski kaynaklardan bir runner build'i, bir kişinin kapattığı bir simülatörü yeniden başlatan bir şey kalmaz.
- `scroll_to` bir simülatörde artık satırını geçip gitmez, `perf_scroll` da bir liste hareket ettikçe yeni satırlara devam eder; önceden listenin sonunu geçen bir tur akıcı okunuyordu.
- Ölçümler daha çok cihazda doğru okunur: HyperOS'lu bir Xiaomi'nin kareleri bir kez sayılır, bir iPhone'un CPU payı da enstrümanın kendi okumasıdır.
- Bir Samsung'da düz metne bir dokunuş artık 3 s'sini beklemez, kenar paneli de artık bir uyarı sanılmaz.
- Android 17 önceki sürümler gibi yönetilir: öldürülen bir ajanın basılı bıraktığı bir parmak artık her dokunuşu engellemez, kimlik bilgisi istemi de bir parola olarak okunur.

### Güvenlik

- Sistemin güç, acil durum ya da silme denetimlerine bir girdi, herhangi bir araçtan, `steps`'ten ya da yeniden oynatılan bir akıştan, önce kişiye sorar: Android'in güç menüsü, her dilde iOS'un kapatma ekranı ve Denetim Merkezi, Ayarlar'ın sıfırlamaları ve güç tuşuna 5 s içinde üçüncü basış. Bunların sorulmadan gitmesine yalnızca `--allow-power virtual|all` izin verir, `--allow-data-loss` değil.
- Arama yapmak da sorar: bir `tel:`, `telprompt:`, `facetime:` ya da `facetime-audio:` bağlantısı, bir telefon uygulamasında ya da Android'in kendi varsayılan çeviricisinde bir dokunuş, tuş ya da metin, iOS'un bir uyarı ya da bir sheet olarak gösterdiği arama isteminin bir düğmesi.
- Koruma, ekranı değiştirmiş ya da yolda başarısız olmuş olabilecek bir girdiden sonra ve aynı cihaza başka bir istemcinin girdisinden sonra ekranı yeniden okur, değerlendiremediği hiçbir şeyi göndermez. Bir iPhone'un `inspector` `press`'i de ondan geçer: her basış sorar, `--allow-apps` ya da `--no-home` altında da reddedilir.
- Veri kaybettiren iş, istemcinin kendi sorusuyla, önce kişiye sorar: `app uninstall`, `clear`, `replace_data` ve `revoke`, bir iPhone'da `grant` ve `device_setting` `keychain`. Bir hayır hiçbir şey yaptırmaz, yanıt da bir kişinin reddettiğini asla söylemez, çünkü bir istemci kendi kendine yanıt verebilir.
- İstemcinin soramadığı yerde ve `--http` üzerinden her zaman, kişi sunucuyu `--allow-data-loss` ya da `--allow-power` ile başlatmadıysa bunlar reddedilir. Komut satırı kendi terminalinde sorar ya da `--yes` alır; hiçbir MCP reddi onu anmaz.
- `--allow-apps` yalnızca bir aracın argümanlarını değil, her girdiyi tutar: izin verilen bir uygulamanın dışına düşecek bir dokunuş, tuş ya da metin reddedilir, `open_link` ve `app install` de yalnızca izin verilen bir uygulamaya, Ayarlar'a da yalnızca kimliği listedeyken ulaşır.
- `--no-home` Ayarlar'ı her yoldan tutar, aralarında `open_link`, ona bir bağlantı, `launch_app` ve bir `perf_` ölçümü. Boş verilen ya da boş metne uyan bir izin listesi başlangıçta reddedilir, `--allow-devices` altında da `simulator` `create` kapalıdır.
- Loglar, istekler ve konsol satırları daha çok kimlik bilgisini gizler, aralarında bir sorgudaki bir token, bir `Authorization` ya da `Cookie` başlığının tamamı, bir JWT ve bir bağlantıdaki bir parola.
- Bir iPhone'da ya da bir simülatörde yazılan hiçbir dosyada kalmaz: XCTest'in sonuç paketleri her tuşu tutuyordu, bu yüzden eskilerini silin, `~/Library/Developer/Xcode/DerivedData/temporary-*`.
- `react_native` Metro'yu yalnızca bu Mac'te çağırır, `webview` bir sayfanın soketini yalnızca sorduğu DevTools portunda açar, ikisi de hiçbir yönlendirmeyi izlemez.
- Bir sunucudaki `flow run` sunucunun ortamından hiçbir değer almaz, `flow save` ve `flow export` yalnızca sunucunun klasörüne ya da durum klasörüne yazar, tutulan bir çalıştırmanın `compile`'ı da bir cihaza yalnızca `speed`, `speed-profile` ya da `verify` olarak ulaşır.
- Bir pencere, bir kişi içine tıklayana kadar bir cihaza hiçbir şey geçirmez.
- Bir güvenlik açığını [SECURITY.tr.md](SECURITY.tr.md) dosyasının söylediği gibi gizlice bildirin.

## 0.6.0

Dört cihaz türünün hepsinde birlikte çalıştırılan ilk sürüm: bir emülatör, bir simülatör, bir Android telefon ve bir iPhone.

Paralel dallar birlikte çalıştırıldığında bulunanlar:

- İki fixture da derlenmiyordu: iki dal da birer ağ ekranı eklemişti. Artık her birinde tek bir ekran var.
- Animasyonlar kapalıyken `moving` her yanıtta true okunuyordu, çünkü sistemin yanıtı yalnızca henüz gelmemişti.
- `--animations off` ile `device_setting animations` birbirinin üstüne geri yükleme yapabiliyordu: ölçeklerin eski değerini bir seferde yalnızca biri tutar. `reduce_motion` da varken önce en yenisi geri konur.
- Android'de `perf_snapshot` `also: energy` artık pil geçmişini sıfırlamıyor: bir aralık, son şarjdan bu yana tutulan sayımın ne kadar arttığıdır.
- iPhone: karanlık mod ve hareketi azaltma boş ya da bir nesne olarak okunuyordu, bu yüzden bir geri yükleme hiçbir şeyi geri koymuyordu; `crashes` her zaman reddediyordu, çünkü `devicectl` klasörü kopyalarken alamadığı bir dosyada (`19:24.spindump.txt`) durur; raporlar artık tek tek kopyalanır.
- iPhone: okunamayan bir imzalama profili iç hata vermez, okunamadığını söyler; `record` bu telefonun kayıt yeteneği olmadığını ve ne yapılacağını söyler.
- Kilitli bir simülatör kilit durumu üzerinden açılır: kilit altındaki bir okuma runner'ı 15 s bekletiyordu.
- Bir uygulama seçiliyken önde başka biri varsa yanıt 0 öğe değil, önde olanı gösterir.
- Xiaomi'nin kaybolan ilk dokunuşu bulundu: ekranı 60 s sonra kendiliğinden kapanır ve uyandırıldıktan sonra uygulama, dokunuş alabilmeden önce ekranda okunur (14 dokunuştan 6'sı kayboldu, uyanmadan 1,5 s sonrasına kadar). Host artık odağın sabit kalmasını bekler (15'te 0) ve ajan karanlık bir ekrandaki dokunuşu reddeder, böylece host önce ekranı uyandırır. Uzun bir ölçüm de telefonu uyandırır: karanlık bir telefon hiçbir uygulama başlatmaz ve `am start` `UNKNOWN (0)` okur.
- Bir simülatörün panosu Mac'ten ayarlanır: runner'ın kendi çağrısı onu zaman zaman 15 s bekletiyordu.
- Enerji, Android 16'nın, parçaları sonraki satırda gelen satırını okur.
- İçinde hiçbir şey olmayan bir paket trace'i "0 of 0" değil, bunu söyler: Android 16'lı bir Xiaomi'de kaynak hiçbir uygulama için hiçbir şey kaydetmez.
- Bir web sayfasında ağacın id'siyle tuttuğu bir öğe, ağaçta eksikmiş gibi yeniden listelenmez.
- `app install` telefonu uyandırır ve kimse yanıtlamadığında HyperOS'un ekrandaki sorusunu adlandırır.
- `app install`, başlattığı kurulum sırasında telefonun sorularını kendisi yanıtlar ve bunu yanıtında ve `report`'ta söyler: bir Xiaomi'nin USB kurulum sorusuna, dosyadaki uygulama için ve hatırla kutusuna dokunmadan evet; Play Protect'in uygulamayı Google'a gönderme sorusuna her zaman hayır. Sunucu `--accept-install-warnings` ile çalışmıyorsa bir Play Protect uyarısına dokunulmaz, aktarılır. `--no-install-consent` bunların hepsini kapatır. O soruya daha önce yapılan dokunuşlar kayboluyordu, çünkü soru, düğmeleri son yerlerinde zaten okunmuşken yukarı kayar: bir dokunuş hiçbir şey yapmadı ya da iletişim kutusunun üstüne düştü, bu da kurulumu iptal eder. Soru açılırken zaman aşımına uğrayan bir ekran da onu kaybettirdi. Önceki bir çağrıdan hâlâ açık olan bir soru sonraki kurulumu reddeder, çünkü ona yapılan bir dokunuş o önceki kurulumu yanıtlardı.
- Çekilen bir kayıt videonun yanında değil, durum klasöründe bekler.
- Yanıtlar: aynı sözcükleri taşıyan bir kontrol ve kendi metni tek bir hedeftir; bir başlatma ya da bulmuş bir kaydırma "no change seen" taşımaz; retlerde dolgu sözler ve hat metodunun adı yoktur; iOS'ta klavye yokken yazılan tuşlar Android'deki gibi reddedilir.

- Kanıt ve erişim, yeni bir bağımlılık olmadan. Her yanıt bir cihazın neyi yapamadığını ve nedenini söyler.
- `record`: Android'de (hiçbir bağımlılık olmadan birleştirilen `screenrecord` parçaları), simülatörlerde (`simctl`) ve iPhone'larda (`devicectl`, henüz birinde çalıştırılmadı) ekran videosu. Kendi sürecinden uzun yaşar, cihaz başına bir tane. `stop` dosyayı okur: oynatılamayan bir dosya bir rettir.
- `report`: `index.html` içeren bir klasör: adımlar, her birinden sonra ekran ve bir görüntü, video, loglar, çökmeler, ölçümler. Gizli değerler gizlenir, bir öğenin gizli bir değer tuttuğu yerde görüntülerin üstü boyanır, ağdan hiçbir şey yüklenmez.
- `network`: bir uygulamanın trafiğinin sınırlı bir listesi; sizin çalıştırdığınız bir proxy (Android'de `http_proxy`, geri konur; simülatörde Mac'inki; Proxyman'in dışa aktarımından ya da bir HAR dosyasından okunur), simülatörde enjekte edilen bir `NSURLProtocol`, Android'de `dumpsys netstats` ve Perfetto'nun paketleri üzerinden. `paths` her birinin neyi gördüğünü söyler ve hiçbir sertifika kurulmaz.
- `webview`: sayfalar, öğeler halinde DOM, tıklama ve betikler; Android'de DevTools, simülatörde Safari'nin inspector soketi üzerinden. `screen` bir web görünümünün öğelerini `web` olarak işaretler ve erişilebilirlik ağacının tutmadıklarını ekler.
- `react_native`: hedefler, JS konsolu ve yeniden yükleme, Metro üzerinden. Flutter'ın Dart VM servisi yapılmadı: burada onu deneyecek bir SDK yok; bkz. README.
- `visual`: bir baseline, tolerans ve maskelerle bir karşılaştırma, bir fark görüntüsü. PNG çözücüsü bir kodlayıcıyla birlikte `core`'a taşınır.
- `device_setting`: `proxy`, `battery` (geri konur), `fold`, `call`, `sms`.
- Katalog bir istemciye hiçbir şey söylemeyeni dışarıda bırakır: her aracın şema URL'sini ve görev ayarını, bir de sunucunun yine de uyguladığı uzunluk sınırlarını. 42 araç, 24.814 karakter.
- Bir cihazın retleri asenkrondur: bir telefonun `push`, `biometric`, `clear` ve `grant` retleri istemciye iç hata olarak ulaşıyordu.
- `action` alan bir işlem, komut satırında onu ilk sözcüğü olarak alır: `appdyno record stop`.

- Akışlar. `flow` bir oturumun yaptığını okunabilir bir dosyaya kaydeder (`start`, `stop`, `save`), onu model olmadan yeniden oynatır (`run`, `--from`, `--param`) ve Maestro YAML'ına aktarır; orada karşılığı olmayanı reddeder. `appdyno test` akışları her `--device` üzerinde sırayla çalıştırır: JUnit, bir başarısızlığın ekran görüntüsü ve ağacı, çıkış kodu 1. Hiç eşleşme olmaması ya da birden çok eşleşme, çalıştırmayı en yakın adaylarla, adımla ve dosyanın satırıyla durdurur; hiçbir şey tahmin edilmez. Parolalar ve `APPDYNO_SECRETS` adlandırılmış parametrelere dönüşür ve hiçbir dosyada yer almaz. Yeni paket: `flows`. `flowsFor(ctx).replay`, her adımı ölçmek için `onStep` alır.
- `scroll_to` liste durduktan sonra yanıt verir: bir simülatörde hemen ardından gelen bir dokunuş sık sık kayboluyordu, çünkü durulma süzülen bir listeyi görmez ve UIKit böyle bir listeye dokunuşu "dur" olarak alır. Ölçüldü: önceden 6'da 3'ü kayboluyordu.
- `ActionOut.settleMs`: işlemden durulmuş ekrana kadar geçen süre, cihazın ölçtüğü gibi.
- Bir retteki en yakın öğeler id'lerine göre de değerlendirilir, böylece yanlış yazılmış bir id komşusunu bulur.

- Cihazı yönetmek. Her işlem bir ref, koordinat ya da seçici alır; `steps` ekranlar boyunca `wait_for`,
  `assert` ve `scroll_to` ile çalışır; `scroll_to`, `assert`, `gesture` (çift dokunma, uzun basma, sürükleme, pinch, serbest plan), `keyboard`,
  `alert` (her sistem uyarısı), `press_key` içinde donanım düğmeleri, `app`, `simulator`, `device_setting`, `clipboard`.
- Paralel ajanlar için cihaz talepleri, daemon olmadan. Aracın değiştirdiği koşullar geri konur.
- Protokol 1.3: ajanın `wait`'i.
- `long_press` ve `pinch` artık `gesture`'ın türleri, `dismiss_alert` artık `alert`, `set_clipboard` da `clipboard`.

- Performans: `packages/perf` her ölçümü bağlamıyla saklar; baseline'lar ve bütçeler `.appdyno/perf/` altında; kapı olarak `perf_compare` ve `appdyno perf compare|baseline|budget`; saklanan bir trace üzerinde `perf_query`; Android'de duruma göre açılış, derleme denetimi ve bir başlangıç trace'iyle, kare istatistikleri, thread'ler, ağ, enerji, çıkışlar, boyut ve heap profilleri; iOS simülatörlerinde isteğe bağlı bir kare probe'u; bir iPhone'da kendi uygulamamızda takılmalar, donmalar ve açılış. Neyin nerede çalıştığı `docs/perf.md`'de.
- Belgeler: yeni kullanıcılar için bir README, CONTRIBUTING, SECURITY ve bir CI workflow'u (lint, tip denetimi, birim testleri, ajan birim testleri).
- iOS simülatörleri dokunuşlarını doğrudan alır ve okumalarını doğrudan yanıtlar: `SimHID` (simülatörün `dtuhidd`'si, Mac'ten) ve `SimAX` (erişilebilirlik anlık görüntüleri, simülatörün içinde); ikisi de ilk kullanımda derlenir ve runner'a karşı denetlenir, reddettikleri her şeyi runner yanıtlar. `docs/protocol.md`, `docs/perf.md`. `appdyno doctor --serial <simulator>` onları bildirir; `APPDYNO_SIM_DIRECT=off|read`.
- Simülatörlerde iki parmaklı hareketler.
- Runner'ın `hello`'su ve `visible` bayrağı artık ekran için `UIScreen`'in 320 x 480'ini almıyor: o çizginin altındaki her şey görünmez olarak işaretleniyordu.
- `launch`, çalışan bir uygulamayı olduğu gibi öne getirir, simülatörde de telefonda da; temiz bir başlangıç için önce onu durdurun.
- iPhone imzalaması kendiliğinden bulunur: telefonu adlandıran, wildcard uygulama kimlikli bir geliştirme profili ve kilidi açık giriş anahtar zincirindeki kimliği. `APPDYNO_IOS_PROFILE` yine önceliklidir; anahtar zinciri ve parola isteğe bağlıdır; `APPDYNO_IOS_TEAM` runner'ı Xcode'un hazırlamasını sağlar.
- iPhone ölçümleri: bellek ve CPU (Activity Monitor), CPU profili ve donmalar (Time Profiler), açılış süresi. Simülatörlerde `perf_profile` Time Profiler'ı kullanır: macOS 27 altında `sample` bir simülatör uygulamasının hiçbir meşgul örneğini görmez. `xctrace` kayıtları aracın kendi "started" bildirimini bekler ve durdurulmaları sınırlıdır.
- Bir telefondaki takılmalar, trace'te hiç kare yokken UNSUPPORTED yanıtını verir, asla "no hitches" değil (iOS 27.0.1'de Xcode 27.1).
- `Device.virtual`: bir iPhone'a artık sanal cihaz denmiyor.
- Başlamakta olan bir runner nereye kadar geldiğini stderr'de söyler.

- Android'de durulma: yalnızca bir şeye karar verilebildiğinde okur (iki ekran arasında ya da bir geçişin yeni penceresinden önce, WMS'in söylediğine göre, hiç okumaz; bir olay sonrakini öne çeker) ve API 34+'ta bir pencerenin kayması sırasında, her yer ve görünürlük durduğunda olacakları gibi bir yanıt (`settle.moving`); sonraki işlem ya da ekran görüntüsü kaymanın sonunu bekler. Bkz. `docs/protocol.md` "Durulma".
- İki ekran arasında yanıtlanan bir işlem ya da okuma artık "0 elements" demez: sonraki ekranı bekler, yoksa `NOT_FOUND` ile başarısız olur.
- Compose `testTag`, resource id'si olmayan bir düğümün id'sidir ve extras'ından okunur: uygulamada değişiklik gerekmez.
- `--animations off` (`APPDYNO_ANIMATIONS=off`): cihazın animasyon ölçekleri oturum boyunca kapalıdır; son host ayrıldığında ya da ajan ölürse bir izleyici süreçle geri gelir; performans ölçümleri için açılır; kapalı bırakılmışsa `doctor --serial` uyarır.
- Modüle göre paketler (`core`, `driver-android`, `driver-apple`, `ops`, `mcp`, `cli`, `appdyno`); import kurallarını bir test zorunlu kılar. Komutlar: `appdyno` (`appdyno mcp` ile) ve `appdyno-mcp`.
- İşlem başına tek tanım: her MCP aracı aynı zamanda bir komuttur (`appdyno screen`, `appdyno long-press --x 1 --y 2`, `--json`, `--out`).
- Cihaz portları ve ölçüm kaynakları: bir ölçümü olmayan cihaz hangisinin eksik olduğunu söyler. `perf_snapshot`, `pssKb` ve `footprintKb` yerine `memoryKb` ve `memoryKind` yanıtını verir.
- Açılırken başarısız olan bir cihaz istemciye iç hata olarak değil, nedeni ve ipucuyla ulaşır.
- iOS runner portunu ve token'ını yeniden okur (`TEST_RUNNER_APPDYNO_*`).
- Gezinme çubuğu soldayken yatay konumda `screen.window` bilinir, böylece oradaki kaydırmalar gerçek ekranı kullanır.
- Erişilebilirlik denetimi (`device.audit()`): iOS'ta runner üzerinden platformun denetimi (`audit`),
  Android'de ise host'un bir ağaç, bir ekran görüntüsü ve her metnin göstermediği karakterler üzerindeki denetimleri
  (düğümlerin gezinme ipuçlarını da getiren `a11y.read`): dokunma hedefleri, metin ve simge kontrastı, adlar, yinelenen adlar, kesilmiş metin.
- Android ağacında bayraklar: erişilebilirlik için önemli değil ve bir ekran okuyucunun tek birim olarak okuduğu.
- Bir simülatör runner olmadan açılır, okur ve dokunuş alır: bir sistem uyarısı, metin girişi, bir görüntü, bir denetim ya da farklı yerlerde bulunan bir kontrol için başlar.
- İlk `launch_app` uygulamayı ajanla ya da yardımcıyla birlikte başlatır. `am start`'ın `Status: timeout`'u bir başarısızlık değildir: 500 yükte hâlâ çizen bir uygulama başlamamış diye reddediliyordu.
- Bir ref'e son yanıtın gösterdiği yerde değil, ekranın onu o an gösterdiği yerde dokunulur: bir uygulama hiçbir işlem olmadan bir şeyleri yerinden oynatabilir.
- Bir yanıtın görüntüsü 60 kalitede 800 px'tir ve bir satırın yerinde onun adını taşıyan bir kontrol durduğunda yanıt o satırı bir kez söyler.
- Yeni bir Android ajanı, öldürülen bir ajanın gitmesini bekler; sistem onu yaklaşık 2 s boyunca UI otomasyonunun sahibi olarak tutar: o anda bir başlangıç `AGENT_CONFLICT` ile reddediliyordu.

Hâlâ açık olanlar:

- `simctl pbcopy` Xcode 27.1'de, yeni bir simülatörde bile hiçbir şey yazmaz, bu yüzden bir simülatörün panosu runner'a bağlıdır; runner'ın çağrısı yüklü bir Mac'te takılabilir: `clipboard` o zaman reddeder ve bunu söyler.
- Bir Xiaomi'de kapı baseline almaz: cihaz yükü 8 sınırının üstünde kalır.
- `network` `packets`, Android 16'lı bir Xiaomi'de hiçbir şey kaydetmez; nedenine bakılmadı. Yanıt bunu söyler.
- iOS 27.0.1'li bir iPhone 13 Pro Max'te `record`: `devicectl`'de böyle bir yetenek yok. Hiçbir telefonda çalıştığı görülmedi.
- HyperOS'un kurulum sorusu bir kişi gerektirir: bkz. "Bir telefona ulaşmak".

## 0.5.0

- Paketleme: `scripts/install.sh` MCP sunucusunu ve `appdyno` komutunu bu
  kopyadan kurar; paket önceden derlenmiş Android ajanını ve iOS runner'ın kaynaklarını taşır (build olmayan yerde
  ilk kullanımda bir kez derlenir). Her parça için tek sürüm, bir testle denetlenir.
- `appdyno doctor`: Android SDK ve adb, Xcode, runner build'leri, iPhone imzalaması ve
  bağlı cihazlar (adb, açık simülatörler, USB üzerinden iPhone'lar).
- iOS: durulma sırasında çıkan bir sistem uyarısı ya da sheet, animasyonla girerken meşgul sayılır; bu sayede
  XCTest'in olay sentezleyicisi üzerinden dokunuş varsayılandır (bir telefonda XCUI'nin dokunuşunun yaklaşık
  yarısı kadar sürer; `APPDYNO_FAST_TAP=0` onu kapatır).
- iOS runner simülatörde ve telefonda simgesiyle "appdyno" olarak görünür.
- adb istemcisi her kesintiden sonra adb sunucusunu yeniden başlatır (çağrılar arasında başka bir aracın `adb kill-server`'ı
  zararsızdır).

## 0.4.0 — gerçek iPhone

- USB üzerinden bir iPhone'da runner: bir geliştirme profili için yeniden imzalanır (bundle id'ler profilden,
  kimlik yalnızca kilidi açılmış bir anahtar zincirinden), telefonda o id altında başka bir build varsa
  kurulur, xcodebuild ile başlatılır, Mac'in USB çoklayıcısı üzerinden ona ulaşılır.
- Telefonda uygulamalar ve bağlantılar devicectl üzerinden; metin tuş olarak (runner orada panoya
  ulaşamaz).
- Telefonda animasyon takılmaları Xcode'un trace aracı üzerinden; simülatörde sızıntılarıyla birlikte bir bellek
  grafiği; MCP'deki perf_trace ve perf_heap iOS'ta yanıt verir.

## 0.3.0 — iOS simülatörü

- Runner: protokolü bir loopback portunda sunan bir UI testi; XCUI'nin boşta beklemeleri kapalıyken public
  anlık görüntüler (tek bir shim, public yedek); önce yapıştıran yazma; yalnızca okumalardan durulma.
- Mac'ten simülatör performansı: bellek, CPU, açılış, CPU profili (uygulamanın kendi fonksiyonları meşgul
  süreye göre sıralanır).
- MCP: simülatörler id ile listelenir ve yönetilir.

## 0.2.0 — Android, sağlamlaştırılmış

- Durulma: tepki veremeyen bir şeye dokunuş 80 ms sonra durulur; yüklü bir cihazda bekleme süresi uzar
  (yavaş okumalar, geç uyanmalar); durgunluk yalnızca bir okumanın başlangıcına kadar kanıtlanır.
- Doğruluk testleriyle performans araçları: kareler, kare zaman çizelgesi, bellek, CPU, açılış, CPU profili, heap dökümü.
- Her araçta çıktı şemaları ve annotation'lar; gecikme geçmişi ve gerileme kapısıyla yerel CI.
- Gerçek Android telefonlar: enjeksiyon izni, yazma, sahte konum (gps, network, fused), yeniden bağlanma,
  kapalı ekran ve kilit ekranı.

## 0.1.0 — Android emülatörü

- Cihazdaki ajan (shell kullanıcısı, UI otomasyonu), hat protokolü, host kütüphanesi ve işlem yapıp okuyan
  yanıtları ve yerel bir politikası olan MCP sunucusu.
