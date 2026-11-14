@testable import RunnerCore
import XCTest

final class FrameTests: XCTestCase {
    func testRoundTripAcrossChunks() throws {
        let json = Data(#"{"jsonrpc":"2.0","id":1}"#.utf8)
        var wire = encodeBinary(id: 7, Data([1, 2, 3]))
        wire.append(encodeJSON(json))
        let d = FrameDecoder()
        var frames: [Frame] = []
        for b in wire { frames += try d.push(Data([b])) }
        XCTAssertEqual(frames, [.binary(id: 7, data: Data([1, 2, 3])), .json(json)])
    }

    func testRejectsHugeAndUnknownFrames() {
        XCTAssertThrowsError(try FrameDecoder().push(Data([0x7f, 0xff, 0xff, 0xff, 0])))
        XCTAssertThrowsError(try FrameDecoder().push(Data([0, 0, 0, 0, 9])))
    }
}

final class SettlerTests: XCTestCase {
    private final class Clock {
        var now = 0
    }

    func testSettlesAfterTheQuietWindowAndCatchesALateChange() {
        let c = Clock()
        let settler = Settler(clock: { c.now }, sleep: { c.now += $0 })
        // the screen changes at 150 ms, then stays
        let outcome = settler.run(actionAt: 0, quietMs: 200, maxMs: 3000, before: 0,
                                  probe: SettleProbe(read: { c.now >= 150 ? 1 : 0 }, same: ==, busy: { _ in false },
                                                     cancelled: { false }))
        XCTAssertTrue(outcome.settled)
        XCTAssertEqual(outcome.last, 1)
        XCTAssertGreaterThanOrEqual(outcome.elapsedMs, 350)
    }

    func testOneSlowReadOfTheOldScreenIsNoProofOfQuiet() {
        let c = Clock()
        let settler = Settler(clock: { c.now }, sleep: { c.now += $0 })
        var count = 0
        let read = { () -> Int in
            count += 1
            c.now += count == 1 ? 1500 : 10
            return count == 1 ? 0 : 1
        }
        let outcome = settler.run(actionAt: 0, quietMs: 200, maxMs: 3000, before: 0,
                                  probe: SettleProbe(read: read, same: ==, busy: { _ in false }, cancelled: { false }))
        XCTAssertTrue(outcome.settled)
        XCTAssertEqual(outcome.last, 1)
    }

    func testACreepUnderTheToleranceBetweenReadsIsStillAMove() {
        // a sheet easing in: 3 pt a read, where two layouts 4 pt apart are the same
        func creep(to: Int) -> SettleOutcome<Int> {
            let c = Clock()
            var at = 0
            return Settler(clock: { c.now }, sleep: { c.now += $0 }).run(
                actionAt: 0, quietMs: 200, maxMs: 2000, before: 0,
                probe: SettleProbe(read: { at = min(at + 3, to); return at }, same: { abs($0 - $1) <= layoutTolerance },
                                   busy: { _ in false }, cancelled: { false }))
        }
        XCTAssertFalse(creep(to: .max).settled)
        let stops = creep(to: 30)
        XCTAssertTrue(stops.settled)
        XCTAssertEqual(stops.last, 30)
    }

    func testABusyScreenRunsToTheLimit() {
        let c = Clock()
        let settler = Settler(clock: { c.now }, sleep: { c.now += $0 })
        let outcome = settler.run(actionAt: 0, quietMs: 200, maxMs: 1000, before: 0,
                                  probe: SettleProbe(read: { 0 }, same: ==, busy: { _ in true }, cancelled: { false }))
        XCTAssertFalse(outcome.settled)
        XCTAssertEqual(outcome.elapsedMs, 1000)
    }
}

final class WaitTests: XCTestCase {
    private var now = 1000

    /// Reads take 10 ms; `sigAt` is the screen's digest at that time after the start.
    private func go(since: String?, timeout: Int = 1000, min: Int = 300,
                    stop: @escaping () -> AgentError? = { nil }, sigAt: (Int) -> String) throws -> WaitOutcome<String> {
        let start = now
        let settler = Settler(clock: { self.now }, sleep: { self.now += $0 })
        return try settler.waitForChange(WaitRequest(since: since, timeoutMs: timeout, minMs: min), stop: stop,
                                         read: { now += 10; return sigAt(now - start) }, sig: { $0 })
    }

