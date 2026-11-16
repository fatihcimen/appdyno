import SwiftUI
import WebKit

/// One request through a session of its own, as most apps make it: what is typed, else APPDYNO_FIXTURE_FETCH_URL.
/// APPDYNO_FIXTURE_NO_PROXY: past a proxy a phone's Wi-Fi may name, as a known download must reach its server.
/// Each button makes it another way an app does, for what reads or changes a request to be held to:
/// Post sends a JSON body and a credential in a header; Upload a body by a stream, longer than what a reader keeps;
/// Config goes by a session whose configuration adds headers and gives up after two seconds; Pin by a session whose
/// delegate refuses every server's certificate, as an app that pins refuses all but its own; Others makes what no
/// protocol of the URL loading system carries: a web view, a background session's configuration, and a WebSocket task
/// to the address typed.
struct NetworkScreen: View {
    @State private var url = ProcessInfo.processInfo.environment["APPDYNO_FIXTURE_FETCH_URL"] ?? ""
    @State private var result = ""
    @State private var answer = ""

    private enum Way: String, CaseIterable {
        case fetch, post, upload, config, pin, others
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("URL", text: $url)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("url_input")
            HStack(spacing: 16) {
                ForEach(Way.allCases, id: \.self) { way in
                    Button(way.rawValue.capitalized) { send(way) }.accessibilityIdentifier(way.rawValue)
                }
            }
            Text(result).accessibilityIdentifier("fetch_result")
            Text(answer).accessibilityIdentifier("fetch_body")
            Spacer()
        }
        .padding()
    }

    private func session(_ way: Way) -> URLSession {
        let configuration = URLSessionConfiguration.default
        if ProcessInfo.processInfo.environment["APPDYNO_FIXTURE_NO_PROXY"] != nil {
            configuration.connectionProxyDictionary = [:]
        }
        if way == .config {
            configuration.httpAdditionalHeaders = [
                "X-Fixture-Config": "on",
                "Authorization": "Bearer config-bearer-0123456789"
            ]
            configuration.timeoutIntervalForRequest = 2
        }
        let delegate = way == .pin ? RefusesTrust() : nil
        return URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    }

    private func request(_ way: Way, to address: URL) -> URLRequest {
        var request = URLRequest(url: address)
        switch way {
        case .post:
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer fixture-bearer-0123456789", forHTTPHeaderField: "Authorization")
            request.httpBody = Data(#"{"user":"fixture","password":"fixture-pass-77"}"#.utf8)
        case .upload:
            let body = Data(repeating: 0x61, count: 100_000)
            request.httpMethod = "POST"
            request.setValue("text/plain", forHTTPHeaderField: "Content-Type")
            request.setValue(String(body.count), forHTTPHeaderField: "Content-Length")
            request.httpBodyStream = InputStream(data: body)
        case .fetch, .config, .pin, .others:
            break
        }
        return request
    }

    private func send(_ way: Way) {
        guard let address = URL(string: url) else { result = "failed: not a URL"; return }
        result = ""
        answer = ""
        if way == .others {
            others(address)
            return
        }
        let started = Date()
        session(way).dataTask(with: request(way, to: address)) { data, response, error in
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let took = Int(Date().timeIntervalSince(started) * 1000)
            let text = error.map { "failed: \($0.localizedDescription) in \(took) ms" }
                ?? "fetched \(code) \(data?.count ?? 0) in \(took) ms"
            // the start of what came, where it says it is text: a body of bytes says nothing here
            let type = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? ""
            let isText = type.contains("text") || type.contains("json")
            let words = isText ? data.flatMap { String(data: $0.prefix(160), encoding: .utf8) } ?? "" : ""
            DispatchQueue.main.async {
                result = text
                answer = words
            }
        }.resume()
    }
}

extension NetworkScreen {
    /// A web view that loads nothing, a background configuration no session is made of, and a WebSocket task that
    /// asks the address for an upgrade and shows the first message it is sent.
    fileprivate func others(_ address: URL) {
        _ = WKWebView(frame: .zero)
        _ = URLSessionConfiguration.background(withIdentifier: "dev.appdyno.fixture.background")
        var socket = URLComponents(url: address, resolvingAgainstBaseURL: false)
        socket?.scheme = "ws"
        result = "made 3"
        guard let url = socket?.url else { return }
        let task = URLSession.shared.webSocketTask(with: url)
        task.receive { got in
            let words: String
            switch got {
            case .success(.string(let text)): words = "socket said \(text)"
            case .success: words = "socket said bytes"
            case .failure(let error): words = "socket failed: \(error.localizedDescription)"
            }
            DispatchQueue.main.async { answer = words }
        }
        task.resume()
    }
}

/// A session's delegate that trusts no server: with it a request to any HTTPS address is cancelled.
private final class RefusesTrust: NSObject, URLSessionDelegate {
    func urlSession(
        _: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        let trust = challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust
        completionHandler(trust ? .cancelAuthenticationChallenge : .performDefaultHandling, nil)
    }
}
