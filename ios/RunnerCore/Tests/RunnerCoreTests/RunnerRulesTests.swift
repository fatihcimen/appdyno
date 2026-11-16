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
        XCTAssertEqual(t["copiesStillMs"], SettleTimes.copiesStillMs)
    }

    func testTheCopiesOfAControl() throws {
        let copies = try XCTUnwrap(rules()["copies"] as? Wire)
        let screen = try XCTUnwrap(copies["screen"] as? Wire)
        let all = try nodes(screen)
        let groups = repeatedControls(all)
        XCTAssertEqual(groups, screen["groups"] as? [[Int]])
        XCTAssertEqual(groups.map { copiesId(all, $0) }, screen["ids"] as? [String])
        for c in try XCTUnwrap(screen["covers"] as? [Wire]) {
            XCTAssertEqual(coverKey(all, try XCTUnwrap(c["hidden"] as? [Int])), c["cover"] as? String,
                           c["why"] as? String ?? "")
        }
    }

    func testWhenCopiesAreAskedOfAgain() throws {
        let traces = try XCTUnwrap((rules()["copies"] as? Wire)?["verdicts"] as? [Wire])
        XCTAssertFalse(traces.isEmpty)
        for t in traces {
            let why = t["why"] as? String ?? ""
            let asked = try XCTUnwrap(t["asked"] as? Wire, why)
            var verdict = CopiesVerdict(places: try XCTUnwrap(asked["places"] as? [[Int]], why), hidden: [],
                                        cover: try XCTUnwrap(asked["cover"] as? String, why), at: 0)
            for read in try XCTUnwrap(t["reads"] as? [Wire], why) {
                let places = try XCTUnwrap(read["places"] as? [[Int]], why)
                let cover = try XCTUnwrap(read["cover"] as? String, why), at = try XCTUnwrap(read["at"] as? Int, why)
                let ask = verdict.stale(places: places, cover: cover, at: at, still: read["still"] as? Bool ?? false)
                XCTAssertEqual(ask, read["ask"] as? Bool, "\(why), at \(at)")
                if ask { verdict = CopiesVerdict(places: places, hidden: [], cover: cover, at: at) }
            }
        }
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
