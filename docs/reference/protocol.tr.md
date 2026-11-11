# Host ↔ ajan protokolü (v2)

[English](protocol.md)

Host kütüphanesi cihazdaki bir ajanla tek bir bayt akışı üzerinden konuşur: Android'de ajanın adb sunucusu üzerinden açılan abstract bir unix
soketi (`localabstract:<name>`), iOS'ta bir TCP bağlantısı
(simülatör loopback'i ya da bir telefona usbmux bağlantısı). Mesaj biçimlerinin asıl kaynağı
`packages/protocol/src/messages.ts`'tir, ekranın ağacı `tree.ts`'te, bir denetimin bulguları `audit.ts`'tedir. Host bir isteğin parametrelerini ona göre ayrıştırır, bu yüzden oradaki bir varsayılan bağlantı üzerinden giden değerdir
ve bir ajanın kendine ait varsayılanı yoktur: eksik bir değer `INVALID_ARGUMENT` olur. `packages/protocol/fixtures` her isteği,
sonucu ve hatayı kanonik JSON olarak tutar; protokolün testleri bunları şemalara göre denetler, Android
ajanının ve iOS runner'ının testleri de kendi kodlarıyla okur; `packages/protocol/test/native.test.ts` üçünün de yazdığı
hata kodlarını, düğüm bayraklarını ve sürümü karşılaştırır.

## Çerçeveler

```text
[u32 BE payload length][u8 type][payload]
```

| tür | payload                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------ |
| 0   | bir JSON-RPC 2.0 mesajı, UTF-8                                                                         |
| 1   | ikili bir ek: `[u32 BE request id][bytes]`, o id'yi taşıyan JSON yanıtından hemen önce gönderilir      |
| 2   | bir video karesi, yalnızca cihazdan host'a: `[u64 BE capture us][u64 BE sent ns][u32 BE flags][bytes]` |

64 MiB'den büyük bir çerçeve, bilinmeyen bir tür ya da ayrıştırılamayan bir JSON çerçevesi bağlantıyı sonlandırır.

## El sıkışma

Bir bağlantıdaki ilk istek, ajanın açılışta aldığı başlatma token'ını taşıyan bir `hello` olmalıdır
(yalnızca shell kullanıcısının okuyabildiği, ajanın okuyunca sildiği `--token-file` dosyasından; en az 16 karakter, sabit sürede karşılaştırılır). Başka her şey bağlantıyı kapatır.

```json
{ "jsonrpc": "2.0", "id": 1, "method": "hello", "params": { "token": "…", "protocol": 2 } }
```

Sonuç ajanın build'ini, protokol sürümünü (`major` host'unkine eşit olmalıdır), platformu, işletim sistemini,
modeli ve ekranı (cihaz pikseli cinsinden `w` ve `h`, `density`, `rotation`) bildirir. Bir host yalnızca kendi
build'inin ajanını çalıştırır, bu yüzden bir ajanın hesaba katması gereken başka sürüm yoktur.

## Süre sınırları ve iptal

Her istek `params._deadlineMs` taşır; bu değer olmadan cihaz işine giden bir istek bağlantıyı sonlandırır. İş daha uzun sürerse ajan `TIMEOUT` yanıtını verir ve
işe durmasını söyler (uzun döngüler bir iptal bayrağını yoklar; framework içinde takılan bir çağrı da
framework vazgeçtiğinde yine döner). Host süre sınırından bir saniye fazla bekler, sonra çağrıyı
kendisi başarısız sayar ve `cancel {id}` gönderir. Cihaz işi tek bir thread'de geliş sırasıyla çalışır; `hello`, `ping` ve
`cancel` hemen yanıtlanır.

## Metotlar

| metot                             | parametreler                                                                                            | sonuç                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `hello`                           | `token`, `protocol`                                                                                     | ajan ve cihaz açıklaması                                                                  |
| `ping`                            | –                                                                                                       | `uptimeMs`, `atMs` (cihazın duvar saati)                                                  |
| `tree.get`                        | `maxDepth` (128), `maxNodes` (5000), `pkg?` (iOS)                                                       | `Tree`                                                                                    |
| `act`                             | `action`, `settle?`, `read` (`none`/`hash`/`tree`), `before?`, `pidOf?`                                 | `settle?`, `animationWaitMs?` (iOS), `hash?`, `tree?`, `pid?`                             |
| `text.set`                        | `text`, `replace`, `submit`, `at?`, `focusTimeoutMs` (5000; iOS sürücüsü 2000 ister), `settle?`, `read` | `act` gibi, ayrıca `mode` (`setText`/`paste`/`keys`), `verified`, `submitted?`, `focusMs` |
| `text.keys` (iOS)                 | `text`, `into?`, `focusTimeoutMs` (6000)                                                                | `focusMs`                                                                                 |
| `screenshot`                      | `format` (`jpeg`/`png`), `quality` (80), `maxPx?`                                                       | `w`, `h`, `format`, `bytes`, ayrıca görüntüyü taşıyan bir ek                              |
| `app.foreground`                  | –                                                                                                       | `pkg?`                                                                                    |
| `permission.reset` (iOS)          | `pkg`, `service`                                                                                        | –                                                                                         |
| `app.target` (iOS)                | `pkg` (bundle id)                                                                                       | –                                                                                         |
| `app.labels` (Android)            | –                                                                                                       | `apps`: bir launcher'ın gösterdiği her uygulamanın `id`, `name`'i                         |
| `clipboard.set` / `clipboard.get` | `text` / –                                                                                              | – / `text?`                                                                               |
| `animations.wait` (iOS)           | `x`, `y`                                                                                                | `ms?`                                                                                     |
| `orientation.set`                 | `rotation` 0–3 (sabitlenir), `kept?`                                                                    | –                                                                                         |
| `animations.set`                  | `off`                                                                                                   | –                                                                                         |
| `locales` (Android)               | `set?`                                                                                                  | `tags`                                                                                    |
| `rest.wait`                       | –                                                                                                       | –                                                                                         |
| `audit` (iOS)                     | `types?`, `maxIssues` (50)                                                                              | `issues`, `truncated`, `elapsedMs`                                                        |
| `a11y.read` (Android)             | `maxNodes` (60)                                                                                         | `tree`, `clips` (`n`, `chars`, `hidden`), `traversal` (`n`, `before?`, `after?`)          |
| `touch` (Android)                 | `p` (0 basma, 1 hareket, 2 bırakma), `x`, `y`, `x2?`, `y2?`: ekranın kesirleri, durulma yok             | –                                                                                         |
| `stream.start` (Android)          | `codec` (`h264`/`hevc`), `quality`, `maxSize?`, `failFirst?`, `startSize?`, `roomMs?`                   | –, ardından bağlantı bitene kadar bu bağlantıda video kareleri                            |
| `stream.clock` (Android)          | –                                                                                                       | `now` (ns)                                                                                |
| `stream.sync` (Android)           | –                                                                                                       | –                                                                                         |
| `stream.status` (Android)         | –                                                                                                       | `active`, `on`, `w`, `h`, `rotation`, `modes`, `dropped`, `behind?`                       |
| `wait`                            | `since?`, `timeoutMs`, `minMs` (300)                                                                    | `sig`, `changed`, `reads`, `elapsedMs`, `tree?`                                           |
| `cancel`                          | `id`                                                                                                    | –                                                                                         |
| `shutdown`                        | –                                                                                                       | – (ajan kapanır)                                                                          |

