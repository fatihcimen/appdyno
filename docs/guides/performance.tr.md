# Performansı ölçmek

[English](performance.md)

appdyno performans sayılarını cihazın kendisinden okur, saklar ve bir uygulama yavaşladığında size söyler. Bu rehber ilk sayıdan pull request'leriniz için bir kapıya kadar gider.

**Gerçek ölçüm gerçek bir cihaz ister.** Bir emülatörün ya da simülatörün sayıları Mac'inize göredir. Gerçek kare hızları, donmuş kareler, takılmalar ve enerji bir telefon ister. Bir simülatör yine de tek bir makinede iki build arasındaki bir değişikliği yakalamak için iyidir.

## İlk sayı

Ajanınıza sorun ya da komut satırını kullanın. `A` uygulamanızın kimliğidir: `com.example.app`.

```sh
appdyno perf-launch --app A --mode cold --repeats 6     # açılış süresi, tekrarlarla
appdyno perf-snapshot --app A                           # CPU, bellek, kareler, cihazın yükü
appdyno perf survey --app A                             # bu cihazdaki her ölçüm, sonra bir sayfa
```

Her çalıştırma geldiği ham çıktıyla birlikte saklanır. Mac'inizden hiçbir şey çıkmaz.

`perf survey`, bir uygulamanın bütün cihazlarınızdaki sayılarını tek sayfada gösteren [dashboard'u](../reference/perf.tr.md#dashboard) yazarak biter. `appdyno perf dashboard --open` onu yeniden açar.

## Baseline ve kapı

Bir kapı, bir çalıştırmayı daha önce sakladığınızla karşılaştırır. Uygulamanızın kendi kendine ne kadar oynadığını bilmek için üç çalıştırmaya ihtiyaç duyar.

```sh
appdyno perf-launch --app A --mode cold --repeats 6     # üç kez, sonra:
appdyno perf baseline --app A --last 3
appdyno perf-launch --app A --mode cold --repeats 6     # değişikliğinizden sonra
appdyno perf compare --app A                            # gerilemede 1 ile çıkar
```

Ajanınız üzerinden `baseline` ile `perf_launch` üç çalıştırmayı ölçer ve onları tek çağrıda baseline olarak saklar. Diğer her çalıştırmanın yanıtındaki `next` satırı, çalıştırmanın ne olarak saklandığını ve onu hangi çağrının baseline yapacağını söyler: tek bir çalıştırma baseline değildir.

Baseline `.appdyno/perf/baselines/` altına gider. Onu commit edin. Kendi sınırlarınız `.appdyno/perf/budgets.json` içine girer:

```json
[{ "kind": "launch.ttid_ms", "max": 2000 }]
```

Ajanınız üzerinden "soğuk açılışı 200 ms'nin altında tut", `kind` ve `max` ile `perf_compare` `budget`'tır; ölçülmüş bir çalıştırma olsun ya da olmasın o dosyayı yazar: Android'de `launch.ttid_ms`, bir iPhone'da ya da simülatörde `launch.until_ms`.

## Kapı nasıl karar verir

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../images/perf-gate.tr.dark.svg">
  <img src="../images/perf-gate.tr.svg" alt="Kapı nasıl karar verir: sırayla yedi soru, her biri bir kararla biter: new, refused, ok, few-samples, improvement, noisy ya da regression">
</picture>

Karar veremeyen bir kapı geçit vermez. `few-samples`, `noisy` ve `refused`, üçü de 1 ile çıkar ve ne yapılacağını söyler. Yöntem ve neden üç testin de gerektiği [Kapı](../reference/perf.tr.md#kapı) bölümünde.

## Neden kötüleşti

`appdyno perf why --app A`, `compare`'in yaptığını yapar, bir gerilemede nedenini de arar. Bkz. [Neden kötüleşti](../reference/perf.tr.md#neden-kötüleşti).

## Bir yolculuk

Uygulamanızın içinden geçen bütün bir yolu ölçmek için bir [akış](flows.tr.md) kaydedin ve [onu `--measure` ile çalıştırın](flows.tr.md#ölçülen-ve-kapıyla-denetlenen-bir-yolculuk). Her adım kendi süresini alır, böylece kapı yavaşlayan adımı adıyla söyleyebilir.

```sh
appdyno test flows/login.flow --measure --device <id>       # üç kez, sonra:
appdyno perf baseline --app A --scenario journey-flows-login --last 3
appdyno test flows/login.flow --measure --device <id>
appdyno perf compare --app A --scenario journey-flows-login       # 1 ile çıkar, adımı adıyla söyler
```

## Bir pull request'te

[`perf-gate.yml`](../examples/perf-gate.yml), `.github/workflows/perf-gate.yml` konumuna kopyalanacak bir job'dır. `env` altındaki değerleri ayarlayın: uygulama, akış, simülatör ve uygulamanın nasıl derlendiği.

Job bir Mac'te bir simülatörle adım adım çalıştırıldı, bir GitHub runner'ında henüz çalıştırılmadı. Orada başarısız olursa hata job'ın kendisinde olabilir: lütfen bildirin.

Job, simülatörlü bir macOS runner'ında çalışır, bu yüzden sayıları o runner'a göredir. Yaptığı iş, tek bir makinede iki build arasındaki bir değişikliği yakalamak ve nedenini söylemektir.

Pull request'in base'ini ve head'ini tek bir job'da ölçer, çünkü başka bir makineden gelen bir baseline karşılaştırılamaz:

1. base'i derler, baseline'da üç çalıştırma olana kadar akışı ölçer ve [referansı](../reference/perf.tr.md#neden-kötüleşti) alır;
2. head'i derler ve akışı ölçer;
3. `appdyno perf why`; bir gerilemede, aşılan bir bütçede ya da karar veremediği bir değişiklikte (`few-samples`, `noisy`, `refused`) job'ı en sonda başarısız kılar;
4. kapı ne demiş olursa olsun `appdyno perf comment --out perf-comment.md`;
5. o dosyayı yükler ve `gh pr comment` ile, deponun kendi token'ıyla gönderir.

appdyno'nun servisi de token'ı da yoktur ve hiçbir şey göndermez. Bir dosya yazar, onu sizin job'ınız gönderir. Bir fork'tan gelen pull request yorum yapamayan bir token alır, bu yüzden orada yorum yalnızca job'ın artifact'lerindedir. Her çalıştırma yeni bir yorum yazar, çünkü `gh pr comment --edit-last` token'ın son yorumunu düzenler, bu yorum da başka bir workflow'a ait olabilir.

### Bir runner'dan ne beklenir

- Yük altında görülen bir değişiklik `noisy` sayılır, job'ı başarısız kılar ve yanıt yeniden ölçmenizi söyler. Yük altındaki bir çalıştırma baseline olarak reddedilir.
- GitHub'ın arm64 runner'larında 3 çekirdek vardır, bu da sınırı 2,4 yük yapar; bir build arkasında bundan fazlasını bırakır. Job'ın üç çalıştırma tamamlanana kadar ölçmesinin nedeni budur.
- Yeni bir simülatör başta kendi kendine meşguldür: iOS 27.2 ile bir M5 Pro'da yaklaşık 3 dakika ve 7 çekirdek. Bu yüzden job önce yükün düşmesini bekler, her build'den sonra da yeniden.
- `macos-latest` bir arm64 runner'ıdır ve [bunlarda iç içe sanallaştırma yoktur](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Bir Android emülatörü bir Intel etiketi ya da size ait bir Mac ister.
- Yeni bir simülatör bir bağlantının uygulamayı açıp açamayacağını bir kez sorar ve bu, bir akışı ilk `open_link`'inde durdurur. Ölçülen ilk çalıştırmadan önce bir kez yanıtlayın ya da ekrana düğmeleriyle ulaşın.
