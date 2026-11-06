import XCTest
@testable import RunnerCore

/// A JSON file of the repository: the fixtures both sides' tests read.
func repoJSON(_ path: String) throws -> Wire {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0 ..< 5 { root.deleteLastPathComponent() }
    let data = try Data(contentsOf: root.appendingPathComponent(path))
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? Wire)
}

extension Node {
    init(wire w: Wire) {
        let b = w["b"] as! [Int]
        self.init(parent: w["p"] as! Int, window: w["w"] as! Int, type: w["c"] as! String, id: w["id"] as? String,
                  text: w["t"] as? String, label: w["d"] as? String, hint: w["h"] as? String,
                  left: b[0], top: b[1], right: b[2], bottom: b[3], flags: w["f"] as! Int)
    }
}

/// The protocol's canonical JSON, `packages/protocol/fixtures`, which the host's tests hold to its schemas.
final class WireFixtureTests: XCTestCase {
    private func params(_ name: String) throws -> Wire {
        let requests = try repoJSON("packages/protocol/fixtures/requests.json")
        return try XCTUnwrap((requests[name] as? Wire)?["params"] as? Wire, name)
    }

    private func result(_ name: String) throws -> Wire {
        let results = try repoJSON("packages/protocol/fixtures/results.json")
        return try XCTUnwrap((results[name] as? Wire)?["result"] as? Wire, name)
    }

    private func same(_ actual: Wire, _ expected: Wire, line: UInt = #line) {
        XCTAssertEqual(actual as NSDictionary, expected as NSDictionary, line: line)
    }

    func testATapAsTheHostSendsIt() throws {
        let p = try params("act.tap")
        let action = try Action(XCTUnwrap(p["action"] as? Wire))
        XCTAssertEqual(action.tapPoint?.x, 100.5)
        XCTAssertEqual(action.tapPoint?.y, 200)
        let after = try AfterRequest(p)
        XCTAssertEqual(after.settle?.quietMs, 200)
        XCTAssertEqual(after.settle?.maxMs, 3000)
        XCTAssertEqual(after.read, "none")
        XCTAssertEqual(after.before, "abc")
    }

    func testTheOtherActionsAsTheHostSendsThem() throws {
        func action(_ name: String) throws -> Action { try Action(XCTUnwrap(params(name)["action"] as? Wire)) }
        guard case let .doubleTap(x, _) = try action("act.doubleTap") else { return XCTFail("doubleTap") }
        XCTAssertEqual(x, 10)
        guard case let .longPress(_, _, press) = try action("act.longPress") else { return XCTFail("longPress") }
        XCTAssertEqual(press, 800)
        guard case let .swipe(x0, y0, x1, y1, swipe) = try action("act.swipe") else { return XCTFail("swipe") }
        XCTAssertEqual([x0, y0, x1, y1, swipe], [1, 2, 3, 4, 300])
        guard case let .gesture(pointers) = try action("act.gesture") else { return XCTFail("gesture") }
        XCTAssertEqual(pointers.map(\.count), [2, 1])
        XCTAssertEqual(pointers[0][1].t, 100)
        guard case let .key(key, none) = try action("act.key") else { return XCTFail("key") }
        XCTAssertEqual(key, "enter")
        XCTAssertEqual(none, [])
        guard case let .key(letter, held) = try action("act.shortcut") else { return XCTFail("shortcut") }
        XCTAssertEqual(letter, "a")
        XCTAssertEqual(held, ["command", "shift"])
        XCTAssertNil(try AfterRequest(params("act.doubleTap")).settle)
    }

    func testAMissingValueIsTheCallersError() throws {
        var p = try params("text.set")
        p["focusTimeoutMs"] = nil
        XCTAssertThrowsError(try TextRequest(p)) { XCTAssertEqual(($0 as? AgentError)?.code, "INVALID_ARGUMENT") }
    }

    func testTextAsTheHostSendsIt() throws {
        let plain = try TextRequest(params("text.set"))
        XCTAssertEqual(plain.text, "merhaba dünya")
        XCTAssertFalse(plain.replace)
        XCTAssertFalse(plain.submit)
        XCTAssertNil(plain.at)
        XCTAssertEqual(plain.focusTimeoutMs, 5000)
        let at = try TextRequest(params("text.set.at"))
        XCTAssertTrue(at.replace && at.submit)
        XCTAssertEqual(at.at?.x, 12.5)
        XCTAssertEqual(at.after.read, "tree")
    }

