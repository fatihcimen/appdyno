# Performansı ölçmek

[English](performance.md)

appdyno performans sayılarını cihazın kendisinden okur, saklar ve bir uygulama yavaşladığında size söyler. Bu rehber ilk sayıdan pull request'leriniz için bir kapıya kadar gider.

**Gerçek ölçüm gerçek bir cihaz ister.** Bir emulator'ın ya da simulator'ın sayıları Mac'inize göredir. Gerçek kare hızları, donmuş kareler, takılmalar ve enerji bir telefon ister. Bir simulator yine de tek bir makinede iki build arasındaki bir değişikliği yakalamak için iyidir.

## İlk sayı

Ajanınıza sorun ya da komut satırını kullanın. `A` uygulamanızın kimliğidir: `com.example.app`.

```sh
appdyno measure-performance launch --app A --mode cold --repeats 6  # açılış süresi, tekrarlarla
appdyno measure-performance snapshot --app A                        # CPU, bellek, kareler, cihazın yükü
appdyno perf survey --app A                                         # bu cihazdaki her ölçüm, sonra bir sayfa
```

Her çalıştırma geldiği ham çıktıyla birlikte saklanır. Mac'inizden hiçbir şey çıkmaz.

`perf survey`, bir uygulamanın bütün cihazlarınızdaki sayılarını tek sayfada gösteren [dashboard'u](../reference/perf.tr.md#dashboard) yazarak biter. `appdyno perf dashboard --open` onu yeniden açar.

## Baseline ve kapı

Bir kapı, bir çalıştırmayı daha önce sakladığınızla karşılaştırır. Uygulamanızın kendi kendine ne kadar oynadığını bilmek için üç çalıştırmaya ihtiyaç duyar.

```sh
appdyno measure-performance launch --app A --mode cold --repeats 6  # üç kez, sonra:
appdyno perf baseline --app A --scenario launch-cold --last 3
appdyno measure-performance launch --app A --mode cold --repeats 6  # değişikliğinizden sonra
appdyno perf compare --app A --scenario launch-cold                 # gerilemede 1 ile çıkar
```

Ajanınız üzerinden `baseline` ile `measure_performance launch` üç çalıştırmayı ölçer ve onları tek çağrıda baseline olarak saklar. Diğer her launch ölçümünün yanıtındaki `next` satırı, çalıştırmanın ne olarak saklandığını ve onu hangi çağrının baseline yapacağını söyler: tek bir çalıştırma baseline değildir.

Baseline `.appdyno/perf/baselines/` altına gider. Onu commit edin. Kendi sınırlarınız `.appdyno/perf/budgets.json` içine girer:

```json
[{ "kind": "launch.ttid_ms", "max": 2000 }]
```

Ajanınız üzerinden "cold launch'ı 200 ms'nin altında tut", `kind` ve `max` ile `compare_performance` `budget`'tır; ölçülmüş bir çalıştırma olsun ya da olmasın o dosyayı yazar: Android'de `launch.ttid_ms`, bir iPhone'da ya da simulator'da `launch.until_ms`.

## Kapı nasıl karar verir

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../images/perf-gate.tr.dark.svg">
  <img src="../images/perf-gate.tr.svg" alt="Kapı nasıl karar verir: sırayla yedi soru, her biri bir kararla biter: new, refused, ok, few-samples, improvement, noisy ya da regression">
</picture>

Karar veremeyen bir kapı geçit vermez. `few-samples`, `noisy` ve `refused`, üçü de 1 ile çıkar; ne baseline'ı ne bütçesi olan bir senaryo da öyle. Her biri ne yapılacağını söyler. Yöntem ve neden üç testin de gerektiği [Kapı](../reference/perf.tr.md#kapı) bölümünde.

## Neden kötüleşti

`appdyno perf why --app A`, `compare`'in yaptığını yapar, bir gerilemede nedenini de arar. Bkz. [Neden kötüleşti](../reference/perf.tr.md#neden-kötüleşti).

## Bir yolculuk

Uygulamanızın içinden geçen bütün bir yolu ölçmek için bir [flow](flows.tr.md) kaydedin ve [onu `--measure` ile çalıştırın](flows.tr.md#ölçülen-ve-kapıyla-denetlenen-bir-yolculuk). Her adım kendi süresini alır, böylece kapı yavaşlayan adımı adıyla söyleyebilir.

```sh
appdyno test flows/login.flow --measure --device <id>       # üç kez, sonra:
appdyno perf baseline --app A --scenario journey-flows-login --last 3
appdyno test flows/login.flow --measure --device <id>
appdyno perf compare --app A --scenario journey-flows-login       # 1 ile çıkar, adımı adıyla söyler
```

## Bir pull request'te

[`perf-gate.yml`](../examples/perf-gate.yml), `.github/workflows/perf-gate.yml` konumuna kopyalanacak bir job'dır. `env` altındaki değerleri ayarlayın: uygulama, flow, simulator ve uygulamanın nasıl derlendiği.

Job olduğu gibi GitHub'ın `macos-latest` runner'ında, Xcode 26.6 ve iOS 26.5'li bir iPhone 17 simulator'ıyla çalıştı: hiç kod değiştirmeyen bir pull request gerileme olmadan geçti, bir adımı yavaşlatan bir pull request ise job'ı o adımda, adıyla bir gerileme olarak başarısız kıldı. Sizinkinde başarısız olursa lütfen bildirin.

Job, simulator'lı bir macOS runner'ında çalışır, bu yüzden sayıları o runner'a göredir. Yaptığı iş, tek bir makinede iki build arasındaki bir değişikliği yakalamak ve nedenini söylemektir.

Pull request'in base'ini ve head'ini tek bir job'da ölçer, çünkü başka bir makineden gelen bir baseline karşılaştırılamaz:

1. base'i derler, baseline'da üç çalıştırma olana kadar flow'u ölçer ve [referansı](../reference/perf.tr.md#neden-kötüleşti) alır;
2. head'i derler ve flow'u ölçer;
3. `appdyno perf why`; bir gerilemede, aşılan bir bütçede ya da karar veremediği bir değişiklikte (`few-samples`, `noisy`, `refused` ya da hiç baseline yoksa) job'ı en sonda başarısız kılar;
4. kapı ne demiş olursa olsun `appdyno perf comment --out perf-comment.md`;
5. o dosyayı yükler ve `gh pr comment` ile, deponun kendi token'ıyla gönderir.

appdyno'nun servisi de token'ı da yoktur ve hiçbir şey göndermez. Bir dosya yazar, onu sizin job'ınız gönderir. Bir fork'tan gelen pull request yorum yapamayan bir token alır, bu yüzden orada yorum yalnızca job'ın artifact'lerindedir. Her çalıştırma yeni bir yorum yazar, çünkü `gh pr comment --edit-last` token'ın son yorumunu düzenler, bu yorum da başka bir workflow'a ait olabilir.

### Bir runner'dan ne beklenir

- Size ait bir Mac'te yük altında görülen bir değişiklik `noisy` sayılır, job'ı başarısız kılar ve yanıt yeniden ölçmenizi söyler. Yük altındaki bir çalıştırma baseline olarak reddedilir.
- Bir GitHub runner'ı sanal bir Mac'tir ve yük ortalaması onun ne kadar meşgul olduğunu söylemez (3 çekirdekli bir runner boştayken 115 ile 650 arası okudu), bu yüzden appdyno onu orada okumaz: sayıları `host-load-unread` der ve gürültüye kapının kendi testleri karar verir. Job, `perf baseline` çıkış koduyla üç çalıştırmanın tamamlandığını söyleyene kadar ölçer.
- Yeni bir simulator başta kendi kendine meşguldür: iOS 27.2 ile bir M5 Pro'da yaklaşık 3 dakika ve 7 çekirdek. Bu yüzden size ait bir Mac'te job, base'in build'inden önce ve head'in build'inden sonra yükün düşmesini bekler; sanal bir Mac'te beklemez.
- `macos-latest` bir arm64 runner'ıdır ve [bunlarda iç içe sanallaştırma yoktur](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Bir Android emulator'ı bir Intel etiketi ya da size ait bir Mac ister.
- Yeni bir simulator bir bağlantının uygulamayı açıp açamayacağını bir kez sorar ve bu, bir flow'u ilk `open_link`'inde durdurur. Ölçülen ilk çalıştırmadan önce bir kez yanıtlayın ya da ekrana düğmeleriyle ulaşın.
