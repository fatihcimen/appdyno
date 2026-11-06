# Connecting a client

[Türkçe](clients.tr.md)

appdyno runs on your Mac, beside the phone or simulator it drives. A client is the app you talk to. This page says how to join the two, client by client, and how to get a phone ready from nothing. What each client offers was read from its own documentation on 2026-11-04. They change often, so if a menu has moved, trust the client's page.

Most clients run appdyno themselves on your Mac, which needs no network at all. A client that lives in a browser cannot start anything on your Mac, and that is the hard case.

| client                                      | how it reaches appdyno                         | start at                                      |
| ------------------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| Claude Code, Claude Desktop                 | runs it on your Mac                            | [Clients on this Mac](#clients-on-this-mac)   |
| Codex, the ChatGPT desktop app              | runs it on your Mac                            | [Clients on this Mac](#clients-on-this-mac)   |
| Cursor, VS Code, Devin Desktop, Antigravity | runs it on your Mac                            | [Clients on this Mac](#clients-on-this-mac)   |
| Gemini CLI, Zed, opencode, Cline            | runs it on your Mac                            | [Clients on this Mac](#clients-on-this-mac)   |
| ChatGPT in a browser                        | a tunnel you run, on Business, Enterprise, Edu | [ChatGPT in a browser](#chatgpt-in-a-browser) |
| Claude in a browser, on a phone, in Cowork  | a tunnel you run                               | [Claude in a browser](#claude-in-a-browser)   |

Then get your device ready: [Android](#an-android-phone-or-emulator), [iPhone or simulator](#an-iphone-or-a-simulator). If something fails, see [When it does not work](#when-it-does-not-work).

## Install appdyno

The Mac app is for most people, and needs no terminal. The npm package is for CI and for developers. Both run the same code.

### The Mac app

You need a Mac with Apple silicon and macOS 13.5 or newer. You do not need Node, Xcode or a terminal: the app carries its own Node, the Android agent and its window.

There is no release yet. Until there is one, a checkout builds the same app: `pnpm build && node scripts/build-app.mjs` leaves it in `.app-build`.

1. Download `Appdyno-<version>-arm64.dmg` from the [releases](https://github.com/fatihcimen/appdyno/releases) and open it.
2. Drag Appdyno to Applications.
3. Open Appdyno. The hub opens, and an icon stays in the menu bar with your devices. The Dock shows Appdyno only while a window is open.

**The first open.** A build without a Developer ID is signed ad hoc, and macOS will not open it with a double click. On macOS 15 and later it says it could not verify the app: click Done, then open System Settings, Privacy & Security, scroll down, click Open Anyway and enter your password. On macOS 13 and 14, Control-click the app, choose Open, and confirm. Either is asked once. A build notarized by Apple only asks whether to open an app from the internet.

**Android** needs adb, which the app does not carry: Google's terms keep it out, and it holds LGPL code. In the menu bar, Get adb for Android downloads Google's own platform-tools, 16 MB, and checks them against a pinned hash, once you accept Google's terms. If Android Studio or `ANDROID_HOME` already gives you adb, the app uses that, and the item does not appear.

**In the menu bar**, Put appdyno on the PATH makes `appdyno` work in every terminal, with a link at `/usr/local/bin/appdyno`, and macOS may ask for your password. Add to MCP Clients shows what it would change and does what `appdyno install` does. If you move the app, your clients and the link follow it the next time you open it.

**With Homebrew.** A release carries a cask, `appdyno.rb`. Copy it into a tap of your own:

```sh
brew tap-new you/tools
cp appdyno.rb "$(brew --repository you/tools)/Casks/"
brew install --cask you/tools/appdyno
```

### The npm package

You need a Mac and Node 22 or newer. Check with `node --version`; if it says "command not found", install the LTS from [nodejs.org](https://nodejs.org/).

appdyno is not on the npm registry yet. Until it is, build it from a checkout, which also needs pnpm and a JDK 21:

```sh
sh scripts/install.sh      # builds this checkout and installs the appdyno command
appdyno doctor             # says what is here and what is missing
```

Once it is published, you will not need a checkout, and `npx -y appdyno install` does the next step directly.

## Keep appdyno current

`appdyno update` is the one way to move to a newer release. Nothing looks for one in the background, as a look is a network call and appdyno has no telemetry.

```sh
appdyno update --check     # what is installed, what is latest, what would happen; changes nothing
appdyno update             # verifies the latest release, then upgrades to it
```

It verifies before anything on your Mac changes, and there is no flag to skip this. The exact version goes into a temporary folder with none of its scripts run, and `npm audit signatures` checks it there. npm must have verified a provenance attestation for that release itself, not only for a dependency, and the attestation must say the release was built from appdyno's own repository. Otherwise the release is refused, with a code and a hint, and your version stays.

This takes npm 11.12 or newer, even if pnpm installed appdyno, because older versions do not say which package they verified. Node 22 comes with an older one, so run `npm install -g npm@latest` first.

It then upgrades with whatever installed appdyno. `appdyno doctor` shows which, with the version and the folder.

| installed with               | `appdyno update`                                                                |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `npm install -g`, any prefix | upgrades with npm, in that prefix, from the copy it just verified               |
| `pnpm add -g`                | upgrades with pnpm, to that exact version, which pnpm downloads again itself    |
| the Mac app                  | replaces the app: see below                                                     |
| Homebrew, Volta, Nix         | refuses: upgrade it with that manager                                           |
| a one-off `npx`              | refuses: see below                                                              |
| a source checkout            | refuses: `git pull`, then `pnpm install && pnpm build`                          |
| anything else                | refuses: upgrade it with what installed it, or install it with `npm install -g` |

A failed install leaves the old version working. `update` never moves to an older version, and never to a prerelease, even when the registry's `latest` points at one.

**The Mac app** updates itself by the same promise, with Check for Updates in the menu bar, or `appdyno update`. Nothing looks for an update unless you ask. A release publishes a small file, its appcast, signed with a key whose public half is in your app. The app believes nothing else: it downloads the disk image that file names, checks its hash and size, unpacks it beside the app, and checks its code signature, that it is the same program from the same signer, and that it is the version signed. Only then does it swap the two. If any of this fails, your app stays as it was, and a build made with no update key refuses to update at all. Open the app again afterwards.

**A client that runs `npx -y appdyno mcp`.** npx asks the registry at each start and moves to the latest release by itself, with none of the checks above. If appdyno is installed globally, npx runs that install instead. So run `npm install -g appdyno` once: what your clients run then changes only when you run `appdyno update`.

**After an update.** A running MCP server keeps the old code until its client restarts it, so restart the client. The Android agent and the iOS runner need nothing: each is replaced by its hash at the next connection, and a release with a new iOS runner builds it once on first use, which takes a few minutes.

## Clients on this Mac

`appdyno install` finds the clients on this Mac and adds appdyno to the ones you pick. It changes that one entry, keeps a backup beside the file, and writes nothing with `--dry-run`.

```sh
appdyno install --dry-run  # shows what it would change
appdyno install            # asks which; --yes takes all of them
```

Restart the client after this: most read their list only when they start. `appdyno install --remove` takes the entry out.

A client that is not found has not created its folder yet: open it once, or add the entry by hand as below. Every one of them runs the same thing:

```json
{ "command": "npx", "args": ["-y", "appdyno", "mcp"] }
```

Flags go at the end of `args`. For example `"--device", "emulator-5554"`, or `"--allow-apps", "com.example.app"`. See [Server options](../reference/cli.md#server-options).

### From the hub

**Connect a Phone** in the hub's sidebar takes a phone through USB debugging or Trust, one step at a time, by what the phone itself says. It asks only what the phone in your hand needs, and offers AI Clients when it is done. **Tools** adds this server to every client at once: Add to All AI Clients shows the lines first.

**AI Clients** in the hub's sidebar lists every client here, each as it truly stands:

| it says                   | what that means                                                               |
| ------------------------- | ----------------------------------------------------------------------------- |
| Connected, with when      | it has really called a tool here. Only that earns the word                    |
| Added, restart it         | its entry is there and no call has come yet                                   |
| Not added                 | it is on this Mac, with nothing of appdyno's                                  |
| Its file cannot be edited | `install` will not touch a file it cannot read, and says why                  |
| Not on This Mac           | it has no file or folder here: open it once                                   |
| Runs in a browser         | nothing to add on this Mac: see [Clients in a browser](#clients-in-a-browser) |

**Add** and **Remove** go by the code of `appdyno install`. The exact lines show first, and nothing is written until the second click. Only that entry changes, and a backup stays beside the file. **Undo** takes that one entry back, flags and all, and does not restore the backup, as a client may have written its file since.

**Test** runs what the client's entry runs, as far as asking for its list of tools, and says what it found and what to do next. It calls no tool, so it touches no device and earns no Connected. A client opened from the Dock is tried with the short `PATH` the Dock gives it.

How it knows: the server keeps, for each client, the name and version it gave, whether it came over stdio or HTTP, and the time of its last call, in `~/Library/Caches/appdyno/clients`, and nothing it sent. A client that is not in this list still gets a row of its own once it has called. The names were read from each client's own call where one could be made: see [What this was tried on](#what-this-was-tried-on). Taking a client out forgets its calls.

The name a client gave is also what the status capsule says while it drives a device.

**Help** in the sidebar, or command-?, has prompts by goal, filled with the device and app you last had in front, each saying what it does to the device.

### Claude Code

1. Run `appdyno install`, or by hand: `claude mcp add --scope user --transport stdio appdyno -- npx -y appdyno mcp`
2. Check: `claude mcp list` should say `appdyno: ... ✔ Connected`. Inside a session, `/mcp`.
3. Try it: ask "list the devices".

`--scope user` makes it available in every project. Without it the server is added to the current folder only.

### Claude Desktop

For the chat in the desktop app. It does not read Claude Code's list, or the other way round.

1. Run `appdyno install`. By hand: Settings, Developer, Edit Config opens `~/Library/Application Support/Claude/claude_desktop_config.json`. Add this and save:

   ```json
   {
     "mcpServers": {
       "appdyno": { "command": "npx", "args": ["-y", "appdyno", "mcp"] }
     }
   }
   ```

2. Quit the app completely (Cmd-Q) and open it again. Closing the window is not enough.
3. Check: the + at the bottom of the chat box, then Connectors. appdyno is listed with its tools.

This is the first place to look if it fails with "spawn npx ENOENT" or a server that stays disconnected: see [An app cannot find npx or adb](#an-app-cannot-find-npx-or-adb). The vendor gives a call about 3 to 4 minutes here, so run `appdyno ios build` before a first iOS use.

### Codex and the ChatGPT desktop app

The Codex command line, its editor extension and the ChatGPT desktop app share one file, `~/.codex/config.toml`, so one entry reaches all three. appdyno runs on your Mac, in threads that run locally.

1. Run `appdyno install`. It says `Codex and ChatGPT desktop`. By hand, add this to the file:

   ```toml
   [mcp_servers.appdyno]
   command = "npx"
   args = ["-y", "appdyno", "mcp"]
   startup_timeout_sec = 120
   tool_timeout_sec = 1800
   ```

   In the app: Settings, MCP servers, Add server, STDIO, then Restart. Add the two timeouts to the file afterwards.

2. Check: `codex mcp list` shows it as `enabled`. In a session, or in the app's composer, type `/mcp` to see what is connected.

The two times matter. Their defaults are 10 and 60 seconds, and a first run or a first runner build takes minutes: the client would give up and start over each time. `appdyno install` sets them and keeps any you set yourself.

### Cursor

1. Run `appdyno install`, or add the entry under `mcpServers` in `~/.cursor/mcp.json`.
2. Check: in Cursor's Output panel (Cmd-Shift-U), choose MCP Logs.

### VS Code

1. Run `appdyno install`. By hand, run "MCP: Open User Configuration" from the command palette and add this. Note the key is `servers` here, and it needs `type`:

   ```json
   {
     "servers": {
       "appdyno": { "type": "stdio", "command": "npx", "args": ["-y", "appdyno", "mcp"] }
     }
   }
   ```

2. Accept the prompt that asks whether you trust the server.
3. Check: Chat: Open Customizations, then MCP Servers.

### Devin Desktop, formerly Windsurf

1. Run `appdyno install`. It says `Windsurf`, and writes `~/.config/devin/mcp_config.json`, or the older `~/.codeium/windsurf/mcp_config.json` if that is the one you have. The key is `mcpServers`.
2. Check: Customize, MCPs, This computer.

### Antigravity

Antigravity replaced Gemini CLI in June 2026.

1. Run `appdyno install`, or add the entry under `mcpServers` in `~/.gemini/config/mcp_config.json`.
2. Restart it, then check with `/mcp`.

### Gemini CLI

1. Run `appdyno install`, or `gemini mcp add -s user appdyno npx -y appdyno mcp`. It keeps the entry in `~/.gemini/settings.json`.
2. Check: `gemini mcp list`. In a folder you have not trusted it says `Disabled`: start `gemini` there once and trust it.

### Zed

1. Run `appdyno install`, or add this to `settings.json`:

   ```json
   {
     "context_servers": {
       "appdyno": { "command": "npx", "args": ["-y", "appdyno", "mcp"], "env": {} }
     }
   }
   ```

2. Check: Settings, AI, MCP Servers. The dot beside appdyno turns green.

### opencode

1. Run `appdyno install`, or add this to `~/.config/opencode/opencode.json`:

   ```json
   {
     "mcp": {
       "appdyno": { "type": "local", "command": ["npx", "-y", "appdyno", "mcp"], "enabled": true }
     }
   }
   ```

2. Check: `opencode mcp list` says `connected`.

### Cline

1. For the command line, run `appdyno install`, which writes `~/.cline/data/settings/cline_mcp_settings.json`. In the editor extension: MCP Servers icon, Configure, Configure MCP Servers, and add the entry under `mcpServers`.
2. Check: `cline config mcp`.

### Any other client

Look for "MCP" in its settings. If it takes a command, give it the one above. Most take this shape; a few use another word for `mcpServers`:

```json
{
  "mcpServers": {
    "appdyno": { "command": "npx", "args": ["-y", "appdyno", "mcp"] }
  }
}
```

## Clients in a browser

These run in their maker's cloud, so they cannot start a program on your Mac, and they cannot see `127.0.0.1`. To reach appdyno they need a way in, and appdyno opens none itself: no service of ours sits in between, and any tunnel is one you run and stop.

**Read this first. Whoever has the address and the token drives your devices.** Not just one app: they can read whatever a screen shows, type, install and remove apps, open links, change settings, and read and write files on this Mac where a tool takes a path (`record`, `report`, `visual`, `flow`, `app install`). The client's maker sees what the tools return, so assume it sees the screen.

Before you open a tunnel:

- Use a test device with test accounts, and nothing real on it.
- Limit the server: `--allow-devices`, `--allow-apps`, `--allow-urls`.
- Stop the tunnel when you are done.
- If the address or the token got out, stop the server and start it with a new token.

### The HTTP server

The hub does all of this from AI Clients, under In a Browser. Start Server runs the same command in a process of its own, from port 8765 or the next free one, and says the address. The token stays hidden until you ask, it goes to the server by its environment, and it is kept in the state folder with mode 0600, so a saved connector goes on working. New Token replaces it, for a token that got out. The server ends with the hub, however the hub ends.

By hand, `appdyno mcp --http` serves the same tools over MCP's Streamable HTTP. It is off unless you ask for it, and only listens on this Mac:

```sh
export APPDYNO_HTTP_TOKEN=$(openssl rand -hex 32)
appdyno mcp --http 127.0.0.1:8765 --allow-devices '^EXAMPLE0SERIAL$'
```

It prints the address and what to send. With no `APPDYNO_HTTP_TOKEN` it makes one and prints it, and the next start makes another, which a saved connector will no longer match. Keep your own in a password manager. There is no flag for the token, as a flag would show in `ps`.

The token goes either way, and a client uses the one it can:

- a header: `Authorization: Bearer <token>`, on `http://127.0.0.1:8765/mcp`
- the address: `http://127.0.0.1:8765/mcp/<token>`, for a client with no field for a header

A token in the address is a weaker place for it: it lands in the tunnel's logs and in the client's saved settings. ChatGPT and most Claude accounts leave no other way.

A check, before any tunnel:

```sh
curl -i -X POST http://127.0.0.1:8765/mcp      # 401: it is there, and it wants the token
npx @modelcontextprotocol/inspector --cli "http://127.0.0.1:8765/mcp/$APPDYNO_HTTP_TOKEN" \
  --transport http --method tools/list          # lists the tools
```

Then run a tunnel to `http://127.0.0.1:8765`, such as a named Cloudflare Tunnel, `ngrok http 8765` or `tailscale funnel 8765`, and use the HTTPS address it gives you. A `cloudflared` quick tunnel holds streamed answers back, so use a named one.

**One client at a time.** Once a client has called a tool, it holds the server until 10 minutes after its last call. Another client is refused with a 409 that names the holder, at its call even if it connected first, and a client that has only listed the tools holds nothing, so a health check does not get in the way. When the 10 minutes are up, or you stop the server, whatever it changed on the device goes back, as it does when a client on this Mac quits. There is one context, not one per client: a second window of the same client shares it. To drive two devices from two clients, run two servers on two ports.

If a connection breaks in the middle of a call, the call stops on the device.

### ChatGPT in a browser

ChatGPT in a browser reaches remote servers only. It connects to one under Plugins, and it can send no token: its form offers OAuth, No authentication, or both.

| plan            | what you get                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business        | everything. Only an admin or owner can add the server                                                                                                                                                                                                                                       |
| Enterprise, Edu | everything. An admin decides who can add it                                                                                                                                                                                                                                                 |
| Pro             | only tools marked read-only: `screen`, `find`, `screenshot`, `wait_for`, `assert`, `logs`, `crashes`, `audit`, `device_info`, `list_devices`, `visual`, the reading `perf_` tools. No `tap`, no typing, and no `use_device`, so start the server with `--device` or with one device allowed |
| Plus, Free      | OpenAI's pages do not say. Plan on it not being there, and use the desktop app                                                                                                                                                                                                              |

The desktop app has none of this: it runs appdyno on your Mac. [Use that](#codex-and-the-chatgpt-desktop-app) if you can.

**The way we suggest: OpenAI's Secure MCP Tunnel.** It opens no port and needs no public address, and it carries appdyno over stdio, so no HTTP server is involved. It needs an OpenAI Platform organization, personal or a company's.

1. In [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels), create a tunnel and note its `tunnel_id`. Create a runtime API key. Link the tunnel to your ChatGPT workspace, or it will not appear there.
2. On your Mac:

   ```sh
   brew install openai/tools/tunnel-client
   export CONTROL_PLANE_API_KEY="sk-..."
   tunnel-client init --sample sample_mcp_stdio_local --profile local-stdio \
     --tunnel-id tunnel_0123456789abcdef0123456789abcdef \
     --mcp-command "npx -y appdyno mcp --allow-devices '^EXAMPLE0SERIAL$'"
   tunnel-client doctor --profile local-stdio --explain
   tunnel-client run --profile local-stdio
   ```

3. Leave it running. In [ChatGPT Plugins](https://chatgpt.com/plugins): the + button, Add custom MCP server, a name, Connection: Tunnel, your tunnel, Authentication: No authentication. Accept the warning, then Create as a plugin.
4. Install the plugin. In a new conversation type `@`, pick appdyno, and ask it to list the devices.

Each request has **120 seconds, however much progress it reports**, and 10 MiB. Long measures and a first runner build do not fit: run `appdyno ios build` first.

**With a tunnel of your own.** Start the [HTTP server](#the-http-server) and a tunnel, then add the custom server with Server URL `https://<your tunnel>/mcp/<token>` and No authentication. Anyone with that URL is in, so treat it as a password.

ChatGPT asks you to confirm each write action by default. Changing that on a phone's tools is your choice to make. One report says it shows a tool's image as nothing: if `screenshot` comes back empty, use `screen`.

### Claude in a browser

This covers Claude on the web, on a phone, in Cowork, and any connector in the desktop app. Custom connectors are on every plan (Free has one), and Claude connects from its own cloud, not from your device. So the server must be reachable from the public internet, by a tunnel of yours. Local files like `claude_desktop_config.json` do not count here. [The desktop app](#claude-desktop) runs appdyno on your Mac, with no tunnel: use that if you can.

1. Start the [HTTP server](#the-http-server) and a tunnel.
2. Customize, Connectors, +, Add custom connector.
3. Give it a name and the address `https://<your tunnel>/mcp/<token>`.
4. Authentication: **No sign-in**. Add it.
5. In a chat: +, Connectors, turn it on, and ask it to list the devices.

On Team and Enterprise an Owner adds it, under Organization settings, Connectors.

Claude's pages disagree on one point. Its help article shows a **Request headers** field for a fixed token; its developer pages say the field is a beta for a limited set of organizations. If you see the field, use the plain address `https://<your tunnel>/mcp` and the header `Authorization: Bearer <token>`, which keeps the token out of the address.

A tool call has about 240 seconds, and an answer about 150,000 characters. Claude's own MCP tunnels are an Enterprise preview that needs OAuth on the server, so they are not a way in for appdyno.

## An Android phone or emulator

You need `adb`, Android's tool for talking to a device.

1. Install it. Either [Android Studio](https://developer.android.com/studio), which puts it where appdyno looks, or `brew install --cask android-platform-tools`.
2. On the phone, turn on developer options: Settings, About phone, tap **Build number** seven times. On a Xiaomi it is **OS version**.
3. In Settings, Developer options, turn on **USB debugging**. On a Xiaomi turn on **Install via USB** and **USB debugging (Security settings)** too.
4. Connect the cable. Unlock the phone, and answer **Allow** on the question it asks.
5. Check: `adb devices` lists the phone as `device`. `unauthorized` means the question was not answered: look at the phone. An empty list usually means a charge-only cable.
6. Check again: `appdyno doctor --serial <serial>`.

No phone? Create a virtual device in Android Studio's Device Manager and start it. `adb devices` lists it as `emulator-5554`.

appdyno installs its own agent on the device the first time it is used. A Xiaomi asks on its screen before each new install, and appdyno answers that one question for an install it started. See [Reaching a phone](../reference/tools.md#reaching-a-phone).

## An iPhone or a simulator

Install [Xcode](https://apps.apple.com/app/xcode/id497799835) from the App Store, open it once, and accept what it asks. Run `appdyno doctor` to see it found.

**A simulator needs nothing more**, no account and no signing. Open one with Xcode's Simulator app, or ask your client to boot one. The first action that needs appdyno's helper builds it, which takes a few minutes. To do that ahead of time:

```sh
appdyno ios build
```

**An iPhone** needs a little more, because a phone only runs code signed for that phone.

1. Connect it by cable, unlock it, and answer **Trust** on the question it asks.
2. In Xcode: Settings, Accounts, +, and sign in with your Apple ID.
3. On the phone: Settings, Privacy & Security, **Developer Mode**, on. The phone restarts and asks you to confirm. The switch appears once the phone has met Xcode.
4. Find the phone's id: `xcrun devicectl list devices`, or Xcode's Window, Devices and Simulators.
5. Sign, in one of the ways below.
6. Check: `appdyno doctor` lists the phone with no warning. If it says `no signing for the iPhone runner`, read on.
7. `appdyno ios build`, then ask your client to read the screen. The first time, keep the phone unlocked. If it says the developer is not trusted: Settings, General, VPN & Device Management, trust it.

### What signing means

appdyno puts a small test app on the phone, the runner. iOS runs it only with two things, both from Apple:

- an **identity**: your development certificate, with its private key in the login keychain
- a **provisioning profile**: a file that names the identity, this phone, and the app id

appdyno finds these by itself if they are installed. It does not create anything in your account unless you ask, in the second way below.

### With a paid Apple Developer account, a wildcard profile

The way it finds by itself, and the one that needs nothing else.

1. Xcode, Settings, Accounts, your team, Manage Certificates, +, **Apple Development**.
2. At [developer.apple.com](https://developer.apple.com/account/resources/devices/list), under Devices, add the phone's id.
3. Under Identifiers, add an App ID, type **Wildcard**, `*`.
4. Under Profiles, add **iOS App Development**, choose the wildcard id, your certificate and the phone. Download it and double-click it.
5. Check: `appdyno doctor`.

### Let Xcode do it

Give appdyno your team's id, and it asks Xcode once to provision the runner:

```sh
export APPDYNO_IOS_TEAM=ABCDE12345
```

The id has 10 characters: it is under Membership on your Apple Developer account. A client that starts appdyno does not see your shell's variables, so add it to the entry's `env`.

A free Apple ID cannot make a wildcard profile, so this is the only way it could work, and its profile lasts days, not a year. This has not been tried.

### Naming a profile yourself

For a build machine, or a Mac with several:

```sh
export APPDYNO_IOS_PROFILE=/path/to/runner.mobileprovision
export APPDYNO_IOS_KEYCHAIN=/path/to/build.keychain-db
export APPDYNO_IOS_KEYCHAIN_PASSWORD=...
```

## When it does not work

### An app cannot find npx or adb

An app opened from the Dock does not read your shell's setup. It has a short `PATH` that holds neither Homebrew nor a Node from nvm or mise, which gives `spawn npx ENOENT`, a server that stays disconnected, or `adb: not found`.

Find where they are, in a terminal:

```sh
command -v npx node adb
```

Then give the entry the full path of `npx`, and a `PATH` that holds `node` and `adb` too. The full path alone is not enough, as `npx` itself needs to find `node`:

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

`ANDROID_HOME` goes in `env` the same way, as do `APPDYNO_IOS_TEAM` and the others. Then fully restart the app. `appdyno install` leaves these additions alone.

### Everything else

| what you see                                     | what it means, and what to do                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `npm error 404 ... appdyno`                      | appdyno is not on the registry yet, and not installed here: run `sh scripts/install.sh`                                     |
| the client lists no tools, and shows no error    | restart it: most read their list once. Then look in its log, and run `appdyno doctor`                                       |
| `no connected device this server may drive`      | `adb devices` or Xcode does not see one, or `--allow-devices` shuts it out                                                  |
| `more than one device: pick one with use_device` | ask your client to use the device you mean, or add `--device` to the entry                                                  |
| `is held by pid ...`                             | another program drives that device. Stop it, or use `--share`                                                               |
| `no signing for the iPhone runner`               | see [An iPhone or a simulator](#an-iphone-or-a-simulator)                                                                   |
| `DEVICE_LOCKED`                                  | unlock the phone                                                                                                            |
| a first call on iOS fails or times out           | the runner is still building and the client gave up: run `appdyno ios build`, then try again                                |
| a call stops at 60 seconds in Codex              | add `tool_timeout_sec` [to its entry](#codex-and-the-chatgpt-desktop-app)                                                   |
| a call stops at 120 seconds in ChatGPT           | the Secure MCP Tunnel's limit. It cannot be raised: use something shorter, or the desktop app                               |
| a call stops at about 4 minutes in Claude        | the hosted limit. Use something shorter, or Claude Code                                                                     |
| `401` on the HTTP server                         | no token, or the wrong one. A client that sends none needs the token in the address                                         |
| `403 requests from ... are not accepted`         | a web page or a client that sent an `Origin` header not of this server. It is in the server's log                           |
| `409 this server serves one client at a time`    | another client holds it, as the message says. Wait 10 minutes from its last call, or restart the server                     |
| `address already in use`                         | the port is taken: pick another                                                                                             |
| a connector will not add, or sees no tools       | `curl -i -X POST https://<your tunnel>/mcp` should give 401. Anything else means the tunnel is not reaching the server      |
| a connector worked and now fails                 | the server restarted with a generated token, or the tunnel's address changed. Keep `APPDYNO_HTTP_TOKEN`, use a named tunnel |

## What this was tried on

On macOS with a temporary home folder, from the package built and installed from its tarball, with every device shut out by `--allow-devices`, on 2026-11-04:

| tried                                                  | result                                                   |
| ------------------------------------------------------ | -------------------------------------------------------- |
| `appdyno install` for every client in the list         | each file written, and again: all "already right"        |
| Claude Code 2.1.318, stdio and HTTP                    | connected; a wrong token and a second client refused     |
| Gemini CLI 0.66.0, opencode 1.19.5                     | connected, by their own `mcp list`                       |
| Codex CLI 0.166.0, Cline CLI 3.0.74                    | each read its file and listed appdyno; neither connected |
| MCP Inspector's command line, the token in the address | listed the tools, called one                             |

What each client calls itself in `clientInfo`, which is how AI Clients knows it has called, was read from the client's own call for Claude Code 2.1.318: `claude-code`. For every other client the pattern in `packages/cli/src/clients.ts` comes from what it is known to send, and has not been seen here. If one is wrong, that client shows as a row of its own under the name it gave, and is never called Connected in another's place.

Not tried, as each needs an account, a licence or a window: the ChatGPT app and web, Claude Desktop and Claude on the web, Secure MCP Tunnel, any public tunnel, a connection from Codex, Cursor, VS Code, Devin Desktop, Antigravity and Zed. Their steps here are from their own documentation. A free Apple ID's signing has not been tried either.