    func testReadsAsTheHostSendsThem() throws {
        let tree = try TreeRequest(params("tree.get"))
        XCTAssertEqual(tree.maxDepth, 128)
        XCTAssertEqual(tree.maxNodes, 5000)
        let jpeg = try ShotRequest(params("screenshot"))
        XCTAssertFalse(jpeg.png)
        XCTAssertEqual(jpeg.quality, 80)
        XCTAssertNil(jpeg.maxPx)
        XCTAssertEqual(try ShotRequest(params("screenshot.png")).maxPx, 1024)
        XCTAssertEqual(try AuditRequest(params("audit")).maxIssues, 50)
        XCTAssertEqual(try AuditRequest(params("audit.types")).types ?? [], ["contrast", "hitRegion"])
        let wait = try WaitRequest(params("wait"))
        XCTAssertNil(wait.since)
        XCTAssertEqual(wait.minMs, 300)
        XCTAssertEqual(try WaitRequest(params("wait.since")).since, "abc")
    }

    func testTheRequestsOfOneValueAsTheHostSendsThem() throws {
        XCTAssertEqual(try OneValue.text(params("clipboard.set")), "a")
        XCTAssertEqual(try OneValue.pkg(params("app.target")), "dev.appdyno.fixture")
        XCTAssertEqual(try OneValue.rotation(params("orientation.set")), 1)
        XCTAssertEqual(try OneValue.id(params("cancel")), 7)
        let at = try OneValue.point(params("animations.wait"))
        XCTAssertEqual(at.x, 10)
        XCTAssertEqual(at.y, 20)
    }

    func testAHelloIsWhatTheHostTakes() throws {
        same(helloWire(agentVersion: "0.0.0", osVersion: "26.5", model: "iPhone17,3", w: 402, h: 874, density: 3, rotation: 0,
                       pid: 1234, idleShimChecked: true), try result("hello.ios"))
    }

    func testATreeIsWhatTheHostTakes() throws {
        let t = try result("tree.ios")
        let nodes = try XCTUnwrap(t["nodes"] as? [Wire]).map(Node.init(wire:))
        same(treeWire(windows: try XCTUnwrap(t["windows"] as? [Wire]), nodes: nodes, truncated: true, elapsedMs: 12,
                      hash: layoutHash(nodes)), t)
    }

    func testASettleATextAndAPictureAreWhatTheHostTakes() throws {
        same(settleWire(settled: true, ms: 240, reads: 3, quietMs: 200), try XCTUnwrap(result("act.settled")["settle"] as? Wire))
        same(settleWire(settled: true, ms: 240, reads: 3, quietMs: 200, idleMs: 800),
             try XCTUnwrap(result("act.watched")["settle"] as? Wire))
        same(textWire(focusMs: 2000, verified: nil), try result("text.keys"))
        same(shotWire(w: 540, h: 1200, png: false, bytes: 4096), try result("screenshot.jpeg"))
        same(shotWire(w: 540, h: 1200, png: true, bytes: 8192), try result("screenshot.png"))
    }

    func testAWaitAndAnAuditAreWhatTheHostTakes() throws {
        let changed = try result("wait.changed")
        same(waitWire(sig: "abc", changed: true, reads: 2, elapsedMs: 160, tree: changed["tree"] as? Wire), changed)
        same(waitWire(sig: "abc", changed: false, reads: 12, elapsedMs: 1000, tree: nil), try result("wait.same"))
        let issues = try XCTUnwrap(result("audit")["issues"] as? [Wire])
        same(auditIssueWire(type: "contrast", message: "Contrast failed", box: [1, 2, 3, 4],
                            element: ["c": "StaticText", "id": "x", "d": "y", "t": "z"]), issues[0])
        same(auditIssueWire(type: "hitRegion", message: "m", box: nil, element: nil), issues[1])
    }

    func testAnErrorIsWhatTheHostTakes() throws {
        let errors = try repoJSON("packages/protocol/fixtures/errors.json")
        for (name, value) in errors {
            let e = try XCTUnwrap(value as? Wire, name)
            let data = try XCTUnwrap(e["data"] as? Wire, name)
            same(AgentError(try XCTUnwrap(data["code"] as? String), try XCTUnwrap(e["message"] as? String),
                            hint: data["hint"] as? String).json, e)
        }
        same(unknownMethod("nope").json, try XCTUnwrap(errors["unknownMethod"] as? Wire))
    }
}