    func testEveryFieldCountsInTheDigest() {
        func sig(_ node: Node, _ w: [String] = ["w"]) -> String { screenSig([node], windows: w) }
        let node = Node(parent: -1, window: 0, type: "Button", id: "x", text: "a", label: "d",
                        left: 0, top: 0, right: 10, bottom: 10, flags: 1)
        XCTAssertEqual(sig(node), sig(node))
        var others: [Node] = []
        let changes: [(inout Node) -> Void] = [
            { $0.type = "Cell" }, { $0.id = "y" }, { $0.id = nil }, { $0.text = "b" }, { $0.text = nil },
            { $0.text = "" }, { $0.label = "e" }, { $0.right = 11 }, { $0.flags = 3 }
        ]
        for change in changes {
            var other = node
            change(&other)
            others.append(other)
        }
        for other in others { XCTAssertNotEqual(sig(node), sig(other)) }
        XCTAssertNotEqual(sig(node), sig(node, ["w2"]))
        XCTAssertNotEqual(sig(node), sig(node, []))
        XCTAssertNotEqual(sig(node), screenSig([node, node], windows: ["w"]))
        var moved = node
        moved.text = "ab"; moved.label = "c"
        var shifted = node
        shifted.text = "a"; shifted.label = "bc"
        XCTAssertNotEqual(sig(moved), sig(shifted))
    }

    func testWithoutSinceTheFirstReadIsTheAnswer() throws {
        let outcome = try go(since: nil) { _ in "A" }
        XCTAssertTrue(outcome.changed)
        XCTAssertEqual(outcome.last, "A")
        XCTAssertEqual(outcome.reads, 1)
    }

    func testAnEarlyChangeIsAnsweredOnceMinMsHasPassed() throws {
        let outcome = try go(since: "A") { $0 >= 100 ? "B" : "A" }
        XCTAssertTrue(outcome.changed)
        XCTAssertEqual(outcome.sig, "B")
        XCTAssertEqual(outcome.last, "B")
        XCTAssertTrue((300 ... 390).contains(outcome.elapsedMs), "answered at \(outcome.elapsedMs)")
    }

    func testAChangeThatWentBackBeforeMinMsIsNoChange() throws {
        XCTAssertFalse(try go(since: "A") { (50 ... 200).contains($0) ? "B" : "A" }.changed)
    }

    func testAStillScreenEndsAtTheTimeoutWithoutATree() throws {
        let outcome = try go(since: "A") { _ in "A" }
        XCTAssertFalse(outcome.changed)
        XCTAssertEqual(outcome.sig, "A")
        XCTAssertNil(outcome.last)
        XCTAssertTrue((1000 ... 1010).contains(outcome.elapsedMs), "ended at \(outcome.elapsedMs)")
        XCTAssertTrue((11 ... 13).contains(outcome.reads), "reads \(outcome.reads)")
    }

    func testATimeoutShorterThanMinMsStillTellsOfAChange() throws {
        let outcome = try go(since: "A", timeout: 100, min: 300) { _ in "B" }
        XCTAssertTrue(outcome.changed)
        XCTAssertEqual(outcome.last, "B")
    }

    func testStopFailsTheWait() {
        var polls = 0
        XCTAssertThrowsError(try go(since: "A", stop: {
            polls += 1
            return polls > 2 ? AgentError("CANCELLED", "cancelled") : nil
        }, sigAt: { _ in "A" })) { XCTAssertEqual(($0 as? AgentError)?.code, "CANCELLED") }
    }
}

final class GestureTimelineTests: XCTestCase {
    private func sample(_ x: Double, _ y: Double, _ t: Double) -> GesturePoint { GesturePoint(x: x, y: y, t: t) }

