import XCTest
@testable import RunnerCore

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

    func testTheDigest() throws {
        let d = try XCTUnwrap(rules()["digest"] as? Wire)
        XCTAssertEqual(layoutHash(try nodes(d)), d["hash"] as? String)
        for c in try cases("sameDigest") {
            XCTAssertEqual(layoutHash(try nodes(c, "a")), layoutHash(try nodes(c, "b")), c["why"] as? String ?? "")
        }
    }

    func testTheSameLayout() throws {
        for c in try cases("sameLayout") {
            XCTAssertEqual(sameLayout(try nodes(c, "a"), try nodes(c, "b")), c["same"] as? Bool, c["why"] as? String ?? "")
        }
    }

    func testWhatATapCanReach() throws {
        for c in try cases("actionable") {
            let n = try nodes(c)
            for p in try XCTUnwrap(c["points"] as? [Wire]) {
                XCTAssertEqual(actionable(n, x: p["x"] as! Int, y: p["y"] as! Int), p["actionable"] as? Bool, p["why"] as? String ?? "")
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
        XCTAssertEqual(containerBars(try nodes(c), screenW: screen["w"]!, screenH: screen["h"]!), c["bars"] as? [Int])
    }

    func testAnAlert() throws {
        for c in try cases("hasAlert") { XCTAssertEqual(hasAlert(try nodes(c)), c["has"] as? Bool, c["why"] as? String ?? "") }
    }
}
