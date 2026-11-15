# Kütüphane

[English](library.md)

`appdyno` tek bir fonksiyon dışa aktarır: `connect`; ikinci bir giriş noktası olan `appdyno/device` ise cihazın kendisini verir ve bu sayfanın sonunda anlatılır. `connect` fonksiyonunun verdiği nesne her aracı adıyla çağırır, argümanları ve yanıtı aracın kendi şemasından tiplenir; akışları da yeniden oynatır. Reddedilen bir çağrı `code`, `hint` ve `dispatched` ile birlikte hata fırlatır. Tipler kendi başına yeter: bir projenin zod dahil başka hiçbir şey kurması gerekmez.

`connect` şunları alır: `device` (seri numarası; verilmezse bağlı tek cihaz), `app` (bir çağrı uygulama belirtmediğinde araçların kullandığı uygulama) ve `allowDevices` (kullanabileceği cihazları belirleyen bir düzenli ifade). `replay`; `from` (başlanacak adım), `params`, `onStep` ve bir hatanın ekran görüntüsüyle ağacının yazılacağı klasör olan `evidence` alır. `dispatched`, reddedilen çağrının dokunuşunun cihaza gidip gitmediğini söyler. Veri kaybettiren ya da sistemin güç denetimlerine dokunacak bir araç `PERMISSION_REQUIRED` ile reddedilir: bir programın soracağı bir kişi yoktur ve `connect` buna önceden izin veren bir seçenek almaz.

```ts
import { connect, type Refusal } from 'appdyno';

/** Bir uygulamada ekranındaki sözcüklerle dokunarak ilerler, bir akışı yeniden oynatır ve her adımın ne kadar sürdüğünü söyler. */
export async function drive(flow: string, log: (line: string) => void) {
  const device = connect({ app: 'dev.appdyno.fixture' });
  try {
    await device.tool('launch_app', {});
    const form = await device.tool('tap', { selector: { text: 'Form' } });
    log(form.text);
    const run = await device.replay(flow, {
      onStep: (e) => {
        if (e.phase === 'after') log(`${e.result.step}: ${e.result.ms} ms`);
      },
    });
    await device.tool('tap', { selector: { text: 'Not on this screen' } }).catch((e: unknown) => {
      const { code, hint } = e as Refusal;
      log(`${code}: ${hint ?? ''}`);
    });
    return run.passed;
  } finally {
    await device.close();
  }
}
```

`close`, araçların cihazda değiştirdiklerini bir oturumun sonunun yaptığı gibi eski haline getirir.

Bir modelin okuduğu katlanmış liste yerine ağacın kendisine ihtiyaç duyan bir program `screen`'i `raw: true` ile çağırır: cevabının `data.nodes` alanı ağacın her öğesini `type`, sözleri, `rect`, `flags` ve `parent` sırasıyla tutar. Ekranın gösterdiği her öğenin bir `ref`'i vardır ve `tap` onu alır; listenin adlandırmadığı bir öğeye ortasından dokunur. Bir öğenin ref'i yoksa ya uygulamanın değildir (klavye ve sistemin çubukları gibi), ya görünmez olarak işaretlenmiştir, ya boyutu yoktur, ya yarısından azı ekrandadır, ya iOS'te durum çubuğunun ya da üstteki bir gezinme çubuğunun altındadır, ya da bir listenin henüz yerleştirmediği, tek bir noktaya yığılmış satırlarındandır.

## Cihazın kendisi

`appdyno/device` ikinci bir giriş noktasıdır; bir aracın yanıtını değil cihazın kendisini isteyen program içindir: ekranı öğeler olarak okur, bir seçiciyle ya da bir ref ile nişan alır ve bir noktaya dokunur. `openDevice`, `select`, `aim` ve `nameOf` fonksiyonlarını, bunların aldığı ve verdiği şeylerin tipleriyle birlikte dışa aktarır; tipler ana girişinkiler gibi kendi başına yeter.

`openDevice` bir seri numarası alır ve cihazı, `connect` gibi, onu üstlenen sürücüyle açar. `allowDevices` aynı listedir: listenin dışındaki bir seri numarası `POLICY_DENIED` ile reddedilir. Cihaz `close` çağrılana kadar bu süreç için tutulur; bu yüzden başka bir sürecin tuttuğu cihaz `DEVICE_CLAIMED` ile reddedilir. `share` verilirse cihaz yine de sürülür ve kimseden alıkonmaz. `app`, ekranın hangi uygulama için okunduğunu belirtir.

Cihazın `serial`, `platform` ve `virtual` alanları ile `screen`, `tap`, `longPress`, `swipe`, `key`, `typeText`, `launch`, `terminate`, `foreground` ve `close` çağrıları vardır. Bir dokunuş ekranın durulmasını bekler ve `settled` yanıtını verir; `typeText` buna `verified` ile `submitted` ekler. Bir nokta ekranın okunduğu birimdedir: iOS'te nokta, Android'de piksel.

