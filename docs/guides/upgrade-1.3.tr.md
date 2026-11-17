# 1.2'den 1.3'e geçiş

[English](upgrade-1.3.md)

1.3.0 araçların adlarını değiştirdi. 48 araç artık 28; her biri fiil_ad biçiminde adlandırıldı ve eski adlar takma ad bırakılmadan kalktı: eski bir adla yapılan çağrı `INVALID_ARGUMENT` ile reddedilir ve ipucu çağrılacak aracı söyler, örneğin `screen is now read_screen`. Bu sayfa, karşılaşacağınız sırayla, değiştirilecek her şeydir. `.flow` dosyalarınız hiçbir şey istemez.

## Kısaca

| elinizde olan                              | yapılacak                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| bir aracın iznini kaydetmiş bir istemci    | [sunucuya bütün olarak izin verin](#kaydedilmiş-izinler) ya da her yeni ada                 |
| araçları adıyla anan bir istem ya da skill | her birini [tabloya](#130dan-önceki-adlar) göre yeniden adlandırın                          |
| `appdyno` komutlarından oluşan bir betik   | [komutları yeniden adlandırın](#komutlar): aracın adı, tirelerle                            |
| bir `run_steps` çağrısı                    | [her adımı `tool` ile verin](#tek-çağrıdaki-adımlar), `action` ile değil                    |
| kütüphane üzerinde bir program             | [her `tool` çağrısını yeniden adlandırın](#kütüphane): TypeScript gördüğü her birini söyler |
| `.flow` dosyaları, `appdyno test`, CI      | [hiçbir şey](#aynı-kalanlar)                                                                |

## Kaydedilmiş izinler

Bir aracın onayını kaydeden istemci onu aracın adıyla kaydetti; bu yüzden 1.2'nin `mcp__appdyno__screen` onayı artık hiçbir araçla eşleşmez ve istemci yeniden sorar. İstemcinin onaylarını tuttuğu yerde bütün sunucuya izin verin, örneğin bir `permissions.allow` listesinde `mcp__appdyno` olarak; hangi dosyanın onu tuttuğunu [İstemci bağlamak](clients.tr.md#claude-code) söyler:

```json
{
  "permissions": {
    "allow": ["mcp__appdyno"]
  }
}
```

Yalnızca bazı araçlara izin vermek için her birini yeni adıyla, `mcp__appdyno__read_screen` ve `mcp__appdyno__tap_screen` gibi yazın ve eskileri çıkarın. Her araç için bir kez soran bir istemci, her yeni adın ilk çağrısında yeniden sorar. Sunucunun neyi yapabileceğini bir istemcinin onayları değil, `--allow-` bayrakları söyler: bkz. [Sunucu seçenekleri](../reference/cli.tr.md#sunucu-seçenekleri).

## Komutlar

Bir aracın komutu, tirelerle yazılmış adıdır; eylemi ve bir listeden söylenen başka ne varsa ilk sözcükleridir. Bayraklar, eskisi gibi, argümanlardır.

| 1.2                                      | 1.3                                                          |
| ---------------------------------------- | ------------------------------------------------------------ |
| `appdyno screen`                         | `appdyno read-screen`                                        |
| `appdyno tap --selector '{"text":"OK"}'` | `appdyno tap-screen --selector '{"text":"OK"}'`              |
| `appdyno wait-for --selector '{...}'`    | `appdyno check-element --selector '{...}' --timeout-ms 5000` |
| `appdyno record start`                   | `appdyno record-session video start`                         |
| `appdyno network stop`                   | `appdyno capture-network stop`                               |
| `appdyno app stop`                       | `appdyno manage-app stop`                                    |
| `appdyno flow run a.flow`                | `appdyno run-flow run a.flow`                                |

`appdyno test`, `perf compare|why|reference|baseline|budget|functions|prune`, `perf dashboard|survey|comment`, `push setup`, `mirror`, `hub`, `timeline`, `flight`, `devices`, `doctor`, `install` ve `update` sözcüklerini korur. `appdyno <command> --help` bir komutun bayraklarını listeler; [Komut satırı](../reference/cli.tr.md) hepsini verir.

## Tek çağrıdaki adımlar

`steps` artık `run_steps`; bir adım aracını `action` yerine `tool` ile, o aracın yeni adı ve argümanlarıyla adlandırır. `run_steps` ve `run_flow` dışında her araç bir adım olabilir. Bir bekleme, artık her yerde `check_element` olduğu gibi, süresini söyler.

```json
{
  "steps": [
    { "action": "tap", "selector": { "text": "Sign in" } },
    { "action": "wait_for", "selector": { "text": "Welcome" } }
  ]
}
```

şuna dönüşür:

```json
{
  "steps": [
    { "tool": "tap_screen", "selector": { "text": "Sign in" } },
    { "tool": "check_element", "selector": { "text": "Welcome" }, "timeoutMs": 5000 }
  ]
}
```

Yalın `double_tap`, `long_press` ve `drag` türleri, `count: 2` ile `tap_screen`, `holdMs` ile `tap_screen` ve `to` ile `swipe_screen` olur. Araç olmayan bir adım, hiçbir şey yapılmadan bütün çağrıyı reddeder.

## Kütüphane

`connect`'in `tool` çağrısı yeni adları, argümanlarıyla yukarıdaki gibi alır:

```ts
await device.tool('tap_screen', { selector: { text: 'Form' } });
const screen = await device.tool('read_screen', { raw: true });
```

1.2'de bunlar `device.tool('tap', ...)` ve `device.tool('screen', ...)` idi. Adlar bir tiptir, bu yüzden TypeScript derlerken her eski adda durur; ondan geçen bir çağrı, örneğin JavaScript'ten, çalışırken ipucuyla reddedilir. `connect`'in seçenekleri, `replay` ve `close` adlarını korur; `appdyno/device` sahip olduğu hiçbir şeyi değiştirmedi, yalnızca çağrılar ve seçenekler kazandı. [Kütüphane](../reference/library.tr.md) yüzeyin tamamını verir.

## Bir betiğin karşılaşabileceği öteki değişiklikler

- Süresi dolan bir bekleme `TIMEOUT` ile değil `CHECK_FAILED` ile başarısız olur ve `timeoutMs` değerini söyler: 5000 varsayılanı yoktur.
- Bir araç, çağrısının söylediği yere bir dosyayı yalnızca sunucunun çalıştığı klasörün, durum klasörünün ya da `--allow-write` ile verilen bir klasörün içine yazar; başka bir yerde `POLICY_DENIED` ile reddedilir.
- `manage_app build_and_run`, sunucu `--allow-build` ile başlatılmadıysa her seferinde kişiye sorar.
- `manage_app uninstall`, `clear`, `grant` ve `revoke`, `transfer_files push` ve `set_device keychain` önce kişiye sorar.
- `--toolsets` yalnızca adı verilen araç gruplarını listeler, örneğin `core,network,perf`: bkz. [Yalnızca bazı araçları listelemek](../reference/tools.tr.md#yalnızca-bazı-araçları-listelemek).

## Aynı kalanlar

- `.flow` dosyaları: adımları kendilerine ait sözcüklerdir, örneğin `tap`, `wait_for` ve `setting`; 1.2 ile kaydedilmiş bir flow 1.3'te yeniden oynatılır.
- `appdyno test`, bayrakları, raporu ve çıkış kodları.
- Sunucunun bayrakları ve değişkenleri, yanlarında yenileriyle.
- Cihazlar, Mac uygulaması ve durum klasörü: yeniden kurulacak bir şey yok.

## 1.3.0'dan önceki adlar

Her eski araç, yerini alan araç ve argümanlarının nasıl değiştiği. "Aynı", değişmedikleri anlamına gelir.

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
