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
    mac: 'Mac uygulaması',
    source: 'Açık kaynak',
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
    label: 'appdyno test tezgâhı: küçük bir ejderha dinamometredeki telefona göz kulak oluyor',
    dragon:
      'Tezgâhın üzerinde duran; mavi gövdeli, camgöbeği karınlı, macenta kanatlı küçük bir ejderha',
    phone: 'Göstergeli bir dinamometre tezgâhına bağlanmış bir akıllı telefon',
    launch: 'soğuk açılış',
    frames: 'kare / sn',
    memory: 'bellek',
  },
  mascot: {
    tap: 'Tezgâhın ejderhası. Küçük bir alev üflemesi için basın.',
    rest: 'Ejderhayı dinlendir',
    wake: 'Ejderhayı uyandır',
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
    example: 'Örnek bir oturum: süreler ve sayılar örnektir.',
  },
  cases: {
    title: 'Üç hata: bildirilmesinden regresyon testine',
    problem: 'Sorun',
    evidence: 'Kanıt',
    test: 'Regresyon testi',
    note: 'Sayılar örnektir.',
    items: [
      {
        name: 'Yavaşlayan bir liste',
        problem: 'Ürün listesi kaydırılırken kareler düşüyor.',
        evidence:
          '<code>perf_scroll</code>, düzeltmeden önce ve sonra: önce 41 fps, 300 karenin 38’i yavaş; sonra 59 fps, 2’si yavaş.',
        test: 'Listeyi kaydıran bir akış ve kareler yeniden düşerse başarısız olan bir <code>perf_compare</code> kapısı.',
      },
      {
        name: 'Ödemede bir çökme',
        problem: 'Sepette üç paket varken uygulama Siparişi ver’de çöküyor.',
        evidence:
          'Uygulamayı düşüren dokunuş, son log satırı (<code>Fatal error: Index out of range</code>) ve <code>crashes</code> ile gelen yığın izi.',
        test: 'Çökmeye kadar yeniden oynayan bir akış; hata düzeltilene kadar CI’da başarısız olur.',
      },
      {
        name: 'Yerel ekrandan web görünümüne geçişte bir hata',
        problem: 'Ödeme, yerel bir ekrandan web görünümüne geçerken bir değer kayboluyor.',
        evidence:
          'Geçişe kadar öğeler halinde ekran ve web görünümünün içindeki sayfayı okuyan <code>webview</code>.',
        test: 'Yerel adımları geçişe kadar yeniden oynatan bir akış; ardından <code>webview</code> değeri öbür tarafta okur.',
      },
    ],
  },
  mac: {
    title: 'Cihazın başındaki insan için bir Mac uygulaması',
    sub: 'Ajan cihazda yalnız değil: ne yaptığını izlersiniz, o kullanırken aynı cihazı siz de kullanırsınız.',
    points: [
      {
        name: 'Bütün cihazlar tek pencerede',
        text: '<code>appdyno hub</code>, bu Mac’teki bütün cihazları tek pencerede açar. Ajan bir cihazı kullanırken siz de fare ve klavyeyle kullanabilirsiniz.',
      },
      {
        name: 'Performans, olduğu anda',
        text: 'Performans paneli kareleri, CPU’yu ve belleği anında okur.',
      },
      {
        name: 'Yapay zekâ istemcileriniz',
        text: 'Yapay Zekâ İstemcileri, bu Mac’teki her MCP istemcisini gerçek durumuyla gösterir ve appdyno’yu ona ekler.',
      },
      {
        name: 'Telefonlar kabloyla ya da Wi-Fi ile',
        text: 'Telefon kabloyla bağlanır; <code>appdyno pair</code> ile bir kez eşleştirildikten sonra Wi-Fi ile de.',
      },
    ],
    download: 'Mac uygulamasını indirin (.dmg)',
    after:
      'GitHub’daki son sürümden. Apple silicon, macOS 13.5 ya da üstü. Uygulama kendini günceller.',
    shots: {
      hub: {
        alt: 'Karanlık görünümüyle hub: bir yapay zekâ istemcisi kaydırırken Ayarlar’da canlı bir iPhone simülatörü; Performans paneli görüntüyü saniyede 89 kare olarak, CPU’yu ve belleği okuyor',
        caption: 'Hub: solda cihazlar, ortada seçili olan canlı, sağda Performans paneli.',
      },
      links: {
        alt: 'Gerçek bir çalıştırma: bir MCP istemcisi, hub’daki bir iPhone simülatöründe bir test uygulamasının açtığı bağlantıları listeliyor, derin bağlantısını açıyor, uygulamanın kendi kodunun gösterdiği bir push gönderiyor, ardından ana ekrana bir tane daha; altta her çağrının gerçek süresi ve yanıtının ilk satırı',
        caption:
          'Pencere telefonu gösterirken bir ajan uygulamanın bağlantılarını açıyor ve ona push gönderiyor. Kayıt İngilizce arayüzle alındı.',
      },
      checkout: {
        alt: 'Gerçek bir çalıştırma: bir terminaldeki MCP araç çağrıları, appdyno hub’ındaki bir iPhone simülatöründe Shop örneğinin ödemesinden geçiyor; sepete üç paket kahve çekirdeği koyup Place order’a geliyor, bu uygulamayı düşürüyor ve yanıt öldüğünü son log satırıyla söylüyor: Fatal error: Index out of range',
        caption:
          'Kurgu değil, gerçek bir çalıştırma: Shop örneğinin ödemesi, her çağrının gerçek süresiyle. Kayıt İngilizce arayüzle alındı.',
      },
    },
  },
  source: {
    title: 'Açık kaynak, tamamı',
    sub: 'Sunucu, komut satırı, Mac uygulaması ve cihazlarda çalışan ajanlar tek bir açık depoda. Okuyun, derleyin, değiştirin.',
    license: {
      name: 'MIT lisansı',
      text: 'İşinizde kullanın, değiştirin, dağıtın. Lisans tek bir kısa dosya.',
    },
    github: {
      name: 'Kod GitHub’da',
      text: 'Kaynak, belgeler, testler ve değişiklik günlüğüyle her sürüm.',
      star: 'GitHub’da yıldız verin',
    },
    local: {
      name: 'Mac’inizde çalışır',
      text: 'appdyno telemetri göndermez ve bulut gerektirmez: Mac’inizde çalışır.',
    },
    install: {
      name: 'Tek komutla kurulur',
      text: 'Bu Mac’teki MCP istemcilerini bulur ve appdyno’yu seçtiklerinize ekler.',
    },
    registry: {
      name: 'Resmî MCP registry’sinde',
      text: 'Kendi adıyla listelenir; registry’yi okuyan bir istemci onu bulur.',
    },
    contribute: {
      name: 'Katkıya açık',
      text: 'Hata bildirimleri, düzeltmeler ve yeni fikirler. Nasıl derlenip test edileceği kılavuzda yazıyor.',
    },
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
