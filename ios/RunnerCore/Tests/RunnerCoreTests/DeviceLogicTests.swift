import XCTest
@testable import RunnerCore

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
}
