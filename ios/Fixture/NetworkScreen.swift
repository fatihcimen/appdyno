import SwiftUI

/// One request through a session of its own, as most apps make it: what is typed, else APPDYNO_FIXTURE_FETCH_URL.
/// APPDYNO_FIXTURE_NO_PROXY: past a proxy a phone's Wi-Fi may name, as a known download must reach its server.
struct NetworkScreen: View {
    @State private var url = ProcessInfo.processInfo.environment["APPDYNO_FIXTURE_FETCH_URL"] ?? ""
    @State private var result = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("URL", text: $url)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("url_input")
            Button("Fetch") {
                guard let address = URL(string: url) else { result = "failed: not a URL"; return }
                let configuration = URLSessionConfiguration.default
                if ProcessInfo.processInfo.environment["APPDYNO_FIXTURE_NO_PROXY"] != nil {
                    configuration.connectionProxyDictionary = [:]
                }
                let session = URLSession(configuration: configuration)
                session.dataTask(with: address) { data, response, error in
                    let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                    let text = error.map { "failed: \($0.localizedDescription)" }
                        ?? "fetched \(code) \(data?.count ?? 0)"
                    DispatchQueue.main.async { result = text }
                }.resume()
            }.accessibilityIdentifier("fetch")
            Text(result).accessibilityIdentifier("fetch_result")
            Spacer()
        }
        .padding()
    }
}