`action` şunlardan biridir: `tap {x,y}`, `doubleTap {x,y}`, `longPress {x,y,durationMs}`, `swipe {from,to,durationMs}`,
`gesture {pointers}` (1–5 parmak, her biri `{x,y,t}` örneklerinden bir liste; parmaklar ilk örneklerinde birlikte iner,
son örneklerinde birlikte kalkar) ve `key {key, modifiers?}` (`back`, `home`, `enter`, `delete`, `tab`,
`appSwitch`, `volumeUp`, `volumeDown`, `power`, `lock`, `escape`, `space`, `arrowUp`, `arrowDown`, `arrowLeft`,
`arrowRight`, `mute`, `siri` ya da bir harf veya rakam; `modifiers` içindeki `command`, `control`, `option`, `shift` tuş boyunca basılı tutulur, Android'de
`command`, metin alanlarının kabul ettiği Ctrl'dir). Koordinatlar cihaz pikselidir.

`act` ve `text.set` üzerindeki `pidOf` (Android), yanıtın işlem bittiğinde `pid` içinde sürecini verdiği bir uygulamayı
adlandırır, uygulama hiçbir süreçle çalışmıyorsa 0: bir host onu işlemden önceki süreçle karşılaştırır, çünkü sistemin
hemen yeniden başlattığı bir çökme başka hiçbir şeyde görünmez. Söyleyemeyen bir ajan, eski bir ajanın yaptığı gibi, `pid`'i dışarıda bırakır ve host `pidof`'a sorar.

### Bekleme

`wait` ekranı durulmanın okuduğu gibi her 80 ms'de okur ve özeti `sig` (her düğümün
sınıfı, id'si, metni, açıklaması, sınırları ve bayrakları ile pencereler) `since`'ten farklı olduğunda, en erken
`minMs` sonra, `tree` ile yanıt verir. `since` yoksa ilk okumadan sonra yanıt verir. `timeoutMs` dolunca
ağaç olmadan `changed: false` yanıtını verir. Host gelen yanıt üzerinde eşleştirme yapar, bu yüzden tek bir eşleştirici her
seçiciye, ref'e ve denetime hizmet eder ve durgun bir ekran tek bir yanıta mal olur. Sonsuz bir animasyon her `minMs`'te yanıt verir,
bu da yoklamadan kötü değildir. Runner'ı açık olmayan bir simülatör her 300 ms'de `tree.get` ile yoklanır;
`wait`'i başarısız olan bir ajan da öyle.

### iOS

Runner, loopback'te tek bir TCP portu sunan bir UI testidir (`ios/Runner`); simülatör Mac'in loopback'ini
paylaşır. Koordinatlar point'tir (`screen.density` ölçektir). Runner,
`app.target` uygulaması öndeyken onu, değilse ana ekranı okur ve üzerinde işlem yapar; uygulamanın üstündeki bir sistem uyarısı
ikinci bir penceredir (tür 3, `com.apple.springboard`). Geri tuşu yoktur. iOS bir teste erişilebilirlik olayı göndermez,
bu yüzden durulma kararını yalnızca okumalara göre verir. Ekranın boyutu ana ekran uygulamasının çerçevesinden gelir:
başlatma ekranı olmayan bir runner'a daha büyük bir ekranda `UIScreen` 320 x 480 der, bu da onun
altındaki her şeyi görünmez olarak işaretliyordu.

#### Simülatörler: doğrudan girdi ve okumalar

Bir simülatörün dokunuşları ve okumaları, iki küçük yardımcının (`ios/SimHelper`, ilk kullanımda clang ile
derlenir, özel API) kendini kanıtladığı yerde runner'ı atlar. Runner kalır: hello, metin, ekran görüntüleri,
pano ve aşağıdaki her durum için. `APPDYNO_SIM_DIRECT=off` ikisini de kapatır, `read` girdiyi runner'a bırakır.
`appdyno doctor --serial <simulator>` ikisinin de yanıt verip vermediğini söyler.

`text.set` iOS'ta tuş olarak girer (`mode: keys`): kullanıcının yapmadığı bir yapıştırma, onu bekleten "Allow Paste" uyarısını açar.
`text.keys`, bir kişinin bir pencerede yazdığıdır: XCTest'in olay sentezleyicisine bir string; hiçbir öğe aranmaz ve hiçbir şey geri okunmaz. `into`, bir dokunuşun düştüğü alanın bir noktasıdır: harfler o alanın odağı almasını bekler ve süre sınırında `NO_FOCUS` yanıtını verir; hiçbir şeye dokunulmaz.
`clipboard.get` yalnızca runner'ın kendi yazdığını yanıtlar, çünkü başka bir uygulamanın metnini okurken kullanıcıya sorulur; bir simülatörünki onun yerine
`simctl pbpaste` ile okunur, bir iPhone'unki de iki yönde de `devicectl device pasteboard` ile gider, çünkü runner panoya yalnızca öndeyken erişebilir. `simctl pbcopy`'nin hiçbir şey yazmadığı yerde (yeni bir iOS 26.5 simülatöründe Xcode 27.1) panoyu runner ayarlar ve okur. Bu bilinen bir sınırdır: yük altındaki bir Mac'te runner'ın çağrısı da takılabilir (yük 138'deyken iki kez) ve `clipboard` o zaman yaklaşık 20 s içinde `UNSUPPORTED` ile ve nedenini söyleyerek reddeder, runner da yeniden başlatılır.

iOS'ta klavyeyi kapatacak ya da uygulama değiştiriciyi açacak bir tuş yoktur. `dismissKeyboard`, klavye bir gizleme tuşu gösteriyorsa ona,
yoksa kontrol olmayan bir yere dokunur; host sonra klavyenin gidip gitmediğini okur ve gitmediyse reddeder. `appSwitch` bir simülatörde
iki kez basılan Home'dur, bir pencerenin kontrolüyle aynı girdi; ikinci basıştan yarım saniye sonra yanıt verir,
çünkü iOS daha erken gelen bir basışı o ikisinin parçası sayar; bir telefonda ana ekran göstergesinin yukarı doğru yavaş sürüklenmesidir. Denetim Merkezi ve Bildirim Merkezi, bir simülatörde bir pencerenin kontrollerinin yansıtmanın
girdisiyle gönderdiği sürüklemelerdir: `act`, altlarındaki uygulamanın dokunuşu bildirmesini beklerdi, bildirmeyince onu kayıp sayıp
yeniden yapardı. Spotlight, ana ekrandan Command-Space'tir. Her biri ana ekran uygulamasına aittir, bu yüzden onu
`home` kapatana kadar okunan odur. Ses, kilit ve güç tuşları bir simülatörde doğrudan girdiyle, bir telefonda
`XCUIDevice` ile gider; orada kilit ve güç özel `pressLockButton`'u kullanır.

- **Girdi**, Mac'te `SimHID`: simülatörün `dtuhidd`'sine XPC (`com.apple.coredevice.feature.remote.hid.digitizer`).
  Dokunma, uzun basma, kaydırma, tek ve iki parmaklı hareketler ve bir HID kullanımı olan tuşlar, bunlar boyunca basılı tutulanlarla birlikte. Son olaydan
  sonraki bir bariyer bir daemon'un onları aldığını kanıtlar; metin Unicode için runner'da kalır. Hiçbir şeyi değiştirmemiş ve
  uygulamanın bittiğini (`TouchEventsCompleted`) durulmadan sonraki 4 s içinde bildirmediği bir dokunuş oraya hiç
  ulaşmamıştır (Resize Mode'daki bir Device Hub dokunuşları yutar ve başarı bildirir): runner onu yeniden yapar ve oturum boyunca
  işi devralır. Yalnızca dikey, çünkü doğrulanan buydu; diğer yönler runner'a gider.
- **Ayarlar**, `simctl spawn` ile simülatörün içinde `SimOpen`: `prefs:` ve `settings-navigation:` özeldir ve `simctl openurl` bunlar için reddedilir (LaunchServices hatası 115). Onları, bir simülatörün okuduğu `__entitlements` bölümü olarak içine bağlanmış `com.apple.springboard.opensensitiveurl` ile açar, çünkü bunu taşıyan bir imza başlamaz. XCUI'nin `open`'ı da sayfaya ulaştı, sonra runner'ı iki dakika bekletti. Bir iPhone bağlantıyı Ayarlar'a `devicectl`'in `--payload-url`'i olarak alır. Bir uygulamanın kendi sayfasının bağlantısı yoktur: Uygulamalar'daki satıra dokunulur.
- **Trafik**, `DYLD_INSERT_LIBRARIES` ile uygulamaya enjekte edilen `NetProbe`: biten her istek için `APPDYNO_NET_LOG`'un gösterdiği dosyaya bir JSON satırı yazan bir `NSURLProtocol`. Bir simülatörün uygulaması Mac'in dosyalarına doğrudan yazar.
- **Web sayfaları**, `simctl getenv <udid> RWI_LISTEN_SOCKET`'in gösterdiği soket: her biri 4 baytlık uzunluğundan sonra gelen ikili property list'ler. `_rpc_reportIdentifier:` uygulamaları, `_rpc_forwardGetListing:` bir sayfa listesini, `_rpc_forwardSocketSetup:` bir `Target.targetCreated` getirir; `Target.sendMessageToTarget` de sayfaya gideni sarar.
- **Okumalar**, `simctl spawn` ile simülatörün içinde `SimAX`: bir ağaç tek bir `XCTAccessibilityFramework`
  `userTestingSnapshotForElement:options:error:` isteğidir; bir derinlik reddedilirse yarı derinlikle yeniden istenir,
  derinliğin kenarında çocukları olmadan dönen her düğümden de yeniden istenir. Modal görünümleri XCUI gibi dikkate alır, böylece bir sheet'in örttüğü şey yanıtta yer almaz: bunu yapmadan önce bir listenin üstündeki bir sheet, alttaki liste de içinde 215
  düğüm olarak okunuyordu, runner ise 49 düğüm okuyordu. Düğümler, runner'ın kurduğu gibi, iki suite'in de `packages/driver-apple/test/fixtures/runner-rules.json`'dan okuduğu kurallarla kurulur ve bir test tür tablolarını karşılaştırır; böylece ref'ler, hash'ler ve diff'ler kimin okuduğuna
  bağlı olmaz. Bir dokunuşun bir kontrolün hangi kopyasına ulaştığını yalnızca XCUI söyler: iki ya da üç farklı yerde bulunan
  bir kontrolü olan bir yerleşim bir kez runner'a gider ve onun kararı yerleşimin özeti altında saklanır. Diğer her yerleşim runner'a
  ihtiyaç duymaz. Runner başka bir şey için açıldığında, henüz görülmemiş bir yerleşim onun okumasıyla da karşılaştırılır (yaklaşık 100 ms, yerleşim başına
  bir kez): farklı oldukları yerde yanıt runner'ınkidir ve ilk uyuşmadan önceki üç fark yardımcıyı oturum boyunca
  kapatır. XCTest'in kendi çalışması için açtığı anahtarlar kapalıyken bir uygulama erişilebilirlik sunucusuna hiçbir şey söylemez
  ve XCTest bunları sonunda kapatır; bu yüzden yardımcı, sorulduğu sürece `no-foreground` yanıtını verdi:
  yardımcı bunları açar (`_AXSApplicationAccessibilitySetEnabled`, `_AXSSetAutomationEnabled`) ve açan kendisiyse
  ve hiçbir runner kalmıyorsa, ayrılırken yeniden kapatır. `IgnoreAXServerEntitlements` gerekmedi.
- **Hello**, aynı yardımcıdan: model, işletim sistemi sürümü, ekran ve ölçek, aynı biçimde. `agentVersion`, bir runner
  başlayıp kendi sürümünü söyleyene kadar `helper`'dır. Runner,
  yalnızca kendisinin yaptığı ilk işte başlar: bir uyarı, bir sistem sorusu, metin girişi, bir görüntü, bir denetim ya da farklı yerlerde
  bulunan bir kontrolün okunması. Uygulamanın üstünde bir sheet aramak bunların hiçbiri değildir: uygulama öndeyse yardımcı bunu
  hemen söyler; önde olmayan bir uygulamanın okunması ise runner'ı getiren şeydir.
- **Bir okumayı runner yanıtlar**: adı verilen uygulama birincil uygulama olmadığında (üstünde bir sistem uyarısı, ana
  ekran, uygulamanın açılışı), uygulama bir uyarı gösterdiğinde, başka bir sürecin içeriği ekrana ulaştığında
  (`AXRemoteElement`: bir web sayfası, bir extension), pencere ekranı doldurmadığında ya da yardımcı başarısız olduğunda.
- **Host'ta durulma:** aşağıdaki gibi, her 20 ms'de ve adlandırılabilen ya da üzerinde işlem yapılabilen şeyleri herhangi bir sırayla karşılaştırarak, sistemin
  adsız görünümlerini değil: iOS 26'da bir cam çubuk ve kaydırma kenarı efektleri bir geçişten sonra 200 ms boyunca
  gelip gider. Doğrudan bir dokunuş 50 ms'de biter, XCTest'inki ise 300-600 ms sürüyordu; bu sürede uygulama, bekleme süresi başlamadan
  tepki vermişti: hiçbir şey tepki vermemişken bekleme süresi 500 ms'dir (ekranda bir uyarı varken: 1 s), bir şey tepki
  verdikten sonra 150 ms (120 ms, bir push'un bir anlığına bıraktığı bir arama çubuğuyla yanıt verdi; 150 ve 200 ms vermedi). Ekranın kenarından
  yeni taşmaya başlamış düğümler meşgul sayılır (en çok 1,2 s): bir push eski sayfayı, gidene kadar ağaçta hiçbir değişiklik
  olmadan orada bırakır. Kaybolan bir uyarı 600 ms, beliren bir uyarı da
  450 ms boyunca meşgul sayılır. Uygulamanın erişilebilirlik bildirimleri bir durulma sinyali değildir: `RunLoopIsIdle` ve `AnimationsNonActive`
  bir push sırasında ikisi de 3 ms içinde yanıt verir.
- **Bir dokunuştan önce** yardımcı uygulamaya en çok 1 s boyunca `AnimationsNonActive`'i sorar: UIKit bir görünüm
  animasyondayken dokunuş almaz ve ağaç onu daha baştan, bittiği yerde gösterir. Bir dokunuştan hemen sonra istenen bir bildirim,
  o dokunuşun başlattığı animasyondan önce gelir ve eskiden sonraki dokunuşu kaybettiriyordu (fixture'da 3'te 1), bu yüzden yalnızca uygulama
  o dokunuşu işlediğini bildirdikten sonra istenir (`TouchEventsCompleted`, bir dokunuşa iki tane, en çok 300 ms: dokunulanı başka bir süreç
  çiziyor olabilir). Durulma olmadan istenen bir okuma da aynı bildirimi bekler. Hiçbir bildirim bir push'u ya da pop'u kapsamaz: ağaç son halindedir
  ve bildirimler, UIKit yeniden dokunuş almadan çok önce her şeyin durgun olduğunu söyler; geri götüren dokunuştan sonraki 560 ms içinde
  yapılan bir dokunuş, uygulama onu işlediğini bildirdiği halde 30'da 7 kez kayboldu. Bu yüzden bir dokunuş, ekranı değiştiren dokunuştan 650 ms sonrasına kadar
  bekler; bir yanıt beklemez.
- **`launch`** çalışan bir uygulamayı olduğu gibi öne getirir (`simctl launch`; simülatörün içinden `LSApplicationWorkspace`
  yaklaşık 180'e karşı 800 ms sürdü) ve uygulama öndeyse hiçbir şey yapmaz; temiz bir başlangıç için önce onu sonlandırın.
  Uygulama birincil uygulama olunca döner. Bir açılış sırasında hiçbir uygulama birincil değildir, yük altındaki bir Mac'te saniyelerce; ana ekranın
  3 s boyunca öyle kalması uygulamanın üstünde bir sistem uyarısı demektir, bunu yalnızca runner söyleyebilir. Bir uygulama bundan sonra içerik ekleyebilir: yanıttaki bir ref
  yine de öğesine ulaşır, çünkü bir dokunuş hedefini en çok 150 ms önceki bir okumaya göre belirler.

### Ağaç

`windows[]`: `type` (erişilebilirlik pencere türü: 1 uygulama, 2 giriş yöntemi, 3 sistem, 4 overlay),
`pkg`, `layer`, `b` (`[left, top, right, bottom]`), `active`, `focused`.

`nodes[]` genişlik öncelikli sırayla: `p` (ebeveyn dizini, bir pencere kökü için −1), `w` (pencere dizini), `c`
(sınıf), `id` (kaynak id'si; Android'de, düğümün id'si yoksa extra'larından bir Compose `testTag`, uygulamada
değişiklik gerekmez), `t` (metin; bir alan ipucunu gösterirken yoktur), `d` (içerik
açıklaması), `h` (ipucu), `b` (ekrandaki sınırlar), `f` (bayraklar: visible 1, clickable 2, focusable 4,
focused 8, enabled 16, checked 32, selected 64, editable 128, scrollable 256, password 512, checkable
1024, long-clickable 2048).

`dark`, ekran kapalıyken true olur; bir ekran uyuklarken olduğu gibi uygulamanın pencereleri yine de listelenebilir. `moving`, bir pencere hâlâ yerine kayarken true olur; verilen yerler, pencerenin duracağı yerlerdir.

Android 4096 bayrağını (erişilebilirlik için önemli değil: bir ekran okuyucu düğümü atlar) ve 8192'yi (bir
ekran okuyucu düğümü çocuklarıyla birlikte tek bir birim olarak okur, Android 9+) ekler; ikisi de düğümün yerel alanlarıdır.

`truncated`, bir sınır (derinlik, düğüm, 8 s) ya da okunamayan bir düğüm dolaşmayı yarıda kestiğinde true'dur;
`elapsedMs` ajanın kendi süresidir; `hash` yerleşim özetidir (uygulamanın ve sistem iletişim kutularının pencerelerindeki görünür
düğümlerin sınıfı, id'si ve sınırları; metin hariç, düz bir metin düğümü yalnızca dikey olarak).

Bir test eden için hiç sözcüğü olmayan bir ağaç host'ta görüntüden okunur: ekranın bir PNG'si ilk kullanımda derlenen `mac/TextScan/TextScan.m`'ye
gider, o da Vision'ın satırlarını görüntünün kesirleri olarak yanıtlar: 3 s içinde accurate düzeyinkileri, yoksa fast düzeyinkileri; accurate tarama o görüntüye bir sonraki bakış için kendi sürecinde bitmeye bırakılır, sözcükleri okunur okunmaz ve her halükârda 5 dakika sonra silinen `0600` izinli bir dosyadadır; satırlar ağaca uygulamanın penceresinde `PictureText` sınıfı düğümler olarak
katılır. `hash` ajanınki olarak kalır. Bir cihazın `wait`'i bunların hiçbirini görmez, bu yüzden `wait_for` o zaman görüntüyü yoklar. Kendine ait
herhangi bir sözcüğü olan bir ekran asla bu yolla okunmaz: etiketli bir düğmenin yanındaki bir canvas üzerindeki sözcükler dışarıda kalır.

### Ne hareket ediyor

Önce ağaç, sonra `screenshot` `watchMs`, sonra bir video: bir ağaç orada ne olduğunu söyler, tek bir görüntü de yanlış akan bir kayan yazıyı gösteremez.

`watchMs`, cihazın tek yayınının viewer'ına `{op: "watch", id, ms, strip}` ile sorar, o da `{op: "watched", id, summary, strip?}` ile yanıt verir. Başka bir sürecin penceresi isteği durum klasöründeki bir dosyayla alır; penceresi olmayan bir cihaz da o izleme için penceresiz, kendine ait bir viewer alır. Kareler, viewer'ın bir pencere için çözdükleridir; bir kez griye çevrilip 360 örnek genişliğine getirilir ve `mac/Viewer/Motion.m` içinde okunur: 24 örneklik karolar her eksen boyunca saniyenin onda biri sonra aranır, aynı yöne kayan ve birbirine değen karolar bir bölgedir ve her adımdaki kaymalarının ortası, bölgenin nasıl hareket ettiğidir. Zamanlar, bir yayının onları taşıdığı yerde cihazın yakalama zamanlarıdır, çünkü kareler yolda yığılır. Bir adım kendi uzunluğunun vermesi gerekene göre değerlendirilir, bu yüzden geç bir kare sıçrama sayılmaz.

| Söylediği            | Anlamı                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `moves left at 80/s` | bütün izleme boyunca, bir `tap`'in birimleriyle sabit hız                                    |
| `smoothly`           | saniyenin onda biri ölçeğinde hiçbir şey onu bozmadı                                         |
| `jumped 40 at 1.2 s` | bir adım, süresinin vermesi gerekenden o kadar ileri gitti                                   |
| `ran backwards`      | olağan yönünün tersine gitti                                                                 |
| `stopped`            | hareket eden adımların arasında, içinde hiçbir şey hareket etmedi                            |
| `cut at x 240`       | devam edecek kadar yol almış olsa da orada, ekranın içinde biter                             |
| `changes`            | bir karenin izleyebileceği bir yönü olmadan değişir, dönen bir gösterge ya da bir solma gibi |

Sınırları önemli oldukları yerde söylenir: niyeti değil hareketi okur; bir video ya da oyun gibi ekranın büyük kısmının aynı anda değişmesine gürültü denir; saniyede 15 karenin altında hızlar ve sıçramalar tahmindir; saniyede yaklaşık 650 point'ten hızlı bir fırlatma kaybolur; bir bölge de bir karodan, bir telefonda yaklaşık 27 point'ten daha ince olamaz. Yayını olmayan bir cihaz neyin eksik olduğunu söyleyerek reddeder.

Maliyet, hiçbir pencere açık değilken bir iOS 27.2 simülatöründe ve bir API 34 emülatöründe: 3 s'lik bir izleme simülatörde 4,1 s'de, bir yayının başlayıp durulması gereken emülatörde 7,0 s'de, 10 ile 40 arası yükte yanıt verdi. Bir iPhone 13 Pro Max'te 3 s'lik bir izleme, saniyede 61 ile 62 kare arası bir yayınla, 4,5 ile 5,2 s'de yanıt verdi ve `device-tests/watch.test.ts` 7'de 7 geçti. Hiçbir pencere açık değilken bir Samsung A52'de 3 s'lik bir izleme, saniyede 82 ile 85 kare arası bir yayınla, 10 ile 20 arası yükte 7,2 s'de yanıt verdi ve `device-tests/watch.test.ts` 7'de 7 geçti, her hata adıyla söylendi. Bir Xiaomi 25078RA3EY'de aynı izleme, saniyede 60 ile 61 kare arası bir yayınla, yük 9'dayken 4,2 ile 4,3 s'de yanıt verdi ve aynı 7'de 7 geçti. Viewer, simülatörün izlemeleri boyunca, saniyede 120 karede, bir çekirdeğin medyan %14'ünü ve en çok %30'unu aldı. Bir yanıt, bir görüntüye karşı yaklaşık 100 karakterdir.

`strip`, izleme boyunca eşit aralıklı, yan yana en çok 8 kareden oluşan gri bir PNG ekler; zamanları yanıttadır. Dosyası okunur okunmaz silinir.

### Durulma

`settle {quietMs (200), maxMs (3000)}` ile ajan, işlemden sonra ekran
`quietMs` boyunca durgun kaldığında onu durulmuş sayar:

- her okuma yalnızca bir öncekinin değil, son değişikliğin yerleşimini gösterir; böylece yavaş bir hareket birikir
  ("aynı yerleşim": aynı görünür düğümler, sınıf ve id, aynı sırada, her biri yerinin 8 piksel yakınında; düz bir
  metin düğümü yalnızca dikey olarak);
- `quietMs` boyunca yerleşimi oynatan erişilebilirlik olayı yok (odak ve yalnızca metin olayları sayılmaz; olaylar
  tek başlarına durulmayı en çok `quietMs`'in iki katı kadar tutar, çünkü sonsuz bir animasyon hiç sessizleşmez);
- meşgul bir şey yok: bir ekran var (iki ekran arasında 100 ile 500 ms boyunca yalnızca durum çubuğu vardır), görünür
  ve ilerleme göstermeyen bir ilerleme çubuğu yok (bir döner simge, bir yükleme çubuğu, aralığı olmayan ya da
  Android 16'dan itibaren belirsiz türde aralığı olan: sayılardan bir aralığı olan biri yerinde
  durabilir) ve duracağı yer bilinmeyen, ekran dışında bir uygulama penceresi yok.

Okumalar uygulamaya yük bindirir, bu yüzden bir okuma ancak bir şeye karar verebildiğinde yapılır. Android'de: ekran yokken
ya da bir pencere geçişi sürüp yeni penceresini henüz göstermemişken hiç yapılmaz (geçiş WMS'ten gelir,
`syncInputTransactions(true)`, API 31+, bir okumadan önce ve durulmayı bitirecek bir okumadan sonra yeniden sorulur, çünkü
bir okuma, uygulamanın meşgul olduğu bir tıklamadan sonra onun UI thread'inde çalışır; bu, henüz olayı olmayan eski bir pencerenin
durgun bir ekran sayılmasını önler); bir değişiklik gören bir okumadan 40 ms sonra bir tane daha, çünkü olaysız bir hareket
yalnızca okumalarda görünür; değilse bekleme süresinin biteceği anda ya da yerleşimi oynatan bir olay gelirse daha erken.
`before` biliniyorsa ilk okuma bekleme süresinin sonundadır; bir bekletmenin ardından hemen gelir, yeni bir pencerenin
ondan sonra gelen ilk yerleşim geçişleri bir sonrakinde görünür. Bir pencerenin yalnızca sınırlarını değiştirmesi,
API 34+'ta yerleşimi oynatan bir olay değildir.

**Kayma sırasında yanıtlar.** API 34+'ta ekran boyutundaki bir uygulama penceresi ekranı dolduracak şekilde
durur, bu yüzden düğümlerinin yerleri, pencere o an nerede olursa olsun `getBoundsInWindow`'dan verilir: yanıtın
içeriği ve yerleri durmuş ekranınkilerdir. Görünürlüğü de durmuş halinkidir: ekranın kenarını
tamamen geçmiş bir düğüm görünür sayılır, üstteki bir pencerenin altındaki bir düğüm ise görünmez. `settled` anlamını
korur (içerik bekleme süresi boyunca durgun kalmıştır). `settle.moving` (ve bir ağaçta `moving`) bir geçişin
hâlâ sürdüğünü söyler. Her işlem ve ekran görüntüsü, süren bir geçişin bitmesini cihazda bekler. Başka her pencere biçimi, kayan pencerede
görünür sanal bir düğüm (Compose, bir web görünümü: pencerede yeri yok) ve API 33 ile altı
böyle bir yanıt almaz: ajan kaymanın sonunu, sonra bekleme süresini bekler.

Yük altındaki bir cihazda bekleme süresi (en çok 4×), ajanın kendi okumalarının okunan düğüm başına yakın geçmişteki en iyilerinden
ne kadar yavaş olduğuna göre uzar: yavaş bir cihaz tepkisine de daha geç başlar.

Bir yanıt asla boş bir ekran göstermez: iki ekran arasında istenen bir okuma sonrakini bekler (açık bir ekranda 2 s),
yoksa istek, bir işlemden sonra da, `NOT_FOUND` ile başarısız olur.

Bekleme süresi işlemin başından değil sonundan sayılır: iOS'ta sentezlenmiş bir dokunuş tek başına
300–600 ms sürer ve başından sayılan bir bekleme süresi uygulama dokunuşu almadan tükeniyordu (300 ms
geç tepkiler 10 seferin 10'unda kaçırıldı). İlk okuma, `before` ajanın yakın zamanda gönderdiği bir yerleşimi adlandırdığında onunla karşılaştırılır
(değilse ilk okuma bir değişiklik sayılır), bu yüzden hiçbir şeyi değiştirmeyen bir işlem döndükten
`quietMs` sonra biter. iOS'ta hiçbir şeyi değiştirmeyen, işlem yapılabilir bir dokunuş sonra en çok 0,8 s boyunca bir
sistem uyarısı gelip gelmediğini izler ve ekran bu izlemeden sonra yeniden okunur: bu bekleme ajanın kendisinindir, ayrı tutulup `idleMs` olarak söylenir
ve hiçbir `ms`'e girmez, böylece bir adım iki platformda da aynı okunur; bir dokunuşun yanıtı da hiçbir uyarı gelmediğini söyler. Bir kontrolün kopyası olan
bir ekran, `before` gönderildiği gibi, gizli kopyaları dışarıda bırakılarak karşılaştırılır. Durulma işlemden sonra
`maxMs` dolunca durur; sonuç `settled`'ı, süreyi, okuma sayısını ve kullanılan bekleme süresini söyler.

Noktası, `before`'un adlandırdığı ekranda tepki verebilecek hiçbir şeye denk gelmeyen bir dokunuş (düz metin, bir görsel,
boş alan; tıklanabilir, uzun tıklanabilir, düzenlenebilir ya da işaretlenebilir bir düğüm ya da onların içindeki bir şey değil, bir
web, harita ya da surface görünümü değil, klavyenin ya da başka bir pencerenin üstündeki bir nokta değil) 80 ms'lik bir bekleme süresi kullanır.

Bekleme süresinin yakaladıkları, fixture'ın geç tepki ekranında ölçüldü (emülatör, host yükü yaklaşık 10; 200 ms
satırı bugünkü durulmayla gecikme başına 15 dokunuşla, diğerleri önceki durulmayla 50 ile; yük altındaki bir host'ta bekleme süresi
uzar):

| bekleme süresi      | yakalanan tepkiler          | kaçan           |
| ------------------- | --------------------------- | --------------- |
| 200 ms (varsayılan) | 250 ms'ye kadar her gecikme | 300 ms'de 15/15 |
| 250 ms              | 250 ms'ye kadar             | 300 ms'de 10/50 |
| 300 ms              | 300 ms'ye kadar             | 350 ms'de 49/50 |

Bunu yeniden çalıştırmak için `node packages/appdyno/scripts/settle-proof.mjs <serial>` (bekleme süresini `QUIET` ayarlar) ya da
bir simülatör için yanındaki `ios-settle-proof.mjs <simulator id>` çalıştırılır. Önce derleyin, sakin bir Mac'te.

Bekleme süresinden geç başlayan bir tepki (bir ağ yanıtı, bir zamanlayıcı) beklenmez: onun yerine öğeyi
bekleyin. Tıklanabilir olarak işaretlenmemiş bir görünümdeki dokunma dinleyicisi tepkisiz sayılır;
80 ms içinde tepki veren bir dinleyici yakalanır (30 ms'de 0/50 kaçırıldı), daha yavaşı yakalanmaz.

### Animasyonlar

`animations.set {off}` (host: `--animations off`, `APPDYNO_ANIMATIONS=off`,
`AndroidDevice`'ın `animations` seçeneği) üç sistem animasyon ölçeğini 0'a ayarlar. Bunu isteyen son bağlantı gittiğinde
ölçekler eski hallerine döner; ajan önce ölürse onu izleyen ayrı bir shell süreci onları geri getirir
(bir saniye içinde). Bir oturumun ilk performans ölçümü onları oturumun geri kalanı için
geri koyar, çünkü bir ölçüm bir kullanıcının gördüğünü görmelidir. `doctor --serial` 0'da bırakılmış ölçekler hakkında uyarır (bir oturum
sırasında yeniden başlatma onları öyle bırakır).

`device_setting` `animations` ve `reduce_motion` (Android: aynı üç ölçek) da onları değiştirir. Eski değeri bir seferde
yalnızca biri tutar: önce seçenek bırakır, ajan ölçekleri geri koyar ve eski değer ancak ondan sonra
okunup not edilir, böylece hiçbiri diğerinin üstüne geri yükleme yapmaz.

### Yön

`orientation.set {rotation}` ekranı o dönüşte sabitler, bu da döndürme kilidini etkinleştirir. Bir host bulduğu kilidi
ve kullanıcı dönüşünü (`accelerometer_rotation`, `user_rotation`) bir koşul olarak not eder; bunlar
`device_setting restore` ile ve oturum sonunda, komut satırınınki yalnızca restore ile geri konur. Sistem, ajan UI
automation'ı bıraktığında onun son bağlandığında bulduğu dönüşü geri koyar, bu yüzden ajan host'un not ettiği,
`kept` ile gelen bir dönüşü ondan sonra yeniden yazar; başka biri, bir penceredeki kişinin dönüşü gibi, önceki haline döner.

### Erişilebilirlik denetimi

`audit` (host API'si `device.audit()`) ekranın erişilebilirlik sorunlarını yanıtlar; her birinde `type`, motorun
`rule`'u, bir `message`, öğenin dokunma birimlerindeki kutusu `b` ve öğenin kendisi (`c`, `id`, `d`, `t`) vardır:

- iOS: platformun öndeki uygulama için kendi denetimi (`performAccessibilityAudit`, Xcode 15+), türler
  `contrast`, `elementDetection`, `hitRegion`, `sufficientElementDescription`, `dynamicType`,
  `textClipped`, `trait` (`types` bazılarını seçer). Runner her sorunu kendisi alır, böylece hiçbiri bir
  test hatasına dönüşmez. Platformun çalıştıramadığı bir denetim `UNSUPPORTED` yanıtını verir.
- Android: host'un tek bir `a11y.read` (ağaç; her metin düğümü için kaç karakterin
  görünür bir yeri olmadığı: çerçeveyle kesilmiş ya da üç noktayla değiştirilmiş, düğüm başına uygulamaya bir çağrı, en çok 1,5 s;
  düğümlerin gezinme ipuçları, dolaşmadan sonra çözülür, en çok 300 ms) ve bir PNG ekran görüntüsü üzerindeki denetimleri: `hitRegion` (48×48 dp'nin altında bir kontrol), `contrast` (ekran görüntüsünün piksellerinden,
  4,5:1'in, 28 dp yüksekliğindeki metin için 3:1'in altındaki metin), `imageContrast` (dokunulan ya da
  adlandırılan, 12–96 dp, 3:1'in altında bir simge), `sufficientElementDescription` (bir ekran okuyucunun
  adlandıramadığı bir kontrol, alan ya da simge), `duplicateLabel` (aynı şekilde okunan kontroller), `textClipped`. Ekranın ya da kayan bir
  kapsayıcının kenarıyla kesilen öğeler ölçülmez; erişilebilirlik için önemli olmayan düğümler
  atlanır. Renkler bir metnin yüksekliğinin orta yarısından, kenarlarından 6 dp içeriden okunur (bir
  düğmenin saydam iç boşluğu onun rengi değildir) ve bir simgenin iç %70'inden. Sonuç, ekran okuyucunun
  okuma sırasını çıkaran bir çağıran için o okumayı (`read`: ağaç ve gezinme ipuçları)
  taşır.
- Sınırlar: Compose'un üç noktayla kısaltılmış metni bulunmaz (Compose karakterlerinin yerlerini başka bir
  ölçekte ve hepsini metnin içinde bildirir);
  bir görüntü ya da gradyan üzerindeki metnin renkleri ölçülmez (temiz bir örnek yok).

### Bir yayın (Android)

`stream.start` isteyen bir bağlantı bitene kadar video kareleri (tür 2) alır; nasıl biterse bitsin, ekran ve
codec onunla birlikte serbest bırakılır. Her bağlantı gibi aynı token ile gelir ve ajanın boşta kapanması için de bir bağlantı
sayılır. `touch`, `stream.clock`, `stream.sync` ve `stream.status`, cihaz işinin tek şeridinde değil bağlantının kendi
thread'inde yanıtlanır: bir kişinin parmağı hiçbir durulmayı beklemez.

- `stream.info {w, h, codec, mode, crop?}` ajanın kendi mesajıdır, id'si yoktur ve her kodlayıcının ilk karesinden önce gelir:
  boyutu ve `mode` içinde kodlayıcı ile merdivenin basamağı. `crop` bir telefonunkidir: görüntü ekrandan
  büyüktür, ekran onun sol üstünde durur.
- `stream.end {why}` devam etmeyeceğini söyler: merdivenin her basamağı başarısız oldu.
- `stream.counters {...}` ve `stream.turns {turns}` bir telefonunkidir: yayınının şimdiye kadar adıyla saydıkları ve
  görüntüyü dik duruma getiren çeyrek dönüşler, çünkü o yayındaki hiçbir şey bunu söylemez. Viewer'a aynı pipe üzerinden ulaşırlar.
- Bayraklar: 1 bir keyframe, 2 parametre kümeleri. Yakalama zamanı ekranın kendisinindir, `System.nanoTime`'ın saatinde;
  `stream.clock` bunu, host'un farkı en kısa gidiş-dönüşüyle bulması için `now` içinde yanıtlar.

Viewer bunların hepsini ajanla, aralarında host olmadan, kendisi konuşur; bu yüzden bu adlar ve alanlar
`METHODS` ve `NOTIFICATIONS` içinde, `packages/protocol/src/messages.ts`'te kendi fixture'larıyla durur ve
`packages/protocol/test/native.test.ts` bunlar için viewer'ı ve iki ajanı da okur.

**Merdiven**, bir kodlayıcı başarısız olduğunda: aynı basamak 500 ms arayla üç kez daha; şu boyutlardan her biri aşağı doğru:
`{2560, 1920, 1600, 1280, 1024, 800}`; her boyutta diğer codec; her boyutta ilk codec'in yazılımsal bir kodlayıcısı.
10 s çalışıp sonra başarısız olan bir kodlayıcı basamağını korur. `failFirst: n` bir test için sonraki n tanesini başarısız yapar.

**Geri basınç**: en çok üç kare bekler. Soket doluyken bir kare atılır ve bir sonraki keyframe'e kadar her kare de;
o keyframe istenir: görüntü bir an donar ve asla yanlış olmaz.

Bir emülatörün konuk kodlayıcısı bunun gibi çalışır ve saniyelerce geride kalır: bkz. [mirror.md](mirror.tr.md).

### Bir telefonun ekranı kapanır

Karanlık bir ekrandaki dokunuş hiçbir pencereye ulaşmaz ve hiçbir şey bunu söylemez: ajan onu önce `SCREEN_OFF` ile reddeder, host da telefonu
uyandırıp yeniden dener. Uyandıktan sonra uygulama, dokunuş alabilmeden önce ekranda olur. Bir Xiaomi'de (HyperOS, Android 16), onu uyandıran okumadan 0 ile 4 s
sonraki dokunuşlarda 14'ün 6'sı kayboldu; kayıplar 1,5 s sonrasına kadardı, 4 s'de hiç yoktu; odak zaman zaman hiçbir şeyde ya da launcher'ındaydı; 10 turda daha
düğme hiç görünmedi. Host odağın 600 ms boyunca sabit kalmasını beklediğinde 15'in 15'i uygulamaya ulaştı ve her turda düğmesi vardı. Bunlar
küçük sayılar. Uzun bir ölçüm de onu uyandırır: karanlık bir telefon hiçbir uygulama başlatmaz ve `am start` `UNKNOWN (0)` okur.

Yalnızca kararmış bir ekran uyanıktır ve orada hiçbir ret bir dokunuşu durdurmaz. Yine de o Xiaomi'de, son dokunuştan 42 s sonra, `dumpsys display` `policy=DIM` okurken, ekranı aydınlatan dokunuş hiçbir pencereye ulaşmadı: ajan bir dokunuş bildirdiği halde 3'ün 3'ü kayboldu, 25 s'lik sessizlikte ise hiçbiri kaybolmadı. Sistemin odağı uygulamadaydı ve telefon uyanıktı, bu yüzden yol üzerindeki hiçbir şey bunu söylemedi. Ajan artık herhangi bir parmak inmeden hemen önce sisteme bir kişinin burada olduğunu söyler ve aynı 3 dokunuş da uygulamaya ulaştı. Yalnızca sessiz bir aradan sonra başarısız olan bir test genellikle budur: biri dosyasının sırasında 4'te 4 başarısız oldu ve tek başına geçti.

### Bir telefonun kurulum soruları

`app install`, `adb install` çalışırken telefonun odaklı penceresini düz bir `dumpsys` ile izler ve iki pencereden biri odağı alana kadar
başka hiçbir şey yapmaz, böylece soru gelmeyen yerde hiçbir ajan başlatmaz ve bekleme eklemez. Yalnızca o çağrı sırasında, o cihazda ve yalnızca dosyadaki uygulama için: adları
`.apk`'den okunur, başka birini adlandıran bir soruya dokunulmaz. `--allow-apps` ile `app install` yalnızca listenin adlandırdığı bir uygulamayı, dosyanın taşıdığı kimlikle (bir `.apk`'nın paketi, bir `.app`'in `CFBundleIdentifier`'ı), cihaza bir şey ulaşmadan önce okuyarak kurar; başkasını adını söyleyerek `POLICY_DENIED` olarak reddeder. İki seçenek de bir
araç argümanı değildir: onları yalnızca sunucuyu çalıştıran kişi ayarlar. Bir Xiaomi 25078RA3EY'de görüldü (HyperOS 3, Android 16, tr-TR, Play Store 53.8):

| pencere                                                                     | ne olduğu                             | ne okunur                                                                            | yanıt                                               |
| --------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `com.miui.securitycenter/...permcenter.install.AdbInstallActivity`          | "install over USB?", 10 s sonra hayır | id'ler: `android:id/button2` kabul eder, `android:id/button1` reddeder ve geri sayar | `button2`; asla `do_not_ask_checkbox`               |
| `com.android.vending/...protectdialogs.activity.PlayProtectDialogsActivity` | "send app for a security check?"      | id yok: "Send this time" ve "Always send unknown apps" yanında "Don't send"          | "Don't send", herhangi bir bayrakla ya da bayraksız |
| aynı pencere                                                                | "unsafe app blocked"                  | id yok: "More details", sonra son satırı "Install anyway" olan bir metin             | dokunulmaz; `--accept-install-warnings` onu geçer   |

Xiaomi'nin sorusu her dilde tanınır. Play Protect'in iletişim kutularının id'si yoktur, bu yüzden düğmeleri yalnızca sözcükleriyle ayırt edilebilir ve yanlış bir tahmin
özel bir build'i Google'a gönderebilir. Buradaki sözcükler Play Store'un kendi kaynaklarından, İngilizce ve Türkçe olarak alındı; yalnızca Türkçeleri bir ekranda görüldü. Başka
bir dildeki bir iletişim kutusu ya da o pencerenin başka herhangi bir iletişim kutusu alıntılanır ve bir kişiye bırakılır. Yani örneğin Almanca bir telefonda bir kurulum, o soru
geldiğinde orada durur ve bunu söyler.

Uyarı, `targetSdk` 24 için derlenmiş bir uygulamada görüldü (fixture'da `-PoldTarget`); zararsız bir uygulamayla bu telefonda gösterilebilen tek uyarı buydu ve
host onu kurulmuş bir uygulamaya kadar geçirdi (`device-tests/install-consent.test.ts`). "harmful app blocked" ya da "app scan recommended" gibi diğerleri o kaynaklarda vardır, görülmedi ve
onlardaki "Install without scanning" seçilmez. Başka herhangi bir üreticinin USB kurulum sorusuna dokunulmaz: kurulum o zaman kendi kendine nasıl bitiyorsa öyle biter.

Bir Samsung SM-A525F'in (One UI 6.1, Android 14, en-US) kendine ait bir USB kurulum sorusu yoktur: `persist.security.adbinstall`'u boştur ve kurulumlar ekranda hiçbir şey olmadan 1,1 s sürdü. Play Protect onlara yalnızca "Verify apps over USB" açıkken baktı (`verifier_verify_adb_installs`, bu telefonda bulunduğu haliyle 0). O açıkken iletişim kutuları, aynı pencerede, İngilizce olarak Xiaomi'ninkilerdi: uyarı, "More details" ve "Install anyway" seçenekle geçildi, seçenek olmadan dokunulmadı; "Send app for a security check?" da `device-tests/install-consent.test.ts` ile, 3'te 3, host'un kendisi tarafından "Don't send" ile yanıtlandı.

Başında kimse olmadan, her turda fixture kaldırılıp kurularak, 14 turun 14'ünü aldı; açık bir rapor, soğuk bir ajan ya da soru açılırken uyutulan bir ekranla 6'da 6 daha
ve derlenmiş komut satırı ve sunucu üzerinden 3'te 3. Bunlar tek bir telefonda küçük sayılar.

O telefonda gerekenler:

- Soru 0,3 ile 0,7 s arasında yukarı kayar, düğmesi son yerinde zaten okunmuştur. Bir dokunuş o zaman pencereye ulaştı ve hiçbir şey yapmadı, soru da 10 s
  sonra hayır dedi. İletişim kutusunun üstüne, kayma sırasında bir okumanın yerinin düşebileceği yere yapılan bir dokunuş kurulumu hemen iptal eder. Odak sabitlendikten sonra pencereler, 200 ms
  arayla, iki kez aynı okunmalıdır.
- Reddetme düğmesi geri sayar, ama kabul en baştan bir dokunuş alır. `persist.security.adbinput`'un 1 okunduğu bu telefonda enjekte edilen dokunuşlar engellenmez. Engellendikleri
  yerde yanıt bunu söyler ve bu aracın asla değiştirmediği "USB debugging (Security settings)" ayarının adını verir. O durum görülmedi.
- `KEYCODE_WAKEUP` bir ekranın zaman aşımını yeniden başlatmaz: telefon, soru açılırken ondan 5 s sonra uyudu ve sonra karanlıkta hayır dedi. İzleyici, kurulum beklerken
  telefon her karardığında onu yeniden uyandırır.
- "Install anyway", denendiği tek seferde anlık bir dokunuşu almadı, o zamandan beri her seferinde 150 ms basılı tutulan bir dokunuşu aldı, bu yüzden bu dokunuşların hepsi basılı tutulur. Kendine ait
  bir düğümü yoktur: dokunuş metninin son satırına gider.
- Play Protect her zaman göndermeyi sormaz. Fixture'ın ve eski hedefli build'inin her birinin ilk iki kurulumunda sordu, her seferinde hayır dendi ve o zamandan beri yaklaşık 50
  kurulumda, yeni paket adları için de sormadı (logunda `upload_requested=false`). Yani o telefonda host'un o soruya kendi yanıtı yalnızca
  kaydedilmiş ağaçlar üzerinde çalıştı. Telefonda ajanın dokunuşu da elle basılı tutulan bir dokunuş da işe yaradı. 3 dakikada zaman aşımına uğramadı.
- Bir kişinin yanıt vermesi gerektiğinde host `adb install`'u bitirir ve hemen yanıt verir. Soru telefonda kalır ve bir kişinin yanıtı uygulamayı yine kurar (bir kez görüldü).
- Önceki bir çağrıdan hâlâ açık olan bir soru, sonraki kurulumu başlamadan reddeder. Ona yapılan bir dokunuş önceki kurulumu yanıtlar, doğrulayıcı da onu geçirir,
  ve yeni kurulumun kendi sorusunu geri tutar: bir çalıştırmada o yeni kurulum, doğrulayıcı onu reddedene kadar 77 s bekledi.

## Hatalar

```json
{ "code": -32008, "message": "…", "data": { "code": "NOT_FOUND", "hint": "…" } }
```

`data.code` şunlardan biridir: `TIMEOUT`, `CANCELLED`, `DEVICE_GONE`, `AGENT_UNAVAILABLE`, `AGENT_CONFLICT`,
`AGENT_VERSION_MISMATCH`, `UNSUPPORTED`, `PERMISSION_REQUIRED`, `NOT_FOUND`, `NO_FOCUS`,
`APP_NOT_RUNNING`, `POLICY_DENIED`, `INVALID_ARGUMENT`, `STALE`, `SCREEN_OFF`, `INTERNAL`; JSON-RPC kodu −32000
eksi o listedeki dizinidir. Bilinmeyen bir metot iki platformda da `UNSUPPORTED` yanıtını verir. `AMBIGUOUS`, `CHECK_FAILED`, `BUILD_FAILED`, `DEVICE_CLAIMED`, `DEVICE_LOCKED` ve `OFFLINE` bunlardan sonra gelir ve host'un kendisinindir, asla bağlantı üzerinden gitmez. `TIMEOUT`, `DEVICE_GONE` ve `AGENT_UNAVAILABLE` bir kez yeniden denemeye değer; host
salt okunur istekleri yeni bir bağlantıda kendisi bir kez yeniden dener, bir işlemi ise asla (gerçekleşmiş olabilir).

## Android ajanının yaşam döngüsü

Host ajan APK'sını cihaza gönderir (`/data/local/tmp/appdyno/agent-<sha256 prefix>.apk`, yalnızca o
build orada değilse) ve onu shell kullanıcısı olarak başlatır:

```sh
CLASSPATH=<apk> app_process / dev.appdyno.agent.Main \
  --socket appdyno_<random> --token-file /data/local/tmp/appdyno/appdyno_<random>.token
```

Soket adı ve token yalnızca kullanıcının okuyabildiği bir durum dosyasında tutulur
(`~/Library/Caches/appdyno/android-<serial>.json` ya da `APPDYNO_STATE_DIR`), böylece sonraki host
süreci tek bir gidiş-dönüşte yeniden bağlanır. Cihazdaki farklı bir build durdurulur (süreç kimliğiyle,
yalnızca komut satırı ajanınkiyse) ve değiştirilir; ancak bu Mac'in başka bir canlı süreci onu kullanıyorsa değiştirilmez. Bir cihazın
host'ları tek bir ajanı paylaşır, çünkü bir cihazın verebileceği tek bir UI automation bağlantısı vardır ve birbirinin ajanını değiştiren
iki build, ikisi çalıştığı sürece cihazı birbirinden alırdı; bir güncellemenin bıraktığı da budur: zaten yeni sürüme geçmiş bir istemcinin
yanında açık bir hub. Bu yüzden ajan kalır, daha yeni host da onu kullanır ve bu kendisine söylenir; bu, ajanın son host'u
gidene kadar sürer; durum klasöründeki `agent-hosts/<serial>.json` onları listeler ve bir sürecin bitişi onu listeden çıkarır. Başlayan bir ajan, bağlı hiçbir host olmadan dinleyen ve 60 s çalışmış, yani bir host'un yeni bir ajana yanıt için verdiği süreyi doldurmuş diğer her ajanımızı sonlandırır, çünkü başka bir durum klasöründen gelen bir host geride bir tane bırakır; shell soket tablosunu okuyamadığında hiçbirini sonlandırmaz. O ajanın
protokolünü konuşamayan bir host, onu kullananın pid'iyle reddedilir. Bir iOS runner'ı da aynı
kurala uyar ve onu bir seferde tek bir host, durum klasöründeki `ios-<udid>.starting` ile başlatır: bir cihaz tek bir runner'a hizmet eder ve
runner'ın durumu ancak yanıt verdiğinde yazılır; bu yüzden iki host'un aynı anda başlattığı iki runner telefonu birbirinden aldı ve kaybeden
3 dakika boyunca hiçbir şey duymadı. Bir iPhone 13 Pro Max'te bir istemcinin ilk çağrısı o zaman 16 denemede 1 ile 6,3 s arasında sürdü, önce hub ya da önce
istemci. Ajan bağlantısız geçen 30 dakikadan sonra
kapanır. stderr'de `AGENT_CONFLICT` ile çıkış kodu 3: başka bir UI automation istemcisi cihazı tutuyor
(bir cihazda tam olarak bir tane vardır). Ajan bunu 4 s denedikten sonra söyler, çünkü sistem UI automation'ı öldürülmüş bir sahip için
tutar: bir emülatörde süreci gittikten 1,3 s sonra hâlâ tutuluyordu, 2,3 s'de boştu; düz bir `kill`'den sonra ise hemen boştu.

Bu durum klasörünün hiçbir şey bilmediği bize ait bir ajan bir kez değiştirilir, çünkü temizlenmiş bir önbellek geride bir tane bırakır; ancak
`/proc/net/unix` ona bağlı bir host gösteriyorsa değiştirilmez: bu, kendine ait bir durum klasörü olan bir host'tur ve başlatma
`AGENT_CONFLICT` ile reddedilir. Bir telefon o tabloyu bir shell'den gizliyorsa ajan değiştirilir. Bir Samsung SM-A525F
(Android 14) ve bir Xiaomi 25078RA3EY (Android 16) ikisi de bu tabloyu verir: ajanın dinleme satırı `St 01` ve yolunda her bağlantı için bir `St 03`;
Samsung da diğer host'un çağrıları hâlâ yanıtlanırken böyle bir başlatmayı reddetti.
