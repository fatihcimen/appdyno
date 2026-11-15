import type { Words } from './en.ts';

/** Every word of the site in Turkish, key for key with `en.ts`. */
export const tr: Words = {
  meta: {
    title: 'appdyno: mobil uygulamanızı bir yapay zekâ ajanı kullansın, test etsin, ölçsün',
    description:
      'Mobil uygulamanızı bir yapay zekâ ajanı kullansın, test etsin, ölçsün: iOS simülatörleri, Android emülatörleri ve gerçek telefonlar; açık kaynak tek bir MCP sunucusu, komut satırı aracı ve Mac uygulamasıyla.',
    locale: 'tr_TR',
    other: 'English',
  },
  nav: {
    label: 'Site',
    story: 'Nasıl çalışır',
    console: 'Deneyin',
    tools: 'Neler yapar',
    faq: 'Sorular',
    docs: 'Belgeler',
    github: 'GitHub',
  },
  hero: {
    kicker: 'MCP sunucusu · CLI · Mac uygulaması',
    title: 'Uygulamanızı <em>dyno</em>’ya bağlayın.',
    lede: 'Bir mobil hatayı yeniden üretin, nedenini ölçümlerle bulun ve aynı akışı yeniden çalışan bir teste dönüştürün.',
    copy: 'Kopyala',
    copied: 'Kopyalandı',
  },
  bench: {
    label: 'appdyno test tezgâhı: bir dinozor teknisyen bir telefonu dinamometrede çalıştırıyor',
    dino: 'Lacivert tulumlu, elinde tablet tutan küçük bir dinozor teknisyen',
    phone: 'Göstergeli bir dinamometre tezgâhına bağlanmış bir akıllı telefon',
    launch: 'soğuk açılış',
    frames: 'kare / sn',
    memory: 'bellek',
  },
  console: {
    title: 'Sorun. Kullanışını izleyin.',
    sub: 'Bir iş seçin. Ajan, simülatörünüzde, emülatörünüzde ya da telefonunuzda yapacağı çağrıların aynısını yapar; her yanıt ekranın durulduktan sonraki haliyle gelir. Bu örnek bir oturumdur.',
    jobs: 'Denenecek işler',
    phone: 'Shop örneğini çalıştıran bir iPhone simülatörü',
    client: 'ajan → appdyno',
    ready: 'hazır',
    running: 'çalışıyor',
    done: 'bitti',
    idle: 'Yukarıdan bir iş seçin. Çağrılar ve yanıtlar burada görünür.',
    you: 'siz',
    app: {
      name: 'Beans',
      cart: 'Sepet',
      add: 'Ekle',
      place: 'Siparişi ver',
      products: ['Ethiopia Guji', 'Colombia Huila', 'Kenya Nyeri'],
      prices: ['250 g · €14', '250 g · €12', '250 g · €15'],
      pushBody: 'Siparişiniz yola çıktı. Perşembe günü elinizde.',
      stopped: 'Beans durdu',
      stoppedAt: 'Uygulama Siparişi ver’de sonlandı.',
    },
    checkout: {
      chip: 'Ödemeyi test et',
      ask: 'ödemeyi üç paketle test et',
      tapped: '"Ekle"ye dokunuldu',
      ended: 'uygulama bu dokunuşta sonlandı',
      crashed: 'Beans 09:41:07’de çöktü:',
    },
    push: {
      chip: 'Push gönder',
      ask: 'bir kargo push’u gönder',
      sent: 'simctl push ile gönderildi · bildirim ekranda görünüyor',
    },
    link: {
      chip: 'Deep link aç',
      ask: 'Kenya ürün sayfasını bağlantısıyla aç',
      opened: 'dev.beans içinde açıldı',
      header: 'başlık',
    },
    perf: {
      chip: 'Açılışı ölç',
      ask: 'soğuk açılış ne kadar sürüyor?',
      launch: 'soğuk açılış, 5 çalıştırma: p50',
      scroll: '59 fps p50, 300 karede 2 yavaş kare · bellek 182 MB, artış yok',
    },
    views: {
      chip: 'Bu ekranı ne çiziyor?',
      ask: 'bu ekranı ne çiziyor?',
      framework: 'çatı:',
    },
  },
  rack: {
    title: 'Rafta neler var',
    sub: 'Tek sunucuda 48 araç. Bir platformun yapamadığı şey nedeniyle birlikte reddedilir, asla taklit edilmez.',
    tools: [
      {
        name: 'Oku ve kullan',
        text: 'Ekran, ref’li öğeler halinde ve kısa kalacak şekilde katlanmış olarak gelir. Dokun, yaz, kaydır, öğeye kadar kaydır.',
        code: 'screen · tap · type_text · scroll_to',
      },
      {
        name: 'Push’lar ve bağlantılar',
        text: 'Bir simülatöre ya da emülatöre alert, rich, background ve Live Activity push’ları, bir de deep link’ler.',
        code: 'push · open_link',
      },
      {
        name: 'Ölç',
        text: 'Soğuk ve sıcak açılış, bir liste kayarken kareler, bellek, ağ; CI’daki bir kapının tuttuğu baseline’larla.',
        code: 'perf_launch · perf_scroll · perf_compare',
      },
      {
        name: 'Yerel görünümler',
        text: 'Görünüm ağacı, onu çizen çatının altında: SwiftUI, UIKit, Compose, Flutter, React Native, web.',
        code: 'screen views',
      },
      {
        name: 'Akışlar ve kanıt',
        text: 'Her cihazda yeniden çalışan akışlar, görsel baseline’lar, dokunuşların işaretlendiği video, loglar ve çökme kayıtları.',
        code: 'flow run · record · logs · crashes',
      },
      {
        name: 'Cihazın kendisi',
        text: 'Karanlık mod, dil, konum, yavaş ağ, bellek uyarıları, sallama, fotoğraflar; sonra her şey eski haline döner.',
        code: 'device_setting · restore',
      },
    ],
    safe: 'Varsayılan olarak güvenli: appdyno bir telefonu asla sıfırlamaz ya da silmez, veri yok eden her işlemden önce bir kişiye sorar ve adını verdiğiniz gizli değerleri saklar. Bulut yok, telemetri yok, MIT.',
  },
  dials: {
    example: 'Göstergeler örnek bir oturumu gösterir.',
  },
  story: {
    title: 'Dyno’da neler olur',
    sub: 'Tek istek, altı hamle. Sayfayı kaydırın; telefonlar, ajanın sizin cihazınızda yaptığını yapsın.',
    ios: 'iPhone 17 · simülatör',
    android: 'Pixel 9 · emülatör',
    steps: {
      read: {
        name: 'Ekranı okur',
        text: 'Piksel olarak değil: ekrandaki öğeler olarak, her biri ajanın kullanabileceği bir ref ile. <code>screen</code> bunları katlayarak verir, yanıt kısa kalır.',
      },
      tap: {
        name: 'Dokunur ve yazar',
        text: 'Metinle, id ile ya da ref ile. Her işlem, ekranın durulduktan sonraki haliyle yanıtlanır; ajan ne yaptığını aynı çağrıda görür.',
      },
      push: {
        name: 'Push gönderir, bağlantı açar',
        text: 'Simülatörün ya da emülatörün kabul ettiği her türde push ve uygulamanızın açtığı derin bağlantılar. Bildirim, uygulamanın kendi bildirimidir.',
      },
      measure: {
        name: 'Açılışı ölçer',
        text: 'Soğuk açılış, liste kayarken kareler, bellek: platformun kendi araçlarıyla okunur ve bir CI kapısının koruduğu baseline olarak saklanır.',
      },
      crash: {
        name: 'Çökmeyi bulur',
        text: 'Bir dokunuş uygulamayı düşürdüğünde aynı yanıt bunu, uygulamanın son log satırıyla birlikte söyler. Ardından <code>crashes</code>, fonksiyona kadar yığın izini verir.',
      },
      replay: {
        name: 'Akışı Android’de yeniden oynatır',
        text: 'Ajanın bir kez yaptığı şey akış olarak kaydedilir. Model olmadan yeniden çalışır: bir Android emülatöründe, bir telefonda, CI’da.',
      },
    },
    died: '"Siparişi ver"e dokunuldu; uygulama kapandı',
    lastLog: 'son log satırı',
    saved: '4 adım flows/checkout.flow olarak kaydedildi',
    replayed: '4 adım, model yok · iPhone’daki gibi Siparişi ver’de başarısız oluyor',
  },
  faq: {
    title: 'Sorular',
    items: [
      {
        q: 'appdyno nedir?',
        a: 'Bir yapay zekâ ajanının iOS ve Android uygulamalarını simülatörde, emülatörde ve gerçek telefonda kullanmasını, test etmesini ve ölçmesini sağlayan açık kaynak bir MCP sunucusu, komut satırı aracı, TypeScript kütüphanesi ve Mac uygulamasıdır.',
      },
      {
        q: 'Hangi cihazlarla çalışır?',
        a: 'Xcode üzerinden iOS 17 ya da daha yenisini çalıştıran iOS simülatörleri ve iPhone’larla, adb üzerinden Android 8.0 ya da daha yenisini çalıştıran Android emülatörleri ve telefonlarıyla.',
      },
      {
        q: 'Hangi yapay zekâ istemcileri kullanabilir?',
        a: 'Bütün MCP istemcileri. Tek bir komut, npx -y appdyno install, Mac’inizdeki istemcileri bulur ve appdyno’yu seçtiklerinize ekler.',
      },
      {
        q: 'Çalıştırmak için ne gerekir?',
        a: 'Bir Mac ve Node 22 ya da daha yenisi. Mac uygulaması kendi Node’unu taşır; Apple silicon üzerinde macOS 13.5 ya da daha yenisiyle çalışır.',
      },
      {
        q: 'Ücretsiz mi, verilerim nereye gidiyor?',
        a: 'appdyno ücretsizdir ve MIT lisansıyla açık kaynaktır. Mac’inizde çalışır; bulut yok, telemetri yok.',
      },
      {
        q: 'Bir ajan telefonumu silebilir mi?',
        a: 'Hayır. Hiçbir araç bir cihazı silmez ya da sıfırlamaz; veri kaybettiren her işlemi, yapılmadan önce bir kişi onaylar.',
      },
    ],
  },
  footer: {
    npm: 'npm',
    github: 'GitHub',
    changelog: 'Değişiklikler',
    docs: 'Belgeler',
    analytics: 'Bu site ziyaretleri çerez kullanmadan Cloudflare Web Analytics ile sayar.',
  },
  notFound: {
    title: 'Sayfa bulunamadı',
    text: 'Bu adreste bir sayfa yok.',
    home: 'Ana sayfa',
    docs: 'Belgeler',
  },
  docs: {
    guides: 'Rehberler',
    reference: 'Başvuru',
    examples: 'Örnekler',
    architecture: 'Nasıl çalışır',
  },
};
