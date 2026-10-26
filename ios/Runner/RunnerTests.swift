import UIKit
import XCTest

let agentVersion = "0.5.0"

/// The runner: one long test that serves the host until it asks to shut down. Port and token come from
/// the launch environment (APPDYNO_PORT, APPDYNO_TOKEN; xcodebuild passes TEST_RUNNER_-prefixed variables).
final class RunnerTests: XCTestCase {
    func testServe() throws {
        let env = ProcessInfo.processInfo.environment
        guard let port = env["APPDYNO_PORT"].flatMap(UInt16.init), let token = env["APPDYNO_TOKEN"], token.count >= 16 else {
            throw AgentError("INVALID_ARGUMENT", "APPDYNO_PORT and APPDYNO_TOKEN (16+ characters) are required")
        }
        if env["APPDYNO_IDLE_WAITS"] != "1" { IdleShim.install() }
        let device = Device()
        if let target = env["APPDYNO_TARGET"], !target.isEmpty { device.setTarget(target) }
        let pump = MainPump()
        // XCUI must be asked on the main thread; hello is answered on the network queue from this copy
        let lock = NSLock()
        var info = Self.hello(env)
        let server = try Server(port: port, token: token, pump: pump, hello: { lock.lock(); defer { lock.unlock() }; return info }) { job in
            let reply = try Self.handle(job, device, pump)
            if job.method == "orientation.set" {
                let fresh = Self.hello(env)
                lock.lock(); info = fresh; lock.unlock()
            }
            return reply
        }
        server.start()
        NSLog("appdyno runner listening on 127.0.0.1:%d", port)
        pump.run(idleExit: env["APPDYNO_IDLE_EXIT_S"].flatMap(Double.init) ?? 900)
        server.stop()
    }

    static func hello(_ env: [String: String]) -> [String: Any] {
        let b = UIScreen.main.bounds
        let rotation: Int = {
            switch XCUIDevice.shared.orientation {
            case .landscapeLeft: return 1
            case .portraitUpsideDown: return 2
            case .landscapeRight: return 3
            default: return 0
            }
        }()
        return [
            "agentVersion": agentVersion,
            "protocol": ["major": 1, "minor": 1],
            "platform": "ios",
            "osVersion": UIDevice.current.systemVersion,
            "model": env["SIMULATOR_MODEL_IDENTIFIER"] ?? UIDevice.current.model,
            "screen": ["w": b.width, "h": b.height, "density": UIScreen.main.scale, "rotation": rotation],
            "capabilities": ["tree", "act", "settle", "text", "screenshot", "clipboard", "orientation", "app.target"]
                + (IdleShim.applied.isEmpty ? [] : ["noIdleWait"]) + (EventShim.available ? ["fastTap"] : []),
            "pid": Int(ProcessInfo.processInfo.processIdentifier),
            "idleWaitsOff": IdleShim.applied,
            "fastTap": EventShim.available,
        ]
    }

    static func handle(_ job: Job, _ d: Device, _ pump: MainPump) throws -> Reply {
        let p = job.params
        switch job.method {
        case "tree.get":
            let t0 = Date()
            let c = try d.capture(maxDepth: (p["maxDepth"] as? NSNumber)?.intValue ?? 128,
                                  maxNodes: (p["maxNodes"] as? NSNumber)?.intValue ?? 5000, job: job)
            d.remember(c)
            return Reply(result: d.treeJSON(c, elapsedMs: Int(Date().timeIntervalSince(t0) * 1000)))
        case "act":
            guard let a = p["action"] as? [String: Any] else { throw AgentError("INVALID_ARGUMENT", "action is required") }
            let at = Int(Date().timeIntervalSince1970 * 1000)
            try d.perform(a)
            let tap: (Double, Double)? = a["kind"] as? String == "tap"
                ? ((a["x"] as? NSNumber)?.doubleValue ?? -1, (a["y"] as? NSNumber)?.doubleValue ?? -1) : nil
            return Reply(result: try d.after(p, job: job, actionAt: at, tapAt: tap))
        case "text.set":
            return Reply(result: try d.setText(p, job: job))
        case "screenshot":
            return try d.screenshot(p)
        case "app.foreground":
            return Reply(result: d.foreground())
        case "app.target":
            guard let id = p["pkg"] as? String, !id.isEmpty else { throw AgentError("INVALID_ARGUMENT", "pkg is required") }
            d.setTarget(id)
            return Reply(result: [:])
        case "clipboard.set":
            let text = p["text"] as? String ?? ""
            UIPasteboard.general.string = text
            guard UIPasteboard.general.string == text else {
                throw AgentError("UNSUPPORTED", "the runner cannot reach the clipboard here (on a phone only the app in front can)")
            }
            return Reply(result: [:])
        case "clipboard.get":
            return Reply(result: UIPasteboard.general.string.map { ["text": $0] } ?? [:])
        case "orientation.set":
            d.orientation((p["rotation"] as? NSNumber)?.intValue ?? 0)
            return Reply(result: [:])
        case "shutdown":
            pump.stop()
            return Reply(result: [:])
        default:
            throw AgentError("UNSUPPORTED", "unknown method \(job.method)")
        }
    }
}
