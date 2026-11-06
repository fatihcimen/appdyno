# İstemci bağlamak

[English](clients.md)

appdyno, Mac'inizde, kullandığı telefonun ya da simülatörün yanında çalışır. İstemci ise sizin konuştuğunuz uygulamadır. Bu sayfa ikisini nasıl bağlayacağınızı istemci istemci anlatır, ayrıca hiçbir şey kurulu değilken bir telefonu nasıl hazırlayacağınızı gösterir. Her istemcinin neler sunduğu 4 Kasım 2026'da kendi belgelerinden okundu. Bunlar sık değişir: bir menünün yeri değiştiyse istemcinin kendi sayfasına güvenin. İstemcilerin menü adları İngilizce arayüzdeki gibi yazıldı; telefon ayarlarının adları ise üreticiye ve sürüme göre değişebilir.

İstemcilerin çoğu appdyno'yu Mac'inizde kendisi başlatır, bunun için ağ gerekmez. Tarayıcıda çalışan bir istemci ise Mac'inizde hiçbir şey başlatamaz. Zor olan durum budur.

| istemci                                     | appdyno'ya nasıl ulaşır                                    | başlangıç noktası                                |
| ------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| Claude Code, Claude Desktop                 | Mac'inizde çalıştırır                                      | [Bu Mac'teki istemciler](#bu-macteki-istemciler) |
| Codex, ChatGPT masaüstü uygulaması          | Mac'inizde çalıştırır                                      | [Bu Mac'teki istemciler](#bu-macteki-istemciler) |
| Cursor, VS Code, Devin Desktop, Antigravity | Mac'inizde çalıştırır                                      | [Bu Mac'teki istemciler](#bu-macteki-istemciler) |
| Gemini CLI, Zed, opencode, Cline            | Mac'inizde çalıştırır                                      | [Bu Mac'teki istemciler](#bu-macteki-istemciler) |
| Tarayıcıda ChatGPT                          | sizin çalıştırdığınız bir tünel; Business, Enterprise, Edu | [Tarayıcıda ChatGPT](#tarayıcıda-chatgpt)        |
| Tarayıcıda, telefonda, Cowork'te Claude     | sizin çalıştırdığınız bir tünel                            | [Tarayıcıda Claude](#tarayıcıda-claude)          |

Sonra cihazınızı hazırlayın: [Android](#android-telefon-veya-emülatör), [iPhone veya simülatör](#iphone-veya-simülatör). Bir şey ters giderse [Çalışmıyorsa](#çalışmıyorsa) bölümüne bakın.

## appdyno'yu kurmak

Çoğu kişi için Mac uygulaması yeterlidir, terminal gerektirmez. npm paketi CI ve geliştiriciler içindir. İkisi de aynı kodu çalıştırır.

### Mac uygulaması

Apple silicon işlemcili, macOS 13.5 ya da üstü bir Mac gerekir. Node, Xcode ya da terminal gerekmez: uygulama kendi Node'unu, Android agent'ı ve penceresini içinde taşır.

Henüz yayımlanmış bir sürüm yok. O zamana kadar kaynak kod aynı uygulamayı derler: `pnpm build && node scripts/build-app.mjs` onu `.app-build` klasörüne bırakır.

1. `Appdyno-<sürüm>-arm64.dmg` dosyasını [sürümler](https://github.com/fatihcimen/appdyno/releases) sayfasından indirip açın.
2. Appdyno'yu Applications klasörüne sürükleyin.
3. Appdyno'yu açın. Hub açılır, menü çubuğunda cihazlarınızla birlikte bir simge kalır. Dock'ta Appdyno yalnızca bir pencere açıkken görünür.

**İlk açılış.** Developer ID'si olmayan bir derleme ad hoc imzalıdır ve macOS onu çift tıklamayla açmaz. macOS 15 ve üstünde uygulamayı doğrulayamadığını söyler: Done'a tıklayın, ardından System Settings, Privacy & Security bölümünde aşağı inip Open Anyway'e tıklayın ve parolanızı girin. macOS 13 ve 14'te uygulamaya Control ile tıklayıp Open'ı seçin ve onaylayın. İkisi de yalnızca bir kez sorulur. Apple'ın noter onayından geçmiş bir derlemede macOS yalnızca internetten gelen bir uygulamayı açmak isteyip istemediğinizi sorar.

**Android** için adb gerekir ve uygulama onu içinde taşımaz: Google'ın koşulları buna izin vermez ve içinde LGPL kod vardır. Menü çubuğundaki Get adb for Android, Google'ın koşullarını kabul ettiğinizde Google'ın kendi platform-tools paketini (16 MB) indirir ve sabit bir hash ile doğrular. Android Studio ya da `ANDROID_HOME` size zaten adb sağlıyorsa uygulama onu kullanır ve bu öğe görünmez.

**Menü çubuğunda**, Put appdyno on the PATH `/usr/local/bin/appdyno` konumuna bir bağlantı koyarak `appdyno` komutunun her terminalde çalışmasını sağlar, macOS parolanızı sorabilir. Add to MCP Clients neyi değiştireceğini gösterir ve `appdyno install` ile aynı işi yapar. Uygulamayı taşırsanız istemcileriniz ve bağlantı bir sonraki açılışta onu izler.

**Homebrew ile.** Her sürüm bir cask dosyası taşır: `appdyno.rb`. Onu kendi tap'inize kopyalayın:

```sh
brew tap-new siz/araclar
cp appdyno.rb "$(brew --repository siz/araclar)/Casks/"
brew install --cask siz/araclar/appdyno
```

### npm paketi

Bir Mac ve Node 22 ya da üstü gerekir. `node --version` ile bakın; "command not found" derse [nodejs.org](https://nodejs.org/) adresinden LTS sürümünü kurun.

appdyno henüz npm'de yok. Yayımlanana kadar kaynak koddan derlenir, bunun için pnpm ve JDK 21 de gerekir:

```sh
sh scripts/install.sh      # kaynak kodu derler ve appdyno komutunu kurar
appdyno doctor             # nelerin kurulu olduğunu, neyin eksik olduğunu söyler
```

Yayımlandıktan sonra kaynak koda gerek kalmayacak, sıradaki adımı doğrudan `npx -y appdyno install` yapacak.

## appdyno'yu güncel tutmak

Yeni bir sürüme geçmenin tek yolu `appdyno update`. Arka planda sürüm aranmaz: arama bir ağ çağrısıdır ve appdyno telemetri içermez.

```sh
appdyno update --check     # kurulu sürüm, son sürüm, ne olacağı; hiçbir şeyi değiştirmez
appdyno update             # son sürümü doğrular, sonra ona geçer
```

Mac'inizde bir şey değişmeden önce doğrulama yapılır ve bunu atlayan bir seçenek yoktur. Tam sürüm geçici bir klasöre kurulur, betiklerinin hiçbiri çalıştırılmaz ve `npm audit signatures` onu orada denetler. npm'in, yalnızca bir bağımlılık için değil o sürümün kendisi için bir provenance attestation doğrulamış olması ve bu attestation'ın sürümün appdyno'nun kendi deposundan derlendiğini söylemesi gerekir. Aksi halde sürüm bir kod ve bir ipucuyla reddedilir, sizin sürümünüz yerinde kalır.

Bunun için npm 11.12 ya da üstü gerekir, appdyno'yu pnpm kurmuş olsa bile: eski sürümler hangi paketi doğruladığını söylemez. Node 22 daha eski bir npm ile gelir, bu yüzden önce `npm install -g npm@latest` çalıştırın.

Ardından appdyno'yu hangi araç kurduysa onunla yükseltir. Hangisi olduğunu, sürümü ve klasörüyle birlikte `appdyno doctor` gösterir.

| neyle kuruldu                | `appdyno update`                                                  |
| ---------------------------- | ----------------------------------------------------------------- |
| `npm install -g`, her prefix | npm ile, o prefix içinde, az önce doğruladığı kopyadan yükseltir  |
| `pnpm add -g`                | pnpm ile, tam o sürüme yükseltir; pnpm onu yeniden indirir        |
| Mac uygulaması               | uygulamayı değiştirir: aşağıya bakın                              |
| Homebrew, Volta, Nix         | reddeder: o araçla yükseltin                                      |
| tek seferlik `npx`           | reddeder: aşağıya bakın                                           |
| kaynak kod                   | reddeder: `git pull`, ardından `pnpm install && pnpm build`       |
| başka bir şey                | reddeder: kuran araçla yükseltin ya da `npm install -g` ile kurun |

Başarısız bir kurulum eski sürümü çalışır halde bırakır. `update` hiçbir zaman daha eski bir sürüme geçmez, kayıt defterindeki `latest` bir ön sürümü gösterse bile ön sürüme de geçmez.

**Mac uygulaması** kendini aynı sözle günceller: menü çubuğundaki Check for Updates ya da `appdyno update` ile. Siz istemedikçe güncelleme aranmaz. Her sürüm, appcast denen küçük bir dosya yayımlar. Bu dosya, açık yarısı uygulamanızda bulunan bir anahtarla imzalıdır ve uygulama başka hiçbir şeye inanmaz: dosyanın gösterdiği disk imajını indirir, hash'ini ve boyutunu denetler, uygulamanın yanına açar, kod imzasını, aynı imzacıdan gelen aynı program olduğunu ve imzalanan sürüm olduğunu denetler. İkisini ancak bundan sonra değiştirir. Bunlardan biri başarısız olursa uygulamanız olduğu gibi kalır, güncelleme anahtarı olmadan yapılmış bir derleme ise güncellemeyi hiç kabul etmez. Ardından uygulamayı yeniden açın.

**`npx -y appdyno mcp` çalıştıran bir istemci.** npx her açılışta kayıt defterine sorar ve yukarıdaki denetimlerin hiçbiri olmadan son sürüme kendiliğinden geçer. appdyno global olarak kuruluysa npx onun yerine o kurulumu çalıştırır. Bu yüzden bir kez `npm install -g appdyno` çalıştırın: istemcilerinizin çalıştırdığı sürüm artık yalnızca siz `appdyno update` çalıştırdığınızda değişir.

**Güncellemeden sonra.** Çalışan bir MCP sunucusu, istemcisi onu yeniden başlatana kadar eski kodla devam eder, bu yüzden istemciyi yeniden başlatın. Android agent ve iOS runner için bir şey gerekmez: ikisi de bir sonraki bağlantıda hash'lerine göre değişir. Yeni bir iOS runner içeren sürüm onu ilk kullanımda bir kez derler, bu birkaç dakika sürer.

## Bu Mac'teki istemciler

`appdyno install`, bu Mac'teki istemcileri bulur ve seçtiklerinize appdyno'yu ekler. Yalnızca o tek girdiyi değiştirir, dosyanın yanına yedek bırakır, `--dry-run` ile hiçbir şey yazmaz.

```sh
appdyno install --dry-run  # neyi değiştireceğini gösterir
appdyno install            # hangilerine ekleneceğini sorar; --yes hepsini seçer
```

Ardından istemciyi yeniden başlatın: çoğu listeyi yalnızca açılışta okur. `appdyno install --remove` girdiyi kaldırır.

Bulunamayan bir istemci klasörünü henüz oluşturmamıştır: bir kez açın ya da girdiyi aşağıdaki gibi elle ekleyin. Hepsi aynı komutu çalıştırır:

```json
{ "command": "npx", "args": ["-y", "appdyno", "mcp"] }
```

Seçenekler `args` dizisinin sonuna eklenir. Örneğin `"--device", "emulator-5554"` ya da `"--allow-apps", "com.example.app"`. Bkz. [Server options](../reference/cli.md#server-options).

### Hub'dan

Hub'ın kenar çubuğundaki **Telefon Bağla**, telefonu USB hata ayıklama ya da Güven adımlarından tek tek, telefonun söylediğine göre geçirir. Yalnızca elinizdeki telefonun gerektirdiğini sorar, bitince Yapay Zekâ İstemcileri'ni önerir. **Araçlar** bu sunucuyu tek seferde tüm istemcilere ekler: Tüm Yapay Zekâ İstemcilerine Ekle önce satırları gösterir.

Hub'ın kenar çubuğundaki **Yapay Zekâ İstemcileri**, buradaki her istemciyi gerçek durumuyla listeler:

| ne der                      | anlamı                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Bağlı, ne zaman olduğuyla   | burada gerçekten bir araç çağırdı. Bu sözü yalnızca bu kazandırır                         |
| Eklendi, yeniden başlatın   | girdisi yerinde, henüz çağrı gelmedi                                                      |
| Eklenmedi                   | bu Mac'te var, appdyno'ya ait bir şey yok                                                 |
| Ayar dosyası düzenlenemiyor | `install` okuyamadığı dosyaya dokunmaz, nedenini söyler                                   |
| Bu Mac'te Yok               | burada dosyası ya da klasörü yok: bir kez açın                                            |
| Tarayıcıda çalışır          | bu Mac'te eklenecek bir şey yok: bkz. [Tarayıcıdaki istemciler](#tarayıcıdaki-istemciler) |

**Ekle** ve **Kaldır**, `appdyno install` kodunu kullanır. Önce satırların tam hali görünür, ikinci tıklamaya kadar hiçbir şey yazılmaz. Yalnızca o girdi değişir, dosyanın yanında yedek kalır. **Geri Al** yalnızca o girdiyi, bayraklarıyla birlikte eski haline döndürür; yedeği geri yüklemez, çünkü istemci o arada dosyasını yazmış olabilir.

**Test Et**, istemcinin girdisinin çalıştırdığını çalıştırır, araç listesini ister, ne bulduğunu ve sırada ne yapılacağını söyler. Araç çağırmaz, bu yüzden cihaza dokunmaz ve Bağlı sözünü kazandırmaz. Dock'tan açılan istemci, Dock'un verdiği kısa `PATH` ile denenir.

Bunu nasıl bilir: sunucu her istemci için verdiği adı ve sürümü, stdio mu HTTP mi kullandığını ve son çağrısının zamanını `~/Library/Caches/appdyno/clients` altında tutar; gönderdiği hiçbir şeyi tutmaz. Listede olmayan bir istemci de çağırdığında kendi satırını alır. Adlar, çağrı yapılabilen yerlerde istemcinin kendi çağrısından okundu: bkz. [Neyle denendi](#neyle-denendi). Bir istemciyi kaldırmak çağrılarını da unutturur.

İstemcinin verdiği ad, bir cihazı yönetirken durum kapsülünde de görünür.

Kenar çubuğundaki **Yardım** ya da command-?, en son önde olan cihaz ve uygulamayla doldurulmuş, hedefe göre istemler sunar; her biri cihaza ne yaptığını söyler.

### Claude Code

1. `appdyno install` çalıştırın ya da elle ekleyin: `claude mcp add --scope user --transport stdio appdyno -- npx -y appdyno mcp`
2. Kontrol: `claude mcp list` çıktısında `appdyno: ... ✔ Connected` görünmeli. Oturum içinde `/mcp` yazın.
3. Deneyin: "cihazları listele" deyin.

`--scope user` sunucuyu bütün projelerde kullanılır yapar. Bu seçenek olmadan sunucu yalnızca bulunduğunuz klasöre eklenir.

### Claude Desktop

Masaüstü uygulamasındaki sohbet içindir. Claude Code'un listesini okumaz, Claude Code da bunu okumaz.

1. `appdyno install` çalıştırın. Elle yapmak için: Settings, Developer, Edit Config, `~/Library/Application Support/Claude/claude_desktop_config.json` dosyasını açar. Şunu ekleyip kaydedin:

   ```json
   {
     "mcpServers": {
       "appdyno": { "command": "npx", "args": ["-y", "appdyno", "mcp"] }
     }
   }
   ```

2. Uygulamadan tamamen çıkın (Cmd-Q) ve yeniden açın. Pencereyi kapatmak yetmez.
3. Kontrol: sohbet kutusunun altındaki +, sonra Connectors. appdyno araçlarıyla birlikte listelenir.

"spawn npx ENOENT" hatası alıyorsanız ya da sunucu bağlanmıyorsa ilk bakılacak yer burasıdır: bkz. [Uygulama npx'i veya adb'yi bulamıyor](#uygulama-npxi-veya-adbyi-bulamıyor). Burada bir çağrının süresi 3-4 dakika kadardır, bu yüzden iOS'ta ilk kullanımdan önce `appdyno ios build` çalıştırın.

### Codex ve ChatGPT masaüstü uygulaması

Codex komut satırı, editör eklentisi ve ChatGPT masaüstü uygulaması tek dosyayı paylaşır: `~/.codex/config.toml`. Yani tek girdi üçüne de ulaşır. appdyno Mac'inizde, yerel çalışan konuşmalarda çalışır.

1. `appdyno install` çalıştırın. Çıktıda `Codex and ChatGPT desktop` yazar. Elle yapmak için dosyaya şunu ekleyin:

   ```toml
   [mcp_servers.appdyno]
   command = "npx"
   args = ["-y", "appdyno", "mcp"]
   startup_timeout_sec = 120
   tool_timeout_sec = 1800
   ```

   Uygulamadan yapmak için: Settings, MCP servers, Add server, STDIO, sonra Restart. Ardından iki süreyi dosyaya ekleyin.

2. Kontrol: `codex mcp list` çıktısında `enabled` görünür. Oturumda ya da uygulamanın yazma kutusunda `/mcp` yazarak nelerin bağlı olduğunu görün.

Bu iki süre önemlidir. Varsayılanları 10 ve 60 saniyedir, oysa ilk çalıştırma ya da ilk derleme dakikalar sürer: istemci her seferinde vazgeçip baştan başlar. `appdyno install` bu değerleri yazar, sizin elle verdiklerinize dokunmaz.

### Cursor

1. `appdyno install` çalıştırın ya da girdiyi `~/.cursor/mcp.json` dosyasında `mcpServers` altına ekleyin.
2. Kontrol: Cursor'ın Output panelinde (Cmd-Shift-U) MCP Logs'u seçin.

### VS Code

1. `appdyno install` çalıştırın. Elle yapmak için komut paletinden "MCP: Open User Configuration" açıp şunu ekleyin. Burada anahtar `servers`, ayrıca `type` da gerekir:

   ```json
   {
     "servers": {
       "appdyno": { "type": "stdio", "command": "npx", "args": ["-y", "appdyno", "mcp"] }
     }
   }
   ```

2. Sunucuya güvenip güvenmediğinizi soran uyarıyı onaylayın.
3. Kontrol: Chat: Open Customizations, sonra MCP Servers.

### Devin Desktop (eski adıyla Windsurf)

1. `appdyno install` çalıştırın. Çıktıda `Windsurf` yazar. `~/.config/devin/mcp_config.json` dosyasına, sizde eskisi varsa `~/.codeium/windsurf/mcp_config.json` dosyasına yazar. Anahtar `mcpServers`.
2. Kontrol: Customize, MCPs, This computer.

### Antigravity

Antigravity, Haziran 2026'da Gemini CLI'ın yerini aldı.

1. `appdyno install` çalıştırın ya da girdiyi `~/.gemini/config/mcp_config.json` dosyasında `mcpServers` altına ekleyin.
2. Yeniden başlatın, sonra `/mcp` ile kontrol edin.

### Gemini CLI

1. `appdyno install` çalıştırın ya da `gemini mcp add -s user appdyno npx -y appdyno mcp` yazın. Girdi `~/.gemini/settings.json` dosyasında tutulur.
2. Kontrol: `gemini mcp list`. Güvenmediğiniz bir klasörde `Disabled` der: orada bir kez `gemini` başlatıp klasöre güvenin.

### Zed

1. `appdyno install` çalıştırın ya da `settings.json` dosyasına şunu ekleyin:

   ```json
   {
     "context_servers": {
       "appdyno": { "command": "npx", "args": ["-y", "appdyno", "mcp"], "env": {} }
     }
   }
   ```

2. Kontrol: Settings, AI, MCP Servers. appdyno'nun yanındaki nokta yeşile döner.

### opencode

1. `appdyno install` çalıştırın ya da `~/.config/opencode/opencode.json` dosyasına şunu ekleyin:

   ```json
   {
     "mcp": {
       "appdyno": { "type": "local", "command": ["npx", "-y", "appdyno", "mcp"], "enabled": true }
     }
   }
   ```

2. Kontrol: `opencode mcp list` çıktısında `connected` yazar.

### Cline

1. Komut satırı için `appdyno install` çalıştırın, `~/.cline/data/settings/cline_mcp_settings.json` dosyasına yazar. Editör eklentisinde: MCP Servers simgesi, Configure, Configure MCP Servers, sonra girdiyi `mcpServers` altına ekleyin.
2. Kontrol: `cline config mcp`.

### Başka bir istemci

Ayarlarında "MCP" kelimesini arayın. Bir komut istiyorsa yukarıdakini verin. Çoğu şu biçimi kabul eder, birkaçı `mcpServers` yerine başka bir kelime kullanır:

```json
{
  "mcpServers": {
    "appdyno": { "command": "npx", "args": ["-y", "appdyno", "mcp"] }
  }
}
```

## Tarayıcıdaki istemciler

Bunlar üreticisinin bulutunda çalışır. Mac'inizde bir program başlatamaz, `127.0.0.1` adresini de göremezler. appdyno'ya ulaşmaları için bir giriş kapısı gerekir ve appdyno bunu kendiliğinden açmaz: arada bize ait bir servis yoktur, tüneli siz çalıştırır, siz kapatırsınız.

**Önce bunu okuyun. Adresi ve token'ı bilen herkes cihazlarınızı kullanabilir.** Yalnızca tek bir uygulamayı değil: ekranda görünen her şeyi okuyabilir, yazı yazabilir, uygulama kurup kaldırabilir, bağlantı açabilir, ayarları değiştirebilir ve bir aracın yol aldığı yerlerde bu Mac'te dosya okuyup yazabilir (`record`, `report`, `visual`, `flow`, `app install`). Araçların döndürdüğünü istemcinin üreticisi de görür, yani ekranı gördüğünü varsayın.

Tünel açmadan önce:

- Test cihazı ve test hesapları kullanın, cihazda gerçek bir veri olmasın.
- Sunucuyu sınırlayın: `--allow-devices`, `--allow-apps`, `--allow-urls`.
- İşiniz bitince tüneli kapatın.
- Adres ya da token dışarı sızdıysa sunucuyu durdurun ve yeni bir token ile başlatın.

### HTTP sunucusu

Hub bunların hepsini Yapay Zekâ İstemcileri'nde, Tarayıcıda bölümünde yapar. Sunucuyu Başlat aynı komutu kendi sürecinde, 8765 bağlantı noktasından ya da sonraki boş olandan çalıştırır ve adresi söyler. Token siz istemedikçe gizli kalır, sunucuya ortam değişkeniyle gider ve durum klasöründe 0600 izniyle saklanır, böylece kayıtlı bir bağlayıcı çalışmaya devam eder. Yeni Token, dışarı sızan token'ın yerine yenisini koyar. Sunucu, hub nasıl kapanırsa kapansın onunla birlikte kapanır.

Elle, `appdyno mcp --http` aynı araçları MCP'nin Streamable HTTP taşıması üzerinden sunar. Siz istemedikçe kapalıdır ve yalnızca bu Mac'te dinler:

```sh
export APPDYNO_HTTP_TOKEN=$(openssl rand -hex 32)
appdyno mcp --http 127.0.0.1:8765 --allow-devices '^EXAMPLE0SERIAL$'
```

Adresi ve neyin gönderileceğini yazdırır. `APPDYNO_HTTP_TOKEN` yoksa kendisi üretip yazdırır, bir sonraki başlatmada başkasını üretir ve kayıtlı bağlayıcı artık eşleşmez. Kendi token'ınızı parola yöneticisinde saklayın. Token için bir seçenek yok, çünkü komut satırı seçeneği `ps` çıktısında görünürdü.

Token iki yolla gönderilebilir, istemci hangisini kullanabiliyorsa onu kullanır:

- başlık olarak: `http://127.0.0.1:8765/mcp` adresine `Authorization: Bearer <token>`
- adresin içinde: `http://127.0.0.1:8765/mcp/<token>`, başlık için alanı olmayan istemciler için

Token'ın adreste durması daha zayıftır: tünelin kayıtlarına ve istemcinin kayıtlı ayarlarına geçer. ChatGPT ve Claude hesaplarının çoğu başka yol bırakmıyor.

Tünelden önce bir kontrol:

```sh
curl -i -X POST http://127.0.0.1:8765/mcp      # 401: sunucu orada ve token istiyor
npx @modelcontextprotocol/inspector --cli "http://127.0.0.1:8765/mcp/$APPDYNO_HTTP_TOKEN" \
  --transport http --method tools/list          # araçları listeler
```

Sonra `http://127.0.0.1:8765` adresine bir tünel açın; örneğin adlandırılmış bir Cloudflare Tunnel, `ngrok http 8765` ya da `tailscale funnel 8765`. Size verdiği HTTPS adresini kullanın. `cloudflared` hızlı tüneli akış halindeki yanıtları tutar, adlandırılmış tünel kullanın.

**Aynı anda tek istemci.** Bir istemci araç çağırdığı andan itibaren sunucuyu tutar, son çağrısından 10 dakika sonrasına kadar. Başka bir istemci, önce bağlanmış olsa bile çağrısında, sunucuyu tutanın adını söyleyen 409 ile reddedilir. Yalnızca araçları listelemiş bir istemci hiçbir şey tutmaz, yani sağlık kontrolü kimseyi engellemez. 10 dakika dolunca ya da sunucuyu durdurunca, cihazda değiştirdiği her şey eski haline döner; bu Mac'teki bir istemci kapandığında olduğu gibi. Bağlam istemci başına değil, tektir: aynı istemcinin ikinci penceresi onu paylaşır. İki istemciyle iki cihaz kullanmak için iki portta iki sunucu çalıştırın.

Bir çağrı sürerken bağlantı koparsa, çağrı cihazda da durur.

### Tarayıcıda ChatGPT

Tarayıcıdaki ChatGPT yalnızca uzak sunuculara ulaşır. Plugins altından bağlanır ve token gönderemez: formu OAuth, No authentication ya da ikisini birden sunar.

| plan            | ne elde edersiniz                                                                                                                                                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business        | her şey. Sunucuyu yalnızca yönetici ya da sahip ekleyebilir                                                                                                                                                                                                                                                      |
| Enterprise, Edu | her şey. Kimin ekleyebileceğine yönetici karar verir                                                                                                                                                                                                                                                             |
| Pro             | yalnızca salt okunur işaretli araçlar: `screen`, `find`, `screenshot`, `wait_for`, `assert`, `logs`, `crashes`, `audit`, `device_info`, `list_devices`, `visual` ve okuma yapan `perf_` araçları. `tap` yok, yazı yazma yok, `use_device` de yok: sunucuyu `--device` ile ya da tek cihaza izin vererek başlatın |
| Plus, Free      | OpenAI'ın sayfaları bir şey söylemiyor. Yokmuş gibi düşünün ve masaüstü uygulamasını kullanın                                                                                                                                                                                                                    |

Masaüstü uygulamasında bunların hiçbiri yoktur: appdyno'yu Mac'inizde çalıştırır. Mümkünse [onu kullanın](#codex-ve-chatgpt-masaüstü-uygulaması).

**Önerdiğimiz yol: OpenAI'ın Secure MCP Tunnel'ı.** Port açmaz, herkese açık bir adres istemez ve appdyno'yu stdio üzerinden taşır, yani HTTP sunucusu devreye girmez. Bir OpenAI Platform organizasyonu gerekir, kişisel ya da şirketin olabilir.

1. [Platform tünel ayarlarında](https://platform.openai.com/settings/organization/tunnels) bir tünel oluşturun, `tunnel_id` değerini not edin. Bir runtime API anahtarı oluşturun. Tüneli ChatGPT çalışma alanınıza bağlayın, yoksa orada görünmez.
2. Mac'inizde:

   ```sh
   brew install openai/tools/tunnel-client
   export CONTROL_PLANE_API_KEY="sk-..."
   tunnel-client init --sample sample_mcp_stdio_local --profile local-stdio \
     --tunnel-id tunnel_0123456789abcdef0123456789abcdef \
     --mcp-command "npx -y appdyno mcp --allow-devices '^EXAMPLE0SERIAL$'"
   tunnel-client doctor --profile local-stdio --explain
   tunnel-client run --profile local-stdio
   ```

3. Çalışır halde bırakın. [ChatGPT Plugins](https://chatgpt.com/plugins) sayfasında: + düğmesi, Add custom MCP server, bir ad, Connection: Tunnel, tüneliniz, Authentication: No authentication. Uyarıyı kabul edin, sonra Create as a plugin.
4. Eklentiyi kurun. Yeni bir konuşmada `@` yazın, appdyno'yu seçin ve cihazları listelemesini isteyin.

Her isteğin **120 saniyesi vardır, ne kadar ilerleme bildirirse bildirsin**, boyut sınırı da 10 MiB'dir. Uzun ölçümler ve ilk derleme buna sığmaz: önce `appdyno ios build` çalıştırın.

**Kendi tünelinizle.** [HTTP sunucusunu](#http-sunucusu) ve bir tüneli başlatın, sonra özel sunucuyu Server URL olarak `https://<tüneliniz>/mcp/<token>` ve No authentication ile ekleyin. Bu adrese sahip olan herkes içeridedir, onu parola gibi saklayın.

ChatGPT her yazma işleminde varsayılan olarak onay ister. Bir telefonun araçları için bunu değiştirmek sizin kararınızdır. Bir kullanıcı bildirimine göre bir aracın görselini boş gösteriyor: `screenshot` boş dönerse `screen` kullanın.

### Tarayıcıda Claude

Bu bölüm Claude'un web, telefon ve Cowork sürümlerini ve masaüstü uygulamasındaki bağlayıcıları kapsar. Özel bağlayıcılar her planda vardır (Free'de bir tane), ancak Claude cihazınızdan değil kendi bulutundan bağlanır. Yani sunucunun internetten erişilebilir olması gerekir, bunu da sizin tüneliniz sağlar. `claude_desktop_config.json` gibi yerel dosyalar burada geçmez. [Masaüstü uygulaması](#claude-desktop) appdyno'yu Mac'inizde tünelsiz çalıştırır: mümkünse onu kullanın.

1. [HTTP sunucusunu](#http-sunucusu) ve bir tüneli başlatın.
2. Customize, Connectors, +, Add custom connector.
3. Bir ad ve `https://<tüneliniz>/mcp/<token>` adresini girin.
4. Authentication: **No sign-in**. Ekleyin.
5. Sohbette: +, Connectors, açın ve cihazları listelemesini isteyin.

Team ve Enterprise'da bağlayıcıyı bir Owner, Organization settings, Connectors altından ekler.

Claude'un sayfaları bir konuda çelişiyor. Yardım makalesi sabit token için bir **Request headers** alanı gösteriyor, geliştirici sayfaları ise bu alanın yalnızca sınırlı sayıda kuruluşa açık bir beta olduğunu söylüyor. Bu alanı görüyorsanız düz `https://<tüneliniz>/mcp` adresini ve `Authorization: Bearer <token>` başlığını kullanın, böylece token adreste durmaz.

Bir araç çağrısının yaklaşık 240 saniyesi, bir yanıtın yaklaşık 150.000 karakteri vardır. Claude'un kendi MCP tünelleri, sunucuda OAuth isteyen bir Enterprise önizlemesidir, dolayısıyla appdyno için bir yol değildir.

## Android telefon veya emülatör

Android cihazlarla konuşan `adb` aracı gerekir.

1. Kurun. Ya [Android Studio](https://developer.android.com/studio), appdyno'nun baktığı yere kurar, ya da `brew install --cask android-platform-tools`.
2. Telefonda geliştirici seçeneklerini açın: Ayarlar, Telefon hakkında, **Derleme numarası**na (bazı telefonlarda Yapım numarası) yedi kez dokunun. Xiaomi'de bu **OS sürümü**dür.
3. Ayarlar, Geliştirici seçenekleri altında **USB hata ayıklama**yı açın. Xiaomi'de **USB ile yükle** ve **USB hata ayıklama (Güvenlik ayarları)** da açılmalı.
4. Kabloyu takın. Telefonun kilidini açın, sorduğu soruya **İzin ver** deyin.
5. Kontrol: `adb devices` telefonu `device` olarak listeler. `unauthorized`, sorunun yanıtlanmadığı anlamına gelir: telefona bakın. Liste boşsa kablo büyük olasılıkla yalnızca şarj kablosudur.
6. Bir kontrol daha: `appdyno doctor --serial <seri>`.

Telefon yok mu? Android Studio'nun Device Manager'ında sanal bir cihaz oluşturup başlatın. `adb devices` onu `emulator-5554` olarak listeler.

appdyno ilk kullanımda cihaza kendi ajanını kurar. Xiaomi her yeni kurulumda ekranda sorar, appdyno da yalnızca kendi başlattığı kurulumda bu tek soruyu yanıtlar. Bkz. [Reaching a phone](../reference/tools.md#reaching-a-phone).

## iPhone veya simülatör

App Store'dan [Xcode](https://apps.apple.com/app/xcode/id497799835) kurun, bir kez açıp sorduklarını onaylayın. Bulunduğunu görmek için `appdyno doctor` çalıştırın.

**Simülatör için başka bir şey gerekmez**: ne hesap ne imzalama. Xcode'un Simulator uygulamasıyla açın ya da istemcinizden başlatmasını isteyin. appdyno'nun yardımcısını gerektiren ilk işlem onu derler, bu birkaç dakika sürer. Bunu önceden yapmak için:

```sh
appdyno ios build
```

**iPhone** biraz daha fazlasını ister, çünkü telefon yalnızca o telefon için imzalanmış kodu çalıştırır.

1. Kabloyla bağlayın, kilidi açın, sorduğu soruya **Güven** deyin.
2. Xcode'da: Settings, Accounts, +, Apple kimliğinizle giriş yapın.
3. Telefonda: Ayarlar, Gizlilik ve Güvenlik, **Geliştirici Modu**, açın. Telefon yeniden başlar ve onay ister. Bu anahtar, telefon Xcode ile tanıştıktan sonra görünür.
4. Telefonun kimliğini bulun: `xcrun devicectl list devices` ya da Xcode'da Window, Devices and Simulators.
5. Aşağıdaki yollardan biriyle imzalayın.
6. Kontrol: `appdyno doctor` telefonu uyarısız listeler. `no signing for the iPhone runner` derse okumaya devam edin.
7. `appdyno ios build` çalıştırın, sonra istemcinizden ekranı okumasını isteyin. İlk seferde telefonun kilidi açık kalsın. Geliştiriciye güvenilmediğini söylerse: Ayarlar, Genel, VPN ve Aygıt Yönetimi, güvenin.

### İmzalama ne demek

appdyno telefona küçük bir test uygulaması, yani runner yükler. iOS onu ancak Apple'dan gelen iki şeyle çalıştırır:

- **kimlik**: geliştirme sertifikanız ve giriş anahtarlığındaki özel anahtarı
- **provisioning profile**: kimliği, bu telefonu ve uygulama kimliğini adıyla yazan bir dosya

Bunlar kuruluysa appdyno kendisi bulur. Hesabınızda hiçbir şey oluşturmaz; tek istisna, aşağıdaki ikinci yolda bunu sizin istemenizdir.

### Ücretli Apple Developer hesabıyla, wildcard profil

Kendiliğinden bulunan yol budur ve başka bir şey gerektirmez.

1. Xcode, Settings, Accounts, ekibiniz, Manage Certificates, +, **Apple Development**.
2. [developer.apple.com](https://developer.apple.com/account/resources/devices/list) adresinde Devices altına telefonun kimliğini ekleyin.
3. Identifiers altına **Wildcard** türünde, `*` değerli bir App ID ekleyin.
4. Profiles altına **iOS App Development** ekleyin, wildcard kimliği, sertifikanızı ve telefonu seçin. İndirip çift tıklayın.
5. Kontrol: `appdyno doctor`.

### Xcode halletsin

appdyno'ya ekibinizin kimliğini verin, runner'ı hazırlaması için Xcode'dan bir kez istesin:

```sh
export APPDYNO_IOS_TEAM=ABCDE12345
```

Kimlik 10 karakterdir, Apple Developer hesabınızda Membership altındadır. appdyno'yu başlatan istemci, kabuğunuzun değişkenlerini görmez: bunu girdinin `env` alanına ekleyin.

Ücretsiz Apple kimliği wildcard profil oluşturamaz, yani çalışabilecek tek yol budur ve profili bir yıl değil birkaç gün yaşar. Bu denenmedi.

### Profili kendiniz belirtmek

Derleme makinesi ya da birden çok profil olan bir Mac için:

```sh
export APPDYNO_IOS_PROFILE=/yol/runner.mobileprovision
export APPDYNO_IOS_KEYCHAIN=/yol/build.keychain-db
export APPDYNO_IOS_KEYCHAIN_PASSWORD=...
```

## Çalışmıyorsa

### Uygulama npx'i veya adb'yi bulamıyor

Dock'tan açılan bir uygulama kabuğunuzun ayarlarını okumaz. Kısa bir `PATH` ile çalışır, burada ne Homebrew ne de nvm veya mise ile kurulmuş Node bulunur. Sonuç: `spawn npx ENOENT`, bağlanmayan bir sunucu ya da `adb: not found`.

Terminalde nerede olduklarına bakın:

```sh
command -v npx node adb
```

Sonra girdiye `npx` için tam yolu ve `node` ile `adb`'yi de içeren bir `PATH` yazın. Yalnızca tam yol yetmez, çünkü `npx`'in kendisi de `node`'u bulmak zorundadır:

```json
{
  "mcpServers": {
    "appdyno": {
      "command": "/opt/homebrew/bin/npx",
      "args": ["-y", "appdyno", "mcp"],
      "env": { "PATH": "/opt/homebrew/bin:/usr/bin:/bin" }
    }
  }
}
```

`ANDROID_HOME`, `APPDYNO_IOS_TEAM` ve diğerleri de aynı şekilde `env` altına yazılır. Sonra uygulamayı tamamen yeniden başlatın. `appdyno install` bu eklemelere dokunmaz.

### Diğer durumlar

| gördüğünüz                                                | anlamı ve yapılacak                                                                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm error 404 ... appdyno`                               | appdyno henüz npm'de yok ve burada kurulu değil: `sh scripts/install.sh` çalıştırın                                                      |
| istemci araç göstermiyor, hata da vermiyor                | yeniden başlatın, çoğu listeyi bir kez okur. Sonra kayıtlarına bakın ve `appdyno doctor` çalıştırın                                      |
| `no connected device this server may drive`               | `adb devices` ya da Xcode cihaz görmüyor, veya `--allow-devices` onu dışarıda bırakıyor                                                  |
| `more than one device: pick one with use_device`          | istemcinize hangi cihazı kullanacağını söyleyin ya da girdiye `--device` ekleyin                                                         |
| `is held by pid ...`                                      | o cihazı başka bir program kullanıyor. Durdurun ya da `--share` kullanın                                                                 |
| `no signing for the iPhone runner`                        | bkz. [iPhone veya simülatör](#iphone-veya-simülatör)                                                                                     |
| `DEVICE_LOCKED`                                           | telefonun kilidini açın                                                                                                                  |
| iOS'ta ilk çağrı hata veriyor ya da zaman aşımına uğruyor | runner hâlâ derleniyor, istemci vazgeçti: `appdyno ios build` çalıştırıp yeniden deneyin                                                 |
| Codex'te çağrı 60 saniyede kesiliyor                      | [girdiye](#codex-ve-chatgpt-masaüstü-uygulaması) `tool_timeout_sec` ekleyin                                                              |
| ChatGPT'de çağrı 120 saniyede kesiliyor                   | Secure MCP Tunnel'ın sınırı, artırılamaz: daha kısa bir işlem seçin ya da masaüstü uygulamasını kullanın                                 |
| Claude'da çağrı 4 dakika civarında kesiliyor              | barındırılan sürümün sınırı. Daha kısa bir işlem seçin ya da Claude Code kullanın                                                        |
| HTTP sunucusunda `401`                                    | token yok ya da yanlış. Token gönderemeyen istemcide token adreste olmalı                                                                |
| `403 requests from ... are not accepted`                  | bir web sayfası ya da bu sunucuya ait olmayan `Origin` başlığı gönderen bir istemci. Değeri sunucunun kaydında yazar                     |
| `409 this server serves one client at a time`             | iletide adı geçen başka bir istemci tutuyor. Son çağrısından 10 dakika bekleyin ya da sunucuyu yeniden başlatın                          |
| `address already in use`                                  | port dolu: başka bir port seçin                                                                                                          |
| bağlayıcı eklenmiyor ya da araç görmüyor                  | `curl -i -X POST https://<tüneliniz>/mcp` 401 vermeli. Başka bir yanıt, tünelin sunucuya ulaşmadığını gösterir                           |
| bağlayıcı çalışıyordu, artık çalışmıyor                   | sunucu üretilmiş bir token ile yeniden başladı ya da tünelin adresi değişti. `APPDYNO_HTTP_TOKEN` saklayın, adlandırılmış tünel kullanın |

## Neyle denendi

macOS'ta, geçici bir ev klasörüyle, paketinden derlenip kurulan sürümle, bütün cihazlar `--allow-devices` ile dışarıda bırakılarak, 4 Kasım 2026'da:

| denenen                                      | sonuç                                                     |
| -------------------------------------------- | --------------------------------------------------------- |
| listedeki her istemci için `appdyno install` | her dosya yazıldı; ikinci kez: hepsi "already right"      |
| Claude Code 2.1.318, stdio ve HTTP           | bağlandı; yanlış token ve ikinci istemci reddedildi       |
| Gemini CLI 0.66.0, opencode 1.19.5           | kendi `mcp list` komutlarıyla bağlandı                    |
| Codex CLI 0.166.0, Cline CLI 3.0.74          | dosyasını okuyup appdyno'yu listeledi; bağlantı kurulmadı |
| MCP Inspector komut satırı, token adreste    | araçları listeledi, birini çağırdı                        |

Yapay Zekâ İstemcileri'nin bir istemcinin çağırdığını bilmesini sağlayan `clientInfo` adı, Claude Code 2.1.318 için istemcinin kendi çağrısından okundu: `claude-code`. Diğer istemciler için `packages/cli/src/clients.ts` içindeki kalıp, gönderdiği bilinen addan gelir ve burada görülmedi. Biri yanlışsa o istemci verdiği adla kendi satırında görünür, başkasının yerine asla Bağlı denmez.

Hesap, lisans ya da pencere gerektirdiği için denenmeyenler: ChatGPT uygulaması ve web sürümü, Claude Desktop ve web'deki Claude, Secure MCP Tunnel, herkese açık herhangi bir tünel, Codex'ten bağlantı, Cursor, VS Code, Devin Desktop, Antigravity ve Zed. Buradaki adımlar kendi belgelerinden alındı. Ücretsiz Apple kimliğiyle imzalama da denenmedi.
