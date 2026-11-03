import XCTest
@testable import RunnerCore

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

private func node(_ parent: Int, _ type: String, _ b: [Int], _ flags: Int = Flag.visible, text: String? = nil) -> Node {
    Node(parent: parent, window: 0, type: type, text: text, left: b[0], top: b[1], right: b[2], bottom: b[3], flags: flags)
}

final class LayoutTests: XCTestCase {
    func testTextWidthAndSmallMovesAreTheSameLayout() {
        let a = [node(-1, "Other", [0, 0, 400, 800]), node(0, "StaticText", [10, 100, 200, 120], text: "1")]
        let b = [node(-1, "Other", [0, 0, 400, 800]), node(0, "StaticText", [10, 102, 260, 122], text: "100")]
        XCTAssertTrue(sameLayout(a, b))
        XCTAssertEqual(layoutHash(a), layoutHash([a[0], node(0, "StaticText", [10, 100, 260, 120], text: "100")]))
    }

    func testANewNodeOrABigMoveIsAChange() {
        let a = [node(-1, "Other", [0, 0, 400, 800])]
        XCTAssertFalse(sameLayout(a, a + [node(0, "Button", [0, 0, 10, 10])]))
        XCTAssertFalse(sameLayout(a, [node(-1, "Other", [0, 20, 400, 820])]))
    }

    func testHitTest() {
        let nodes = [
            node(-1, "Other", [0, 0, 400, 800]),
            node(0, "Button", [0, 0, 400, 100], Flag.visible | Flag.clickable),
            node(1, "StaticText", [10, 10, 100, 30], text: "Go"),
            node(0, "StaticText", [0, 200, 400, 300], text: "Plain"),
            node(0, "WebView", [0, 400, 400, 800]),
        ]
        XCTAssertTrue(actionable(nodes, x: 20, y: 20)) // text inside a button
        XCTAssertFalse(actionable(nodes, x: 20, y: 250)) // plain text
        XCTAssertFalse(actionable(nodes, x: 20, y: 350)) // empty space
        XCTAssertTrue(actionable(nodes, x: 20, y: 500)) // web content
        XCTAssertTrue(actionable(nil, x: 0, y: 0)) // no screen known: careful
        XCTAssertTrue(actionable(nodes, x: 900, y: 900)) // off every node: careful
        let overlaid = nodes + [node(0, "Other", [0, 0, 400, 800])] // a transparent overlay on top
        XCTAssertTrue(actionable(overlaid, x: 20, y: 20))
        XCTAssertFalse(actionable(overlaid, x: 20, y: 350))
    }
}

final class ScrollIndicatorTests: XCTestCase {
    func testTheBarsOfAScrollContainerAreFoundByTheirShape() {
        let nodes = [
            node(-1, "Application", [0, 0, 402, 874]),
            node(0, "CollectionView", [0, 400, 402, 830]),
            node(1, "Cell", [16, 403, 196, 568]),
            node(1, "Other", [353, 403, 383, 812]),   // vertical bar along the right edge
            node(1, "Other", [34, 797, 368, 827]),    // horizontal bar along the bottom
            node(0, "Other", [380, 100, 402, 300]),   // a thin strip, but not in a scroll container
            node(1, "Other", [16, 600, 46, 640]),     // small, not along an edge
            node(3, "Image", [360, 403, 376, 500]),   // the bar's own drawing inside it
        ]
        XCTAssertEqual(scrollIndicators(nodes), [3, 4])
    }

    func testANamedOrParentNodeIsNoIndicator() {
        var bar = node(1, "Other", [353, 403, 383, 812])
        bar.id = "progress"
        var letter = node(3, "StaticText", [355, 410, 380, 430])
        letter.label = "A"
        let nodes = [node(-1, "Application", [0, 0, 402, 874]), node(0, "ScrollView", [0, 400, 402, 830]), bar,
                     node(1, "Other", [353, 403, 383, 812]), letter]
        XCTAssertEqual(scrollIndicators(nodes), [])
    }
}

final class SettlerTests: XCTestCase {
    final class Clock {
        var now = 0
    }

