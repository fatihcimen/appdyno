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

    func testABusyScreenRunsToTheLimit() {
        let c = Clock()
        let s = Settler(clock: { c.now }, sleep: { c.now += $0 })
        let r = s.run(actionAt: 0, quietMs: 200, maxMs: 1000, before: 0, read: { 0 }, same: ==, busy: { _ in true },
                      cancelled: { false })
        XCTAssertFalse(r.settled)
        XCTAssertEqual(r.elapsedMs, 1000)
    }
}

final class ErrorTests: XCTestCase {
    func testWireCodesFollowTheProtocolOrder() {
        XCTAssertEqual(AgentError("TIMEOUT", "").rpcCode, -32000)
        XCTAssertEqual(AgentError("NOT_FOUND", "").rpcCode, -32008)
        XCTAssertEqual(AgentError("whatever", "").code, "INTERNAL")
        XCTAssertEqual(AgentError("INTERNAL", "").rpcCode, -32013)
    }

    func testTokens() {
        XCTAssertTrue(sameToken("abcdefghijklmnop", "abcdefghijklmnop"))
        XCTAssertFalse(sameToken("abcdefghijklmnop", "abcdefghijklmnoq"))
        XCTAssertFalse(sameToken("abc", "abcd"))
    }
}
