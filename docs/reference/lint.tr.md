# Sıkı lint

[English](lint.md)

Kodun typescript-eslint'in tipe dayalı kurallarını, bir kuralın bir seçim bıraktığı yerde nasıl karşıladığı. [CONTRIBUTING](../../CONTRIBUTING.tr.md)
lint'in nasıl çalıştığını ve bir kuralın bir satır için ne zaman kapatılabileceğini söyler.

- Bir `!`, derleyicinin izleyebildiği şeye yerini bırakır: bir index yerine bir destructuring ya da girdiler üzerinde bir döngü, `has` sonra
  `get!` yerine tek bir `get` ve bir kontrol, bir `if`'in daralttığı değerin bir `const`'ta tutulması. Kodun tiplerin bilemediğini bildiği yerde
  (sınırlar içindeki bir index, kendi koyduğu bir anahtar, bir regex'in grubu) core'un `must(value, 'what')`'ı eksik olanı adıyla söyleyerek
  hata fırlatır; bir `!` ise undefined ile devam ederdi. Hiçbir şeyi içe aktarmayan `protocol` bir `if` ile kontrol eder. Onun yerine hiçbir zaman
  `as` kullanılmaz. Bir testte vitest'in `assert(x)`'i daraltır; eşleştiricisi undefined'da başarısız olan bir `expect`'in içinde
  `?.` yeterlidir.
- `await` içermeyen bir `async` fonksiyon, hiçbir çağıranın ondan bir promise beklemediği yerde düz bir fonksiyondur ve çağıranlar
  `await`'lerini bırakır. Tipi ya da bir çağıran bir promise istediğinde (bir port, onun bir sahtesi, üzerindeki bir `.catch`)
  `Promise.resolve(x)` döndürür, bir `throw` yerine de `Promise.reject(e)`, çünkü bir `.catch` throw'u kaçırırdı; kendi başına
  hata fırlatabilecek bir gövde `new Promise((resolve) => { resolve(work()); })` içine girer.
- Dışarıdan gelen (JSON, hat, bir cihaz, bir dosya, ortam, argv, bir aracın çıktısı), bir şema ya da bir kontrol onu daraltana kadar `unknown`'dır ya da
  neyin eksik olabileceğini söyleyen bir tiptir; böylece üzerindeki bir kontrol tiplerin de ihtiyaç duyduğu bir kontrol olur:
  `no-unnecessary-condition` onu hiçbir zaman kaldırmaz. Biçimini kodun kendisinin yazdığı JSON çağrının yerinde cast edilir,
  hiçbir zaman onu gizleyen bir generic ile değil. Bir `catch` callback'i `(e: unknown)` alır ve onu
  `e instanceof Error ? e.message : String(e)` ile okur.
- Bir callback'in ayarladığı ve derleyicinin başladığı değer sandığı bir bayrak `let done = false as boolean` olur;
  typescript-eslint bunun için bunu önerir, yanında nedenini söyleyen bir söz bulunur.
- `||` string'ler ve boolean'lar için kalır, orada `''` ve `false` istendiği gibi geçip gider; bir sayı ya da bir nesne `??` alır,
  `0`'ın da geçip gitmesi gerekmedikçe; o zaman satır bunu söyler.
- Bağlanmadan dolaştırılan şey (`stop`, bir sahtenin üyeleri) bir ok fonksiyonudur ya da bağlanmıştır. Bir mock, bir testte olduğu
  mock olarak okunur, hiçbir zaman portunun tipinden değil.
- Bir şablon string'ler ve sayılar tutar: bir undefined, olamayacağı yerde daraltmayla gider; `String(x)` ise metnin
  kastedildiği yerde onu korur. vitest'in asimetrik eşleştiricileri `any` tiplidir: bir nesnenin içindeki `as unknown` olur.
- Bir birleşimdeki `void`, `undefined`'dır; hiçbir şey yanıtlamayan bir fonksiyon `Promise<undefined>` der, çünkü TypeScript
  `void` için `return` kabul etmez.
