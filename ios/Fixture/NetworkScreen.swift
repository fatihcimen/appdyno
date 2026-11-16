import SwiftUI

/// One request through a session of its own, as most apps make it: what is typed, else APPDYNO_FIXTURE_FETCH_URL.
/// APPDYNO_FIXTURE_NO_PROXY: past a proxy a phone's Wi-Fi may name, as a known download must reach its server.
/// Post sends a JSON body and a credential in a header, for what reads a request whole to show and to hide.
struct NetworkScreen: View {
    @State private var url = ProcessInfo.processInfo.environment["APPDYNO_FIXTURE_FETCH_URL"] ?? ""
    @State private var result = ""
    @State private var answer = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("URL", text: $url)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("url_input")
            HStack(spacing: 24) {
                Button("Fetch") { send(posting: false) }.accessibilityIdentifier("fetch")
                Button("Post") { send(posting: true) }.accessibilityIdentifier("post")
            }
            Text(result).accessibilityIdentifier("fetch_result")
            Text(answer).accessibilityIdentifier("fetch_body")
            Spacer()
        }
        .padding()
    }

    private func send(posting: Bool) {
        guard let address = URL(string: url) else { result = "failed: not a URL"; return }
        result = ""
        answer = ""
        let configuration = URLSessionConfiguration.default
        if ProcessInfo.processInfo.environment["APPDYNO_FIXTURE_NO_PROXY"] != nil {
            configuration.connectionProxyDictionary = [:]
        }
        var request = URLRequest(url: address)
        if posting {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer fixture-bearer-0123456789", forHTTPHeaderField: "Authorization")
            request.httpBody = Data(#"{"user":"fixture","password":"fixture-pass-77"}"#.utf8)
        }
        let started = Date()
        URLSession(configuration: configuration).dataTask(with: request) { data, response, error in
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let took = Int(Date().timeIntervalSince(started) * 1000)
            let text = error.map { "failed: \($0.localizedDescription)" }
                ?? "fetched \(code) \(data?.count ?? 0) in \(took) ms"
            // the start of what came, where it says it is text: a body of bytes says nothing here
            let type = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? ""
            let isText = type.contains("text") || type.contains("json")
            let words = isText ? data.flatMap { String(data: $0.prefix(80), encoding: .utf8) } ?? "" : ""
            DispatchQueue.main.async {
                result = text
                answer = words
            }
        }.resume()
    }
}