    func testADeviceLyingFlatSaysNoTurnAndATurnedOneItsInterfacesTurn() {
        XCTAssertEqual([1, 2, 3, 4].map { interfaceTurn(device: $0) }, [1, 2, 4, 3])
        // unknown, face up, face down: an app may stand in landscape on a phone lying on a desk
        XCTAssertEqual([0, 5, 6].map { interfaceTurn(device: $0) }, [nil, nil, nil])
    }

    func testATouchOnADeviceLyingFlatGoesUprightWhereTheAppStandsTallAndNoWayWhereItIsWide() {
        let tall = (w: 402.0, h: 874.0), wide = (w: 874.0, h: 402.0)
        XCTAssertEqual([0, 5, 6].map { touchTurn(device: $0, app: tall, pad: false) }, [1, 1, 1])
        XCTAssertEqual([0, 5, 6].map { touchTurn(device: $0, app: wide, pad: false) }, [nil, nil, nil])
        XCTAssertNil(touchTurn(device: 5, app: nil, pad: false))
        // a device that says its turn is taken at its word, whatever the app's shape
        XCTAssertEqual([1, 3, 4].map { touchTurn(device: $0, app: wide, pad: false) }, [1, 4, 3])
    }

    func testATallAppOnAnIPadLyingFlatSaysNoTurn() {
        // a window beside another on a screen in landscape, or an iPad upside down: tall is no portrait there
        let tall = (w: 507.0, h: 834.0)
        XCTAssertEqual([0, 5, 6].map { touchTurn(device: $0, app: tall, pad: true) }, [nil, nil, nil])
        XCTAssertEqual([1, 2, 3, 4].map { touchTurn(device: $0, app: tall, pad: true) }, [1, 2, 4, 3])
    }

    func testTheHomeScreenAppsUprightFramesTurnToTheLandscapeAppsSpace() {
        let upright = CGRect(x: 0, y: 0, width: 820, height: 1180), wide = CGRect(x: 0, y: 0, width: 1180, height: 820)
        // an iPad's notification prompt over an app in landscape: Allow listed at 356,664, drawn at 664,464
        let allow = CGRect(x: 332, y: 594, width: 48, height: 140)
        XCTAssertEqual(turnedFrame(allow, window: upright, device: 3), CGRect(x: 594, y: 440, width: 140, height: 48))
        XCTAssertEqual(turnedFrame(allow, window: upright, device: 4), CGRect(x: 446, y: 332, width: 140, height: 48))
        // the whole window is the whole screen as it stands
        XCTAssertEqual(turnedFrame(upright, window: upright, device: 3), wide)
        XCTAssertEqual(turnedFrame(upright, window: upright, device: 4), wide)
        // a window that turned with the app, a device upright or lying flat: as it is
        XCTAssertEqual(turnedFrame(allow, window: wide, device: 3), allow)
        XCTAssertEqual(turnedFrame(allow, window: upright, device: 1), allow)
        XCTAssertEqual(turnedFrame(allow, window: upright, device: 5), allow)
    }

    func testTheHomeScreenAppTurnsWithTheAppItShowsSomethingOver() {
        let upright = CGRect(x: 0, y: 0, width: 402, height: 874), wide = CGRect(x: 0, y: 0, width: 874, height: 402)
        // read as itself turned, after a read of the home screen upright: an iPhone's first prompt of a fresh app
        XCTAssertTrue(turnsHomeScreen(window: upright, device: 3, root: wide, last: upright))
        // read upright, as XCTest had it under an iPad's app in landscape: as that app stood
        XCTAssertTrue(turnsHomeScreen(window: upright, device: 4, root: upright, last: wide))
        XCTAssertTrue(turnsHomeScreen(window: upright, device: 3, root: upright, last: nil))
        // an app that stayed upright on a turned phone, a device upright or lying flat, a window turned already
        XCTAssertFalse(turnsHomeScreen(window: upright, device: 3, root: upright, last: upright))
        XCTAssertFalse(turnsHomeScreen(window: upright, device: 1, root: wide, last: wide))
        XCTAssertFalse(turnsHomeScreen(window: upright, device: 5, root: wide, last: wide))
        XCTAssertFalse(turnsHomeScreen(window: wide, device: 3, root: wide, last: wide))
    }

