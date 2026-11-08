@testable import RunnerCore
import XCTest

/// The rules the runner shares with the host's direct read of a simulator, the same file in both suites.
final class RunnerRulesTests: XCTestCase {
    private func rules() throws -> Wire { try repoJSON("packages/driver-apple/test/fixtures/runner-rules.json") }

    private func nodes(_ w: Wire, _ key: String = "nodes") throws -> [Node] {
        try XCTUnwrap(w[key] as? [Wire], key).map(Node.init(wire:))
    }

    private func cases(_ key: String) throws -> [Wire] { try XCTUnwrap(rules()[key] as? [Wire], key) }

    func testTheTimesAreTheHosts() throws {
        let t = try XCTUnwrap(rules()["times"] as? [String: Int])
        XCTAssertEqual(t["tolerance"], layoutTolerance)
        XCTAssertEqual(t["inertQuietMs"], SettleTimes.inertQuietMs)
        XCTAssertEqual(t["alertAppearMs"], SettleTimes.alertAppearMs)
        XCTAssertEqual(t["alertWatchMs"], SettleTimes.alertWatchMs)
    }

    func testTheSettle() throws {
        let traces = try cases("settleTraces")
        XCTAssertFalse(traces.isEmpty)
        for t in traces {
            let why = t["why"] as? String ?? ""
            let screens = try XCTUnwrap(t["screens"] as? [String], why)
            let busy = try XCTUnwrap(t["busy"] as? [String], why)
            let readMs = try XCTUnwrap(t["readMs"] as? Int, why)
            var now = 0
            var read = 0
            let settler = Settler(clock: { now }, sleep: { now += $0 })
            settler.pollMs = try XCTUnwrap(t["pollMs"] as? Int, why)
            let outcome: SettleOutcome<String> = settler.run(
                actionAt: 0,
                quietMs: try XCTUnwrap(t["quietMs"] as? Int, why),
                maxMs: try XCTUnwrap(t["maxMs"] as? Int, why),
                before: t["before"] as? String,
                probe: SettleProbe(
                    read: {
                        now += readMs
                        defer { read += 1 }
                        return screens[min(read, screens.count - 1)]
                    },
                    same: ==,
                    busy: { busy.contains($0) },
                    cancelled: { false }))
            XCTAssertEqual(outcome.settled, t["settled"] as? Bool, why)
            XCTAssertEqual(outcome.reads, t["reads"] as? Int, why)
            XCTAssertEqual(outcome.elapsedMs, t["elapsedMs"] as? Int, why)
        }
    }

    func testTheDigest() throws {
        let d = try XCTUnwrap(rules()["digest"] as? Wire)
        XCTAssertEqual(layoutHash(try nodes(d)), d["hash"] as? String)
        for c in try cases("sameDigest") {
            XCTAssertEqual(layoutHash(try nodes(c, "a")), layoutHash(try nodes(c, "b")), c["why"] as? String ?? "")
        }
    }

    func testTheSameLayout() throws {
        for c in try cases("sameLayout") {
            XCTAssertEqual(sameLayout(try nodes(c, "a"), try nodes(c, "b")), c["same"] as? Bool,
                           c["why"] as? String ?? "")
        }
    }

    func testWhatATapCanReach() throws {
        for c in try cases("actionable") {
            let screen = try nodes(c)
            for p in try XCTUnwrap(c["points"] as? [Wire]) {
                let x = try XCTUnwrap(p["x"] as? Int), y = try XCTUnwrap(p["y"] as? Int)
                XCTAssertEqual(actionable(screen, x: x, y: y), p["actionable"] as? Bool, p["why"] as? String ?? "")
            }
        }
        XCTAssertTrue(actionable(nil, x: 0, y: 0)) // no screen known: careful
    }

    func testTheBars() throws {
        for c in try cases("scrollBars") {
            XCTAssertEqual(scrollIndicators(try nodes(c)), c["bars"] as? [Int], c["why"] as? String ?? "")
        }
        let c = try XCTUnwrap(rules()["containerBars"] as? Wire)
        let screen = try XCTUnwrap(c["screen"] as? [String: Int])
        let screenW = try XCTUnwrap(screen["w"]), screenH = try XCTUnwrap(screen["h"])
        XCTAssertEqual(containerBars(try nodes(c), screenW: screenW, screenH: screenH), c["bars"] as? [Int])
    }

    func testAnAlert() throws {
        for c in try cases("hasAlert") {
            XCTAssertEqual(hasAlert(try nodes(c)), c["has"] as? Bool, c["why"] as? String ?? "")
        }
    }
}
