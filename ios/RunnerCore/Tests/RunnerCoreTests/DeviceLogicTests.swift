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

    func testTheEndOfAConnectionCancelsEachOfItsJobsAlone() throws {
        let (mine, theirs) = (JobTable(), JobTable())
        let (queued, running, other) = (try job(1), try job(2), try job(1))
        mine.add(queued)
        mine.add(running)
        theirs.add(other)
        mine.cancelAll()
        XCTAssertTrue(queued.cancelled)
        XCTAssertTrue(running.cancelled)
        XCTAssertFalse(other.cancelled)
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

    func testEnterFollowsNoTextTheFieldReadBackAsOther() {
        XCTAssertFalse(submitsText(asked: true, verified: false))
        // read back as the text, or not readable (a secure field, a field gone): submitted as asked
        XCTAssertTrue(submitsText(asked: true, verified: true))
        XCTAssertTrue(submitsText(asked: true, verified: nil))
        XCTAssertFalse(submitsText(asked: false, verified: true))
    }

    func testAFieldThatFormatsHoldsTheSameLettersAndDigits() {
        XCTAssertTrue(holdsText("(599) 999-9900", before: "", text: "5999999900", replace: true))
        XCTAssertTrue(holdsText("(599) 999", before: "(599)", text: "999", replace: false))
        XCTAssertFalse(holdsText("(599) 999-99", before: "", text: "5999999900", replace: true))
    }

    func testTextReadBackAsOtherIsTypedAgainOnlyWhereNothingCanHaveBeenSent() {
        XCTAssertTrue(retypes(verified: false, known: true, text: "5999999900"))
        // a secure field has no verdict, and a field that held other text before has no known whole
        XCTAssertFalse(retypes(verified: nil, known: true, text: "hunter2"))
        XCTAssertFalse(retypes(verified: false, known: false, text: "abc"))
        XCTAssertFalse(retypes(verified: true, known: true, text: "abc"))
        // its Return may have sent the form already
        XCTAssertFalse(retypes(verified: false, known: true, text: "kapı\n"))
        XCTAssertFalse(retypes(verified: false, known: true, text: "a\r\nb"))
    }
}

/// A field that writes its digits as a phone number, rewriting itself `rewriteS` after each key it takes and dropping
/// a key that comes meanwhile; it answers a read once its rewrite is done, as an app answers a snapshot on its main
/// thread.
private final class FormattingField {
    var now = 0.0
    private var digits = ""
    private var busyUntil = 0.0
    private let rewriteS: Double
    private(set) var sent: [String] = []

    init(rewriteS: Double) { self.rewriteS = rewriteS }

    func type(_ keys: String) {
        sent.append(keys)
        for key in keys {
            if now >= busyUntil, key.isNumber {
                digits.append(key)
                busyUntil = now + rewriteS
            }
        }
    }

    func read() -> String {
        now = max(now, busyUntil)
        return digits.isEmpty ? "" : "(\(digits))"
    }
}

final class RegainFocusTests: XCTestCase {
    private struct Outcome {
        let held: Bool
        let taps: Int
        let now: Double
    }

    /// A field that holds the focus from `heldAt` on, once tapped `tapsToTake` times; the clock moves only by pauses.
    private func regain(heldAt: Double?, tapsToTake: Int = 1, over: Bool = false) -> Outcome {
        var now = 0.0, taps = 0
        let held = (try? regainFocus(waitS: 2, FocusProbe(
            holds: { taps >= tapsToTake && heldAt.map { now >= $0 } == true },
            tap: { taps += 1 }, clock: { now }, pause: { now += $0 }, over: { over }))) ?? false
        return Outcome(held: held, taps: taps, now: now)
    }

    func testAFieldThatHoldsTheFocusIsNotTapped() {
        let held = regain(heldAt: 0, tapsToTake: 0)
        XCTAssertTrue(held.held)
        XCTAssertEqual(held.taps, 0)
    }

    func testAFieldThatLetGoOfItIsTappedOnceAndWaitedFor() {
        let back = regain(heldAt: 0.5)
        XCTAssertTrue(back.held)
        XCTAssertEqual(back.taps, 1)
        XCTAssertGreaterThanOrEqual(back.now, 0.5)
    }

    func testAFieldThatDoesNotTakeItBackIsGivenUpAtTheWait() {
        let lost = regain(heldAt: nil)
        XCTAssertFalse(lost.held)
        XCTAssertEqual(lost.taps, 1)
        XCTAssertGreaterThanOrEqual(lost.now, 2)
        XCTAssertLessThan(lost.now, 2.2)
    }

    func testNothingIsWaitedForOnceTheCallerNoLongerWaits() {
        let gone = regain(heldAt: 1, over: true)
        XCTAssertFalse(gone.held)
        XCTAssertEqual(gone.now, 0)
    }
}

final class TypeEachTests: XCTestCase {
    private func typeEach(_ text: String, into field: FormattingField, over: @escaping () -> Bool = { false }) {
        try? RunnerCore.typeEach(text, waitS: 1.5, KeysProbe(send: field.type, read: field.read, clock: { field.now },
                                                             pause: { field.now += $0 }, over: over))
    }

    func testAFieldThatRewritesItselfSlowerThanTheKeysComeLosesNoneTypedOneByOne() {
        // the keys at 15 a second, as the runner typed them again: a rewrite of 0.1 s dropped every second one
        let fixed = FormattingField(rewriteS: 0.1)
        for key in "5999999900" {
            fixed.type(String(key))
            fixed.now += 1.0 / 15
        }
        XCTAssertNotEqual(fixed.read(), "(5999999900)")
        let field = FormattingField(rewriteS: 0.1)
        typeEach("5999999900", into: field)
        XCTAssertEqual(field.read(), "(5999999900)")
        XCTAssertEqual(field.sent.count, 10)
    }

    func testAKeyTheFieldNeverShowsSendsTheRestAtOnce() {
        let field = FormattingField(rewriteS: 0.01)
        typeEach("5a12", into: field)
        XCTAssertEqual(field.sent, ["5", "a", "12"])
        XCTAssertGreaterThanOrEqual(field.now, 1.5)
    }

    func testNothingMoreGoesOnceTheCallerNoLongerWaits() {
        let field = FormattingField(rewriteS: 0.01)
        typeEach("123", into: field, over: { field.sent.count >= 1 })
        XCTAssertEqual(field.sent, ["1"])
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

    func testGroupsComeInTheScreensOrder() {
        let nodes = [control("b"), control("a"), control("b"), control("a"), control("c"), control("c")]
        for _ in 0 ..< 20 { XCTAssertEqual(repeatedControls(nodes), [[0, 2], [1, 3], [4, 5]]) }
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
