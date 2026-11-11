# Kütüphane

[English](library.md)

`appdyno` tek bir fonksiyon dışa aktarır: `connect`. Onun verdiği nesne her aracı adıyla çağırır, argümanları ve yanıtı aracın kendi şemasından tiplenir; akışları da yeniden oynatır. Reddedilen bir çağrı `code`, `hint` ve `dispatched` ile birlikte hata fırlatır. Tipler kendi başına yeter: bir projenin zod dahil başka hiçbir şey kurması gerekmez.

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