    func testSettlesAfterTheQuietWindowAndCatchesALateChange() {
        let c = Clock()
        let s = Settler(clock: { c.now }, sleep: { c.now += $0 })
        // the screen changes at 150 ms, then stays
        let r = s.run(actionAt: 0, quietMs: 200, maxMs: 3000, before: 0, read: { c.now >= 150 ? 1 : 0 },
                      same: ==, busy: { _ in false }, cancelled: { false })
        XCTAssertTrue(r.settled)
        XCTAssertEqual(r.last, 1)
        XCTAssertGreaterThanOrEqual(r.elapsedMs, 350)
    }

    func testOneSlowReadOfTheOldScreenIsNoProofOfQuiet() {
        let c = Clock()
        let s = Settler(clock: { c.now }, sleep: { c.now += $0 })
        var n = 0
        let r = s.run(actionAt: 0, quietMs: 200, maxMs: 3000, before: 0, read: { () -> Int in
            n += 1
            c.now += n == 1 ? 1500 : 10
            return n == 1 ? 0 : 1
        }, same: ==, busy: { _ in false }, cancelled: { false })
        XCTAssertTrue(r.settled)
        XCTAssertEqual(r.last, 1)
    }

    func testABusyScreenRunsToTheLimit() {
        let c = Clock()
        let s = Settler(clock: { c.now }, sleep: { c.now += $0 })
        let r = s.run(actionAt: 0, quietMs: 200, maxMs: 1000, before: 0, read: { 0 }, same: ==, busy: { _ in true },
                      cancelled: { false })
        XCTAssertFalse(r.settled)
        XCTAssertEqual(r.elapsedMs, 1000)
    }
}

final class WaitTests: XCTestCase {
    private var now = 1000

    /// Reads take 10 ms; `sigAt` is the screen's digest at that time after the start.
    private func go(since: String?, timeout: Int = 1000, min: Int = 300, stop: @escaping () -> AgentError? = { nil },
                    sigAt: (Int) -> String) throws -> WaitOutcome<String> {
        let start = now
        return try waitForChange(since: since, timeoutMs: timeout, minMs: min, clock: { now }, sleep: { now += $0 }, stop: stop,
                                 read: { now += 10; return sigAt(now - start) }, sig: { $0 })
    }

    func testEveryFieldCountsInTheDigest() {
        func sig(_ n: Node, _ w: [String] = ["w"]) -> String { screenSig([n], windows: w) }
        let n = Node(parent: -1, window: 0, type: "Button", id: "x", text: "a", label: "d", left: 0, top: 0, right: 10, bottom: 10, flags: 1)
        XCTAssertEqual(sig(n), sig(n))
        var others: [Node] = []
        for change in [{ $0.type = "Cell" }, { $0.id = "y" }, { $0.id = nil }, { $0.text = "b" }, { $0.text = nil }, { $0.text = "" },
                       { $0.label = "e" }, { $0.right = 11 }, { $0.flags = 3 }] as [(inout Node) -> Void] {
            var o = n
            change(&o)
            others.append(o)
        }
        for o in others { XCTAssertNotEqual(sig(n), sig(o)) }
        XCTAssertNotEqual(sig(n), sig(n, ["w2"]))
        XCTAssertNotEqual(sig(n), sig(n, []))
        XCTAssertNotEqual(sig(n), screenSig([n, n], windows: ["w"]))
        var moved = n
        moved.text = "ab"; moved.label = "c"
        var shifted = n
        shifted.text = "a"; shifted.label = "bc"
        XCTAssertNotEqual(sig(moved), sig(shifted))
    }

    func testWithoutSinceTheFirstReadIsTheAnswer() throws {
        let r = try go(since: nil) { _ in "A" }
        XCTAssertTrue(r.changed)
        XCTAssertEqual(r.last, "A")
        XCTAssertEqual(r.reads, 1)
    }

    func testAnEarlyChangeIsAnsweredOnceMinMsHasPassed() throws {
        let r = try go(since: "A") { $0 >= 100 ? "B" : "A" }
        XCTAssertTrue(r.changed)
        XCTAssertEqual(r.sig, "B")
        XCTAssertEqual(r.last, "B")
        XCTAssertTrue((300 ... 390).contains(r.elapsedMs), "answered at \(r.elapsedMs)")
    }

    func testAChangeThatWentBackBeforeMinMsIsNoChange() throws {
        XCTAssertFalse(try go(since: "A") { (50 ... 200).contains($0) ? "B" : "A" }.changed)
    }

