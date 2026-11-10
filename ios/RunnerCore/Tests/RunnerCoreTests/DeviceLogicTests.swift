@testable import RunnerCore
import XCTest

final class JobTableTests: XCTestCase {
    private func job(_ id: Int = 1) throws -> Job {
        try Job(id: id, method: "act", params: ["_deadlineMs": 60_000])
    }

    func testACancelReachesTheJobOfItsOwnConnectionAlone() throws {
        let (mine, theirs) = (JobTable(), JobTable())
        let (own, other) = (try job(), try job())
        mine.add(own)
        theirs.add(other)
        theirs.cancel(1)
        XCTAssertTrue(other.cancelled)
        XCTAssertFalse(own.cancelled)
        mine.cancel(2)
        XCTAssertFalse(own.cancelled)
    }

    func testTheEndOfAJobLeavesAnotherOfItsIdWhereItIs() throws {
        let jobs = JobTable()
        let (old, new) = (try job(), try job())
        jobs.add(old)
        jobs.add(new)
        jobs.remove(old)
        jobs.cancel(1)
        XCTAssertTrue(new.cancelled)
    }

    func testAJobIsOverOnceCancelledOrPastItsDeadline() throws {
        let running = try job()
        XCTAssertFalse(running.over)
        running.cancelled = true
        XCTAssertTrue(running.over)
        XCTAssertTrue(try Job(id: 2, method: "act", params: ["_deadlineMs": 0]).over)
        XCTAssertThrowsError(try Job(id: 3, method: "act", params: [:]))
    }

    func testWorkThatBeginsOnceItsCallerStoppedWaitingFailsAsTheCallerWasTold() throws {
        XCTAssertNoThrow(try job().stillWaited(before: "typing"))
        let cancelled = try job()
        cancelled.cancelled = true
        XCTAssertThrowsError(try cancelled.stillWaited(before: "typing")) {
            XCTAssertEqual(($0 as? AgentError)?.code, "CANCELLED")
        }
        let late = try Job(id: 2, method: "act", params: ["_deadlineMs": 0])
        XCTAssertThrowsError(try late.stillWaited(before: "typing")) {
            XCTAssertEqual(($0 as? AgentError)?.code, "TIMEOUT")
        }
    }
}

final class TextCheckTests: XCTestCase {
    func testAFieldHoldsWhatWasTyped() {
        XCTAssertTrue(holdsText("abc", before: "", text: "abc", replace: true))
        XCTAssertTrue(holdsText("xabc", before: "x", text: "abc", replace: false))
        XCTAssertFalse(holdsText("ab", before: "", text: "abc", replace: true))
        XCTAssertFalse(holdsText("xabc", before: "", text: "abc", replace: true))
    }

    func testAFieldThatFormatsHoldsTheSameLettersAndDigits() {
        XCTAssertTrue(holdsText("(599) 999-9900", before: "", text: "5999999900", replace: true))
        XCTAssertTrue(holdsText("(599) 999", before: "(599)", text: "999", replace: false))
        XCTAssertFalse(holdsText("(599) 999-99", before: "", text: "5999999900", replace: true))
    }
}

final class RepeatedControlTests: XCTestCase {
    private func control(_ id: String?, flags: Int = Flag.visible, window: Int = 0) -> Node {
        Node(parent: -1, window: window, type: "Button", id: id, left: 0, top: 0, right: 10, bottom: 10, flags: flags)
    }

    func testTwoOrThreeOfAControlAreCopies() {
        let groups = repeatedControls([control("a"), control("b"), control("a"), control(nil), control(nil)])
        XCTAssertEqual(groups, [[0, 2]])
    }

    func testMoreAreAListsRowsAndOnlyTheAppsShownOnesCount() {
        XCTAssertEqual(repeatedControls([control("a"), control("a"), control("a"), control("a")]), [])
        XCTAssertEqual(repeatedControls([control("a"), control("a", flags: 0), control("a", window: 1)]), [])
    }

    func testACopyIsKnownByItsPlace() {
        var moved = control("a")
        moved.left = 5
        XCTAssertNotEqual(control("a").copyKey, moved.copyKey)
        XCTAssertEqual(control("a").copyKey, control("a").copyKey)
    }
}

final class BoxTests: XCTestCase {
    func testAFrameIsRoundedToAPlace() {
        XCTAssertEqual(box(CGRect(x: 1.4, y: 2.6, width: 10, height: 20)), [1, 3, 11, 23])
    }

    func testAFrameWithNoSizeToSpeakOfIsNoBox() {
        XCTAssertEqual(box(CGRect(x: 0, y: 0, width: CGFloat.infinity, height: 1)), [0, 0, 0, 0])
    }

    func testANullOrInfiniteFrameIsNoBox() {
        XCTAssertEqual(box(.null), [0, 0, 0, 0])
        XCTAssertEqual(box(.infinite), [0, 0, 0, 0])
        XCTAssertEqual(box(CGRect(x: CGFloat.nan, y: 0, width: 1, height: 1)), [0, 0, 0, 0])
    }
}

final class PeerTests: XCTestCase {
    private func address(_ text: String) -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: 16)
        XCTAssertEqual(inet_pton(AF_INET6, text, &bytes), 1, text)
        return bytes
    }

    func testATunnelsTwoEndsAreTheOnlyOnesLetIn() {
        XCTAssertTrue(tunnelEnds(local: address("fd12:3456:789a::1"), remote: address("fd12:3456:789a::2")))
        // a VPN's, a network's own, and a tunnel's ends the wrong way round or from another tunnel
        XCTAssertFalse(tunnelEnds(local: address("fd7a:115c:a1e0::5"), remote: address("fd7a:115c:a1e0::9")))
        XCTAssertFalse(tunnelEnds(local: address("fd12:3456:789a::1"), remote: address("fd12:3456:789a::7")))
        XCTAssertFalse(tunnelEnds(local: address("fd12:3456:789a::2"), remote: address("fd12:3456:789a::1")))
        XCTAssertFalse(tunnelEnds(local: address("fd12:3456:789a::1"), remote: address("fd99:3456:789a::2")))
        XCTAssertFalse(tunnelEnds(local: address("2001:db8::1"), remote: address("2001:db8::2")))
        XCTAssertFalse(tunnelEnds(local: [192, 168, 1, 61], remote: [192, 168, 1, 2]))
        XCTAssertFalse(tunnelEnds(local: [], remote: []))
    }
}
