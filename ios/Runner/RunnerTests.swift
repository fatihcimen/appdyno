import UIKit
import XCTest

let agentVersion = "0.6.0"

/// The runner: one long test that serves the host until it asks to shut down. Port and token come from
/// the launch environment (APPDYNO_PORT, APPDYNO_TOKEN; xcodebuild passes TEST_RUNNER_-prefixed variables).
/// A failure XCTest recorded during a request: the request's error, if the runner lives through it. It may not: on an
/// iPhone a live element's frame read after the element went ended this test, whatever `continueAfterFailure` says, so
/// a request reads by snapshots, which throw.
enum IssueTrap {
    private static let lock = NSLock()
    private static var last: String?
    static func record(_ s: String) { lock.lock(); last = s; lock.unlock() }
    static func take() -> String? { lock.lock(); defer { last = nil; lock.unlock() }; return last }
}

final class RunnerTests: XCTestCase {
    override func record(_ issue: XCTIssue) {
        IssueTrap.record(issue.compactDescription)
        super.record(issue)
    }

    func testServe() throws {
        // one failed interaction must not end the runner: the request that caused it answers with it
        continueAfterFailure = true
        let env = ProcessInfo.processInfo.environment
        guard let port = env["APPDYNO_PORT"].flatMap(UInt16.init), let token = env["APPDYNO_TOKEN"], token.count >= 16 else {
            throw AgentError("INVALID_ARGUMENT", "APPDYNO_PORT and APPDYNO_TOKEN (16+ characters) are required")
        }
        LogShim.install()
        if env["APPDYNO_IDLE_WAITS"] != "1" { IdleShim.install() }
        let device = Device()
        if let target = env["APPDYNO_TARGET"], !target.isEmpty { device.setTarget(target) }
        let pump = MainPump()
        // XCUI must be asked on the main thread; hello is answered on the network queue from this copy
        let lock = NSLock()
        var info = Self.hello(env)
        let server = try Server(port: port, token: token, tunnels: env["APPDYNO_TUNNELS"] == "1", pump: pump, hello: { lock.lock(); defer { lock.unlock() }; return info }) { job in
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
        // the home screen app's frame, not UIScreen's: a runner without a launch screen is told 320 x 480
        let b = XCUIApplication(bundleIdentifier: Device.springboardId).frame
        let rotation: Int = {
            switch XCUIDevice.shared.orientation {
            case .landscapeLeft: return 1
            case .portraitUpsideDown: return 2
            case .landscapeRight: return 3
            default: return 0
            }
        }()
        return helloWire(agentVersion: agentVersion, osVersion: UIDevice.current.systemVersion,
                         model: env["SIMULATOR_MODEL_IDENTIFIER"] ?? UIDevice.current.model,
                         w: b.width, h: b.height, density: UIScreen.main.scale, rotation: rotation,
                         pid: Int(ProcessInfo.processInfo.processIdentifier), idleShimChecked: IdleShim.selfChecked)
    }

    static func handle(_ job: Job, _ d: Device, _ pump: MainPump) throws -> Reply {
        _ = IssueTrap.take()
        let reply = try serve(job, d, pump)
        if let issue = IssueTrap.take() { throw AgentError("INTERNAL", "XCTest: \(issue)") }
        return reply
    }

    static func serve(_ job: Job, _ d: Device, _ pump: MainPump) throws -> Reply {
        let p = job.params
        switch job.method {
        case "tree.get":
            let t0 = Date()
            let r = try TreeRequest(p)
            var c = try d.capture(maxDepth: r.maxDepth, maxNodes: r.maxNodes, job: job)
            d.hideUnreachableCopies(&c)
            d.remember(c)
            return Reply(result: d.treeJSON(c, elapsedMs: Int(Date().timeIntervalSince(t0) * 1000)))
        case "wait": return Reply(result: try d.wait(WaitRequest(p), job: job))
        case "act":
            let a = try Action(required(p, "action"))
            let waited = try d.perform(a)
            // the quiet window starts once the action has returned: a synthesized tap alone takes 300–600 ms,
            // and a window counted from its start would be spent before the app saw the touch
            let at = Int(Date().timeIntervalSince1970 * 1000)
            var out = try d.after(AfterRequest(p), job: job, actionAt: at, tapAt: a.tapPoint)
            if let waited { out["animationWaitMs"] = waited }
            return Reply(result: out)
        case "animations.wait":
            let at = try OneValue.point(p)
            let waited = d.animationsOver(at.x, at.y)
            return Reply(result: waited.map { ["ms": $0] } ?? [:])
        case "text.set":
            return Reply(result: try d.setText(TextRequest(p), job: job))
        case "text.keys":
            return Reply(result: try d.typeKeys(KeysRequest(p), job: job))
        case "screenshot":
            return try d.screenshot(ShotRequest(p))
        case "audit":
            return Reply(result: try d.audit(AuditRequest(p), job: job))
        case "app.foreground":
            return Reply(result: d.foreground())
        case "permission.reset":
            try d.resetPermission(try OneValue.pkg(p), try OneValue.service(p))
            return Reply(result: [:])
        case "app.target":
            d.setTarget(try OneValue.pkg(p))
            return Reply(result: [:])
        case "clipboard.set":
            let text = try OneValue.text(p)
            UIPasteboard.general.string = text
            Device.markPasteboard()
            guard UIPasteboard.general.string == text else {
                throw AgentError("UNSUPPORTED", "the runner cannot reach the clipboard here (on a phone only the app in front can)")
            }
            return Reply(result: [:])
        case "clipboard.get":
            guard Device.ownsPasteboard else {
                throw AgentError("UNSUPPORTED", "the clipboard holds another app's text: reading it here would ask the user")
            }
            return Reply(result: UIPasteboard.general.string.map { ["text": $0] } ?? [:])
        case "orientation.set":
            d.orientation(try OneValue.rotation(p))
            return Reply(result: [:])
        case "shutdown":
            pump.stop()
            return Reply(result: [:])
        default:
            throw unknownMethod(job.method)
        }
    }
}