    func testAStillScreenEndsAtTheTimeoutWithoutATree() throws {
        let r = try go(since: "A") { _ in "A" }
        XCTAssertFalse(r.changed)
        XCTAssertEqual(r.sig, "A")
        XCTAssertNil(r.last)
        XCTAssertTrue((1000 ... 1010).contains(r.elapsedMs), "ended at \(r.elapsedMs)")
        XCTAssertTrue((11 ... 13).contains(r.reads), "reads \(r.reads)")
    }

    func testATimeoutShorterThanMinMsStillTellsOfAChange() throws {
        let r = try go(since: "A", timeout: 100, min: 300) { _ in "B" }
        XCTAssertTrue(r.changed)
        XCTAssertEqual(r.last, "B")
    }

    func testStopFailsTheWait() {
        var polls = 0
        XCTAssertThrowsError(try go(since: "A", stop: {
            polls += 1
            return polls > 2 ? AgentError("CANCELLED", "cancelled") : nil
        }) { _ in "A" }) { XCTAssertEqual(($0 as? AgentError)?.code, "CANCELLED") }
    }
}

final class GestureTimelineTests: XCTestCase {
    func testFingersGoDownTogetherAndLiftAfterTheLastSampleOfAny() throws {
        let plan = try gestureTimeline([
            [(10, 10, 100), (20, 10, 200), (30, 10, 300)],
            [(50, 50, 100), (60, 50, 150)],
        ])
        XCTAssertEqual(plan.fingers[0].map(\.t), [0, 0.1, 0.2])
        XCTAssertEqual(plan.fingers[0].map(\.x), [10, 20, 30])
        XCTAssertEqual(plan.fingers[1].map(\.t), [0, 0.05])
        XCTAssertEqual(plan.liftAt, 0.21, accuracy: 0.0001)
    }

    func testAFingerThatStartsLaterStillGoesDownWithTheOthers() throws {
        let plan = try gestureTimeline([[(0, 0, 0), (1, 1, 200)], [(5, 5, 100), (6, 6, 200)]])
        XCTAssertEqual(plan.fingers[1].map(\.t), [0, 0.2])
    }

    func testTouchesWithoutMovesLastAsLongAsATap() throws {
        let plan = try gestureTimeline([[(0, 0, 0)], [(5, 5, 0)]])
        XCTAssertEqual(plan.liftAt, 0.05)
    }

    func testSamplesAtOneTimeGoAMillisecondApart() throws {
        let t = try gestureTimeline([[(0, 0, 0), (1, 1, 100), (2, 2, 100)]]).fingers[0].map(\.t)
        XCTAssertEqual(t[2], 0.101, accuracy: 0.0001)
    }

    func testBadGesturesAreRefused() {
        XCTAssertThrowsError(try gestureTimeline([]))
        XCTAssertThrowsError(try gestureTimeline([[(0, 0, 0)], []]))
        XCTAssertThrowsError(try gestureTimeline([[(0, 0, 100), (1, 1, 50)]]))
    }
}

final class ErrorTests: XCTestCase {
    func testWireCodesFollowTheProtocolOrder() {
        XCTAssertEqual(AgentError("TIMEOUT", "").rpcCode, -32000)
        XCTAssertEqual(AgentError("NOT_FOUND", "").rpcCode, -32008)
        XCTAssertEqual(AgentError("whatever", "").code, "INTERNAL")
        XCTAssertEqual(AgentError("INTERNAL", "").rpcCode, -32014)
    }

    func testTokens() {
        XCTAssertTrue(sameToken("abcdefghijklmnop", "abcdefghijklmnop"))
        XCTAssertFalse(sameToken("abcdefghijklmnop", "abcdefghijklmnoq"))
        XCTAssertFalse(sameToken("abc", "abcd"))
    }

    func testAToolbarOverTheWholeScreenIsAContainer() {
        let bar = Node(parent: 0, window: 0, type: "Toolbar", left: 0, top: 0, right: 428, bottom: 926, flags: Flag.visible)
        var resting = bar
        resting.top = 880
        var other = bar
        other.type = "Other"
        XCTAssertEqual(containerBars([resting, other, bar], screenW: 428, screenH: 926), [2])
    }
}
