import os
import UIKit
import XCTest

let agentVersion = "1.0.1"

/// The runner: one long test that serves the host until it asks to shut down. Port and token come from
/// the launch environment (APPDYNO_PORT, APPDYNO_TOKEN; xcodebuild passes TEST_RUNNER_-prefixed variables).
/// A failure XCTest recorded during a request: the request's error, if the runner lives through it. It may not: on an
/// iPhone a live element's frame read after the element went ended this test, whatever `continueAfterFailure` says, so
/// a request reads by snapshots, which throw.
enum IssueTrap {
    private static let last = OSAllocatedUnfairLock<String?>(initialState: nil)
    static func record(_ issue: String) { last.withLock { $0 = issue } }
    static func take() -> String? { last.withLock { issue in defer { issue = nil }; return issue } }
}

final class RunnerTests: XCTestCase {
    override func record(_ issue: XCTIssue) {
        IssueTrap.record(issue.compactDescription)
        super.record(issue)
    }

    @MainActor func testServe() throws {
        // one failed interaction must not end the runner: the request that caused it answers with it
        continueAfterFailure = true
        let env = ProcessInfo.processInfo.environment
        guard let port = env["APPDYNO_PORT"].flatMap(UInt16.init), let token = env["APPDYNO_TOKEN"],
              token.count >= 16 else {
            throw AgentError("INVALID_ARGUMENT", "APPDYNO_PORT and APPDYNO_TOKEN (16+ characters) are required")
        }
        LogShim.install()
        if env["APPDYNO_IDLE_WAITS"] != "1" { IdleShim.install() }
        let device = Device()
        if let target = env["APPDYNO_TARGET"], !target.isEmpty { device.setTarget(target) }
        let pump = MainPump()
        // XCUI must be asked on the main thread; hello is answered on the network queue from this copy, unchecked as a
        // dictionary is a value: each read takes a whole copy
        let info = OSAllocatedUnfairLock(uncheckedState: Self.hello(env))
        let server = try Server(
            port: port, token: token, tunnels: env["APPDYNO_TUNNELS"] == "1", pump: pump,
            hello: { info.withLockUnchecked { $0 } },
            handle: { job in
                let reply = try Self.handle(job, device, pump)
                if job.method == "orientation.set" {
                    let fresh = Self.hello(env)
                    info.withLockUnchecked { $0 = fresh }
                }
                return reply
            })
        server.start()
        NSLog("appdyno runner listening on 127.0.0.1:%d", port)
        pump.run(idleExit: env["APPDYNO_IDLE_EXIT_S"].flatMap(Double.init) ?? 900)
        server.stop()
    }

    @MainActor private static func hello(_ env: [String: String]) -> [String: Any] {
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
        // the scale by traits, as iOS 26 deprecates UIScreen.main and the runner has no window of its own to ask
        return Hello(agentVersion: agentVersion, osVersion: UIDevice.current.systemVersion,
                     model: env["SIMULATOR_MODEL_IDENTIFIER"] ?? UIDevice.current.model,
                     w: b.width, h: b.height, density: UITraitCollection.current.displayScale, rotation: rotation,
                     pid: Int(ProcessInfo.processInfo.processIdentifier), idleShimChecked: IdleShim.selfChecked).wire
    }

    @MainActor private static func handle(_ job: Job, _ d: Device, _ pump: MainPump) throws -> Reply {
        _ = IssueTrap.take()
        let reply = try serve(job, d, pump)
        if let issue = IssueTrap.take() { throw AgentError("INTERNAL", "XCTest: \(issue)") }
        return reply
    }

    @MainActor private static func serve(_ job: Job, _ d: Device, _ pump: MainPump) throws -> Reply {
        guard let method = methods[job.method] else { throw unknownMethod(job.method) }
        return try method(job, d, pump)
    }

    private static let methods: [String: @MainActor (Job, Device, MainPump) throws -> Reply] = [
        "tree.get": { job, d, _ in
            let start = Date()
            let request = try TreeRequest(job.params)
            var c = try d.capture(maxDepth: request.maxDepth, maxNodes: request.maxNodes, job: job, pkg: request.pkg)
            // another app's read is a look for the host, of no copies a touch reaches nor a screen `before` names
            if request.pkg == nil {
                d.hideUnreachableCopies(&c)
                d.remember(c)
            }
            return Reply(result: d.treeJSON(c, elapsedMs: Int(Date().timeIntervalSince(start) * 1000)))
        },
        "wait": { job, d, _ in Reply(result: try d.wait(WaitRequest(job.params), job: job)) },
        "act": { job, d, _ in
            let action = try Action(required(job.params, "action"))
            let waited = try d.perform(action, job: job)
            // the quiet window starts once the action has returned: a synthesized tap alone takes 300–600 ms,
            // and a window counted from its start would be spent before the app saw the touch
            let at = Int(Date().timeIntervalSince1970 * 1000)
            var out = try d.after(AfterRequest(job.params), job: job, actionAt: at, tapAt: action.tapPoint)
            if let waited { out["animationWaitMs"] = waited }
            return Reply(result: out)
        },
        "animations.wait": { job, d, _ in
            let at = try OneValue.point(job.params)
            let waited = d.animationsOver(at.x, at.y)
            return Reply(result: waited.map { ["ms": $0] } ?? [:])
        },
        "text.set": { job, d, _ in Reply(result: try d.setText(TextRequest(job.params), job: job)) },
        "text.keys": { job, d, _ in Reply(result: try d.typeKeys(KeysRequest(job.params), job: job)) },
        "screenshot": { job, d, _ in try d.screenshot(ShotRequest(job.params)) },
        "audit": { job, d, _ in Reply(result: try d.audit(AuditRequest(job.params), job: job)) },
        "app.foreground": { _, d, _ in Reply(result: d.foreground()) },
        "permission.reset": { job, d, _ in
            try d.resetPermission(try OneValue.pkg(job.params), try OneValue.service(job.params))
            return Reply(result: [:])
        },
        "app.target": { job, d, _ in
            d.setTarget(try OneValue.pkg(job.params))
            return Reply(result: [:])
        },
        "clipboard.set": { job, _, _ in
            let text = try OneValue.text(job.params)
            UIPasteboard.general.string = text
            Device.markPasteboard()
            guard UIPasteboard.general.string == text else {
                throw AgentError("UNSUPPORTED",
                                 "the runner cannot reach the clipboard here (on a phone only the app in front can)")
            }
            return Reply(result: [:])
        },
        "clipboard.get": { _, _, _ in
            guard Device.ownsPasteboard else {
                throw AgentError("UNSUPPORTED",
                                 "the clipboard holds another app's text: reading it here would ask the user")
            }
            return Reply(result: UIPasteboard.general.string.map { ["text": $0] } ?? [:])
        },
        "orientation.set": { job, d, _ in
            d.orientation(try OneValue.rotation(job.params))
            return Reply(result: [:])
        },
        "shutdown": { _, _, pump in
            pump.stop()
            return Reply(result: [:])
        }
    ]
}
