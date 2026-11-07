cask "appdyno" do
  version "@VERSION@"
  sha256 "@SHA256@"

  url "@REPOSITORY@/releases/download/v#{version}/Appdyno-#{version}-arm64.dmg"
  name "Appdyno"
  desc "Drive and measure iOS and Android devices"
  homepage "@REPOSITORY@"

  # it replaces itself, when a person asks it to
  auto_updates true
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"

  app "Appdyno.app"
  binary "#{appdir}/Appdyno.app/Contents/Resources/bin/appdyno"

  uninstall quit: "dev.appdyno.app"

  zap trash: [
    "~/Library/Application Support/appdyno",
    "~/Library/Caches/appdyno",
    "~/Library/Preferences/dev.appdyno.app.plist",
  ]
end
