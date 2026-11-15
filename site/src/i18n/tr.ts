import type { Words } from './en.ts';

/** Every word of the site in Turkish, key for key with `en.ts`. */
export const tr: Words = {
  meta: {
    title: 'appdyno: mobil uygulamanızı bir yapay zekâ ajanı kullansın, test etsin, ölçsün',
    description:
      'Mobil uygulamanızı bir yapay zekâ ajanı kullansın, test etsin, ölçsün: iOS simulator’ları, Android emulator’ları ve gerçek telefonlar; açık kaynak tek bir MCP sunucusu, CLI ve Mac uygulamasıyla.',
    locale: 'tr_TR',
    other: 'English',
  },
  nav: {
    label: 'Site',
    console: 'Deneyin',
    mac: 'Mac uygulaması',
    docs: 'Belgeler',
    github: 'GitHub',
  },
  hero: {
    title:
      'Bir mobil hatayı yeniden üretin, nedenini ölçümlerle bulun ve aynı flow’u yeniden çalışan bir teste dönüştürün.',
    sub: 'appdyno ile bir yapay zekâ ajanı iOS ve Android uygulamanızı kullanır, test eder ve ölçer.',
    copy: 'Kopyala',
    copied: 'Kopyalandı',
    clients: 'Her MCP istemcisiyle çalışır.',
    shot: 'Gerçek bir çalıştırma: bir terminaldeki MCP araç çağrıları, appdyno hub’ındaki bir iPhone simulator’ında Shop örneğinin ödemesinden geçiyor; sepete üç paket kahve çekirdeği koyup Place order’a geliyor, bu uygulamayı düşürüyor ve yanıt öldüğünü son log satırıyla söylüyor: Fatal error: Index out of range',
  },
  mascot: {
    picture: 'Lacivert gövdeli, camgöbeği karınlı, macenta kanatlı küçük bir ejderha',
    tap: 'Ejderha. Küçük bir alev üflemesi için basın.',
    rest: 'Ejderhayı dinlendir',
    wake: 'Ejderhayı uyandır',
  },
  console: {
    title: 'Sorun. Kullanışını izleyin.',
    sub: 'Bir iş seçin. Ajan aynı çağrıları sizin simulator’ınızda, emulator’ınızda ya da telefonunuzda yapar.',
    jobs: 'Denenecek işler',
    phone: 'Shop örneğini çalıştıran bir iPhone simulator’ı',
    client: 'ajan → appdyno',
    ready: 'hazır',
    running: 'çalışıyor',
    done: 'bitti',
    idle: 'Yukarıdan bir iş seçin. Çağrılar ve yanıtlar burada görünür.',
    you: 'siz',
    tools: '48 aracın tümünü görün',
    example: 'Örnek bir oturum: sayılar örnektir.',
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
      crashed: 'Beans 09:41:07’de crash oldu:',
    },
    push: {
      chip: 'Push gönder',
      ask: 'bir kargo push’u gönder',
      sent: 'simctl push ile gönderildi · bildirim ekranda görünüyor',
    },
    link: {
      chip: 'Deep link aç',
      ask: 'Kenya ürün sayfasını deep link’iyle aç',
      opened: 'dev.beans içinde açıldı',
      header: 'başlık',
    },
    perf: {
      chip: 'Cold launch’ı ölç',
      ask: 'cold launch ne kadar sürüyor?',
      launch: 'cold launch, 5 çalıştırma: p50',
      scroll: '59 FPS p50, 300 frame’de 2 yavaş frame · memory 182 MB, artış yok',
    },
    views: {
      chip: 'Bu ekranı ne çiziyor?',
      ask: 'bu ekranı ne çiziyor?',
      framework: 'framework:',
    },
    flow: {
      chip: 'Test olarak yeniden çalıştır',
      ask: 'ödemeyi flow olarak kaydet ve yeniden çalıştır',
      saved: '4 step flows/checkout.flow olarak kaydedildi',
      replayed: '4 step, model yok · yine Siparişi ver’de başarısız',
    },
  },
  cases: {
    title: 'Üç hata: bildirimden regression test’e',
    problem: 'Sorun',
    evidence: 'Kanıt',
    test: 'Regression test',
    note: 'Sayılar örnektir.',
    items: [
      {
        name: 'Yavaşlayan bir liste',
        problem: 'Ürün listesi kayarken frame’ler düşüyor.',
        evidence: '<code>perf_scroll</code>: düzeltmeden önce 41 FPS, sonra 59.',
        test: '<code>perf_compare</code> gate’i olan bir flow.',
      },
      {
        name: 'Ödemede bir crash',
        problem: 'Uygulama Siparişi ver’de crash oluyor.',
        evidence: 'Son log satırı ve <code>crashes</code> ile gelen stack.',
        test: 'Düzeltilene kadar CI’da başarısız olan bir flow.',
      },
      {
        name: 'Web view’da kaybolan bir değer',
        problem: 'Native ekrandan web view’a geçerken bir değer kayboluyor.',
        evidence: '<code>webview</code>, web view’ın içindeki sayfayı okur.',
        test: 'Geçişe kadar bir flow; sonra değeri <code>webview</code> okur.',
      },
    ],
  },
  mac: {
    title: 'Cihazın başındaki insan için bir Mac uygulaması',
    sub: 'Ajanın ne yaptığını izleyin; o kullanırken aynı cihazı siz de kullanın.',
    points: [
      {
        name: 'Bütün cihazlar tek pencerede',
        text: '<code>appdyno hub</code> her birini canlı gösterir; fare ve klavyeyle kullanılır.',
      },
      {
        name: 'Performans, olduğu anda',
        text: 'Frame, CPU ve memory canlı okunur.',
      },
      {
        name: 'Yapay zekâ istemcileriniz',
        text: 'appdyno’yu bu Mac’teki her MCP istemcisine ekler.',
      },
    ],
    download: 'Mac uygulamasını indirin',
    after: 'Apple silicon, macOS 13.5 ya da üstü. Uygulama kendini günceller.',
    shot: 'Karanlık görünümüyle hub: bir yapay zekâ istemcisi kaydırırken Ayarlar’da canlı bir iPhone simulator’ı; Performans paneli görüntüyü 89 FPS olarak, CPU’yu ve memory’yi okuyor',
  },
  source: {
    title: 'Açık kaynak',
    local: 'appdyno telemetri göndermez ve bulut gerektirmez: Mac’inizde çalışır.',
    license: 'MIT lisansı',
    star: 'GitHub’da yıldız verin',
    registry: 'MCP registry’sindeki adı:',
    contribute: 'Katkıda bulunun',
  },
  faq: {
    title: 'Sorular',
    items: [
      {
        q: 'appdyno nedir?',
        a: 'Bir yapay zekâ ajanının iOS ve Android uygulamalarını simulator’da, emulator’da ve gerçek telefonda kullanmasını, test etmesini ve ölçmesini sağlayan açık kaynak bir MCP sunucusu, CLI, TypeScript kütüphanesi ve Mac uygulamasıdır.',
      },
      {
        q: 'Hangi cihazlarla çalışır?',
        a: 'Xcode üzerinden iOS 17 ya da daha yenisini çalıştıran iOS simulator’ları ve iPhone’larla, adb üzerinden Android 8.0 ya da daha yenisini çalıştıran Android emulator’ları ve telefonlarıyla.',
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