    func testFingersGoDownTogetherAndLiftAfterTheLastSampleOfAny() throws {
        let plan = try gestureTimeline([
            [sample(10, 10, 100), sample(20, 10, 200), sample(30, 10, 300)],
            [sample(50, 50, 100), sample(60, 50, 150)]
        ])
        XCTAssertEqual(plan.fingers[0].map(\.t), [0, 0.1, 0.2])
        XCTAssertEqual(plan.fingers[0].map(\.x), [10, 20, 30])
        XCTAssertEqual(plan.fingers[1].map(\.t), [0, 0.05])
        XCTAssertEqual(plan.liftAt, 0.21, accuracy: 0.0001)
    }

    func testAFingerThatStartsLaterStillGoesDownWithTheOthers() throws {
        let plan = try gestureTimeline([[sample(0, 0, 0), sample(1, 1, 200)], [sample(5, 5, 100), sample(6, 6, 200)]])
        XCTAssertEqual(plan.fingers[1].map(\.t), [0, 0.2])
    }

    func testTouchesWithoutMovesLastAsLongAsATap() throws {
        let plan = try gestureTimeline([[sample(0, 0, 0)], [sample(5, 5, 0)]])
        XCTAssertEqual(plan.liftAt, 0.05)
    }

    func testSamplesAtOneTimeGoAMillisecondApart() throws {
        let t = try gestureTimeline([[sample(0, 0, 0), sample(1, 1, 100), sample(2, 2, 100)]]).fingers[0].map(\.t)
        XCTAssertEqual(t[2], 0.101, accuracy: 0.0001)
    }

    func testBadGesturesAreRefused() {
        XCTAssertThrowsError(try gestureTimeline([]))
        XCTAssertThrowsError(try gestureTimeline([[sample(0, 0, 0)], []]))
        XCTAssertThrowsError(try gestureTimeline([[sample(0, 0, 100), sample(1, 1, 50)]]))
    }
}

final class ErrorTests: XCTestCase {
    func testWireCodesFollowTheProtocolOrder() {
        XCTAssertEqual(AgentError("TIMEOUT", "").rpcCode, -32000)
        XCTAssertEqual(AgentError("NOT_FOUND", "").rpcCode, -32008)
        XCTAssertEqual(AgentError("whatever", "").code, "INTERNAL")
        XCTAssertEqual(AgentError("INTERNAL", "").rpcCode, -32015)
    }

    func testTokens() {
        XCTAssertTrue(sameToken("abcdefghijklmnop", "abcdefghijklmnop"))
        XCTAssertFalse(sameToken("abcdefghijklmnop", "abcdefghijklmnoq"))
        XCTAssertFalse(sameToken("abc", "abcd"))
    }

    func testOnlyARefusedSynthesizedEventIsDoneAgainAndOneWithNoAnswerIsATimeout() throws {
        XCTAssertTrue(try synthesized(true, "a tap"))
        XCTAssertFalse(try synthesized(false, "a tap"))
        XCTAssertThrowsError(try synthesized(nil, "a tap")) { XCTAssertEqual(($0 as? AgentError)?.code, "TIMEOUT") }
    }

    func testAQuestionXCTestFailedHasNoAnswerAndItsIssueGoesNoFurther() {
        _ = IssueTrap.take()
        var kept = true
        // what the runner's test does with an issue XCTest records while the question is asked
        let answer = IssueTrap.answer { () -> Bool in
            kept = IssueTrap.keep("Failed to determine hittability of \"AdditionalDimmingOverlay\" Image")
            return false
        }
        XCTAssertNil(answer)
        XCTAssertFalse(kept)
        XCTAssertNil(IssueTrap.take())
    }

    func testAnIssueOutsideAQuestionIsTheRequestsError() {
        _ = IssueTrap.take()
        XCTAssertTrue(IssueTrap.answer { true } ?? false)
        XCTAssertTrue(IssueTrap.keep("Neither element nor any descendant has keyboard focus"))
        XCTAssertEqual(IssueTrap.take(), "Neither element nor any descendant has keyboard focus")
    }
}
