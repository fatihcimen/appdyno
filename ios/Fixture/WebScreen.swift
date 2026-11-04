import SwiftUI
import UIKit
import WebKit

/// A web view on the page the Android fixture shows, open to the Safari inspector.
struct WebScreen: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let web = WKWebView()
        web.isInspectable = true
        web.loadHTMLString("<html><head><title>Fixture web</title></head><body><h1>Web content</h1><p>Payment page</p><button id='pay' onclick=\"document.getElementById('paid').textContent='Paid'\">Pay</button><input id='card' placeholder='Card'><p id='paid'></p><canvas id='drawn' width='10' height='10'></canvas><script>console.log('fixture web page loaded')</script></body></html>", baseURL: nil)
        return web
    }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
