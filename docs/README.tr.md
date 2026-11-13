# Belgeler

[English](README.md)

appdyno, iOS ve Android uygulamalarını Mac'inizden yönetir ve ölçer. Yeni misiniz? [README](../README.tr.md) ile başlayın.

## Rehberler

Her biri sizi bir işin baştan sonuna götürür.

| rehber                                         | ne için okunur                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [İstemci bağlamak](guides/clients.tr.md)       | appdyno'yu MCP istemcinize bağlamak ve imzalama dahil bir telefonu hazırlamak                       |
| [Akışlar](guides/flows.tr.md)                  | ajanın yaptığını kaydetmek, model olmadan yeniden oynatmak, CI'da çalıştırmak                       |
| [Kanıt](guides/evidence.tr.md)                 | geride bir video, rapor, ağ kaydı ya da görsel fark bırakmak                                        |
| [Performansı ölçmek](guides/performance.tr.md) | bir uygulamayı ölçmek, baseline tutmak ve uygulamayı yavaşlatan bir pull request'i başarısız saymak |

## Başvuru

Bir şeye bakmak için burası.

| başvuru                                                    | içindekiler                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Araçlar](reference/tools.tr.md)                           | her araç ve girdileri, her platformun neyi yapıp neyi yapamadığı                                  |
| [Araçlar nasıl test edildi](reference/tools-tested.tr.md)  | her aracın neyin üzerinde çalıştırıldığı ve çalıştırmaların ne gösterdiği                         |
| [Komut satırı](reference/cli.tr.md)                        | her komut, sunucunun seçenekleri ve değişkenleri                                                  |
| [Kütüphane](reference/library.tr.md)                       | bir cihazı TypeScript'ten yönetmek                                                                |
| [Pencere ve hub](reference/mirror.tr.md)                   | canlı pencere ve hub: her denetim, panel ve durum, sınırlarıyla                                   |
| [Pencere nasıl çalışır](reference/mirror-internals.tr.md)  | görüntünün ve girdinin nasıl ilerlediği, iletişim protokolü ve hangi cihazda neyin çalıştırıldığı |
| [Performans](reference/perf.tr.md)                         | her ölçümün her cihazda neyi okuduğu, kapı ve her çağrının ne kadar hızlı olduğu                  |
| [Ölçümler nasıl doğrulandı](reference/perf-evidence.tr.md) | her ölçümün bilinen bir maliyete karşı sınanması: hangi cihazda, hangi gün, hangi yük altında     |
| [Protokol](reference/protocol.tr.md)                       | host ile bir cihazın ajanı arasındaki baytlar                                                     |
| [CI ve sürümler](reference/ci.tr.md)                       | her denetim, cihaz suite'leri, bir sürümün nasıl yapıldığı                                        |
| [Sıkı lint](reference/lint.tr.md)                          | kodun, bir seçim bırakan tipe dayalı bir kuralı nasıl karşıladığı                                 |

## Örnekler

Her biri olduğu gibi çalışır.

| örnek                                     | şunun için deneyin                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| [Shop](examples/shop/README.tr.md)        | bir ödemedeki çökmeyi bir ajanla bulmak, sonra bir akışla düzeltilmiş tutmak     |
| [`perf-gate.yml`](examples/perf-gate.yml) | uygulamayı yavaşlatan bir pull request'i bir GitHub runner'ında başarısız saymak |

## Nasıl çalışır

[Mimari](architecture.tr.md), parçaların nasıl ve neden birleştiğini, onları değiştirmek üzere olan kişi için anlatır.

[CONTRIBUTING](../CONTRIBUTING.tr.md) kurulumu, kontrollerin nasıl çalıştırılacağını ve bir değişikliğin nasıl gönderileceğini anlatır. [SECURITY](../SECURITY.tr.md) appdyno'nun nelere ulaşabildiğini ve bir sorunun nasıl bildirileceğini söyler.