`screen` her seferinde, önde hangi pencere varsa onun yeni bir okumasıdır: `elements`, okumanın `hash` değeri, `foreground` içindeki öndeki uygulama ve `window` boyutu. Bir öğenin `ref`, `role`, `label` (etiket kısaltılmışsa bir de `whole`), `id`, `rect`, ortası olarak `x` ile `y` ve `flags` alanları vardır. Bir seçici, bir aracın seçicisi gibi, öğeyi `text`, `id`, `role` ve `index` ile adlandırır; `select` de seçicinin adlandırdığı bütün öğeleri verir.

Araçların uyguladığı üç kural burada birer fonksiyondur; böylece bir program onları yeniden yazmaz:

- **Denetimin kendi dokunma noktası.** `aim`, bir seçicinin ya da bir `ref` değerinin bir okumada adlandırdığı tek öğeyi ve ona yapılacak dokunuşun gideceği `point` değerini verir. Bu nokta öğenin ortasıdır; ancak bir anahtar satırına kendi anahtarından dokunulur (`why` değeri `own` olur), ortasında başka sözler taşıyan daha küçük bir denetim bulunan bir denetime ise (küçük bir oynatıcının Duraklat düğmesi gibi) o küçük denetimin dışında kalan bir noktadan dokunulur (`clear`; o denetim `other` olarak verilir). `covered`, öğenin hiçbir noktasının açıkta kalmadığını söyler. Eşleşme yoksa `NOT_FOUND`, birbirinden ayrı duran birden çok eşleşme varsa `AMBIGUOUS`, ref okumada yoksa `STALE` fırlatılır.
- **Öndeki ekranda bir seçici.** `aim` ayrıca `on` değerini, yani nişan aldığı okumanın `hash` değerini verir; bir dokunuş bunu `before` olarak alır. Bir iletişim kutusu kendiliğinden açıldıktan sonra ekranı yeniden okuyun ve o okumada nişan alın: dokunuş iletişim kutusuna gider. Android'de `before` değeri, başka bir pencere öne gelmeden önceki bir okuma olan dokunuş hiçbir şey gönderilmeden `STALE` ile reddedilir; iOS böyle bir karşılaştırma yapmaz.
- **Sözleri değişmiş bir öğe.** `nameOf` bir öğeyi ref'i ve sözleriyle adlandırır (`@a1 "Close"`); öğenin daha önceki bir okumada gösterildiği sözler de verilirse ve bunlar farklıysa ikisini birden söyler: `@a1 "Close" (shown as "Play")`.

```ts
import { aim, nameOf, openDevice } from 'appdyno/device';

/** Ekranı okur, sözleriyle adlandırılan denetime kendi noktasından dokunur ve sonraki ekranın sözlerini verir. */
export async function tapByWords(serial: string, text: string, log: (line: string) => void) {
  const device = await openDevice(serial);
  try {
    const target = aim(await device.screen(), { text });
    const { settled } = await device.tap(target.point, { before: target.on });
    log(`tapped ${nameOf(target.element)} at ${target.point.x},${target.point.y}`);
    if (!settled) log('the screen still moves');
    return (await device.screen()).elements.map((e) => e.label);
  } finally {
    await device.close();
  }
}
```

Araçların bunların üstüne eklediği şeyler `connect` tarafında kalır: sistemin güç denetimlerine yapılacak bir dokunuştan ya da veri kaybettiren bir çağrıdan önce sorulan soru, geri gösterilen içerikte gizlenen sırlar, sözü olmayan bir ekranın resminden okunan sözler, henüz gelmekte olan bir öğe için bekleme ve bir oturumun sonunda yapılan geri alma. Burada açılan bir cihaz kendisine verilen her dokunuşu yapar ve `close` hiçbir şeyi geri almaz.

### Bir sürüm neyi değiştirebilir

`appdyno/device`, onu ilk içeren sürümden başlayarak anlamsal sürümlemeye uyar. Yüzeyi; dışa aktardığı fonksiyonlar, cihazın üyeleri ve dışa aktardığı tiplerin alanlarıdır.

Bir minor ya da yama sürümü bir fonksiyon, bir üye, isteğe bağlı bir seçenek ya da isteğe bağlı bir alan ekleyebilir; `role`, `flags`, `why` ve bir reddin `code` alanına yeni bir değer ekleyebilir; yanlış yere giden bir dokunuşu düzelttiği durumda `aim` fonksiyonunun verdiği noktayı ya da bir seçicinin adlandırdığı öğeyi değiştirebilir ve bunu değişiklik günlüğünde söyler. Bir fonksiyonu, bir üyeyi ya da bir alanı kaldıramaz ya da yeniden adlandıramaz, birinin tipini değiştiremez, isteğe bağlı olanı zorunlu yapamaz, bir `ref` değerinin, bir `hash` değerinin ve bir noktanın biriminin ne anlama geldiğini değiştiremez: bunlar bir major sürümü bekler.

Girişin dışa aktarmadığı her şey herhangi bir sürümde değişebilir: sürücüler, bir cihazın gönderdiği ağaç, araç katmanı ve `dist` altındaki diğer dosyalar.
