# Kütüphane

[English](library.md)

`appdyno` tek bir fonksiyon dışa aktarır: `connect`. Onun verdiği nesne her aracı adıyla çağırır, argümanları ve yanıtı aracın kendi şemasından tiplenir; akışları da yeniden oynatır. Reddedilen bir çağrı `code`, `hint` ve `dispatched` ile birlikte hata fırlatır. Tipler kendi başına yeter: bir projenin zod dahil başka hiçbir şey kurması gerekmez.

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
    await device.tool('tap', { selector: { text: 'Not on this screen' } }).catch((e: Refusal) => {
      log(`${e.code}: ${e.hint}`);
    });
    return run.passed;
  } finally {
    await device.close();
  }
}
```

`close`, araçların cihazda değiştirdiklerini bir oturumun sonunun yaptığı gibi eski haline getirir.
