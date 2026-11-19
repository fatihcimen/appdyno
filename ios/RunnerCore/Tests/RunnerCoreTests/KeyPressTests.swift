@testable import RunnerCore
import XCTest

/// A key on its way to `KeyField`: when it comes, and as it comes.
private struct Coming {
    let at: Double
    let key: String
    let modifiers: Set<String>
}

/// A text field taking hardware keys as UIKit does, which loses the keys `drops` numbers, the modifiers of those
/// `plain` numbers and adds shift to those `shifted` numbers, as XCTest's keys on a hosted Mac, its first key with a
/// modifier to an app and the keyboard's shift after text typed do, and takes each key `lateS` after it went; the clock
/// moves only by pauses.
private final class KeyField {
    var text: String
    var selection: Range<Int>
    var drops: Set<Int> = []
    var plain: Set<Int> = []
    var shifted: Set<Int> = []
    var lateS = 0.0
    var focused = true
    var now = 0.0
    private(set) var sent: [String] = []
    private var coming: [Coming] = []

    init(_ text: String, cursor: Int? = nil) {
        self.text = text
        let at = cursor ?? text.utf16.count
        selection = at ..< at
    }

    func press(_ key: String, _ modifiers: Set<String>) {
        sent.append((modifiers.sorted() + [key]).joined(separator: "+"))
        if !drops.contains(sent.count) {
            let held = plain.contains(sent.count) ? [] : shifted.contains(sent.count) ? ["shift"] : modifiers
            coming.append(Coming(at: now + lateS, key: key, modifiers: held))
        }
    }

    func read() -> KeyState? {
        for key in coming where key.at <= now { take(key.key, key.modifiers) }
        coming.removeAll { $0.at <= now }
        return focused ? KeyState(text: text, selection: selection) : nil
    }

    private func take(_ key: String, _ modifiers: Set<String>) {
        var units = Array(text.utf16)
        let at = selection.lowerBound
        switch (key, modifiers) {
        case ("a", ["command"]): selection = 0 ..< units.count
        case ("arrowLeft", []): selection = selection.isEmpty ? max(0, at - 1) ..< max(0, at - 1) : at ..< at
        case ("arrowRight", []):
            let to = selection.isEmpty ? min(units.count, at + 1) : selection.upperBound
            selection = to ..< to
        case ("arrowLeft", ["shift"]): selection = max(0, at - 1) ..< selection.upperBound
        case ("delete", []):
            let gone = selection.isEmpty ? max(0, at - 1) ..< at : selection
            units.removeSubrange(gone)
            selection = gone.lowerBound ..< gone.lowerBound
        default:
            let typed = modifiers == ["shift"] ? key.uppercased() : key
            units.replaceSubrange(selection, with: Array(typed.utf16))
            selection = at + typed.utf16.count ..< at + typed.utf16.count
        }
        text = String(decoding: units, as: UTF16.self)
    }

    func probe(over: @escaping () -> Bool = { false }) -> PressProbe {
        PressProbe(send: press, read: read, clock: { self.now }, pause: { self.now += $0 }, over: over)
    }
}

private func press(_ key: String, _ modifiers: Set<String> = [], into field: KeyField,
                   over: @escaping () -> Bool = { false }) -> Pressed? {
    try? pressSeen(key, modifiers, waitS: 1.5, field.probe(over: over))
}

/// What `keyTakes` says of a field after a key: it shows the key, shows something else, or the key cannot be read.
private enum Verdict {
    case takes, other, unread
}

private func verdict(_ test: ((KeyState) -> Bool)?, _ after: KeyState) -> Verdict {
    guard let test else { return .unread }
    return test(after) ? .takes : .other
}

final class KeyTakesTests: XCTestCase {
    private func takes(_ key: String, _ modifiers: Set<String> = [], _ text: String, _ selection: Range<Int>?,
                       _ after: String, _ then: Range<Int>?) -> Verdict {
        verdict(keyTakes(key, modifiers, from: KeyState(text: text, selection: selection)),
                KeyState(text: after, selection: then))
    }

    func testALetterTypedAtTheSelectionInItsCase() {
        XCTAssertEqual(takes("d", [], "abc", 3 ..< 3, "abcd", 4 ..< 4), .takes)
        // the keyboard's shift, still on after text typed into an empty field, made a capital of a hardware key
        XCTAssertEqual(takes("x", [], "ac", 2 ..< 2, "acX", 3 ..< 3), .other)
        XCTAssertEqual(takes("a", ["shift"], "", 0 ..< 0, "a", 1 ..< 1), .other)
        XCTAssertEqual(takes("5", [], "he", 0 ..< 2, "5", 1 ..< 1), .takes)
        // a field that formats what is typed
        XCTAssertEqual(takes("9", [], "(59", 3 ..< 3, "(599) ", 6 ..< 6), .takes)
        XCTAssertEqual(takes("d", ["control"], "abc", 3 ..< 3, "abc", 3 ..< 3), .unread)
    }

    func testAnArrowMovesTheCursorOrMakesASelectionFromIt() {
        XCTAssertEqual(takes("arrowLeft", [], "ac", 2 ..< 2, "ac", 1 ..< 1), .takes)
        XCTAssertEqual(takes("arrowRight", [], "abc", 0 ..< 2, "abc", 2 ..< 2), .takes)
        XCTAssertEqual(takes("arrowLeft", ["shift"], "xy", 2 ..< 2, "xy", 1 ..< 2), .takes)
        // shift lost on the way: the cursor moved alone
        XCTAssertEqual(takes("arrowLeft", ["shift"], "xy", 2 ..< 2, "xy", 1 ..< 1), .other)
        XCTAssertEqual(takes("arrowLeft", [], "ac", 0 ..< 0, "ac", 0 ..< 0), .unread)
        XCTAssertEqual(takes("arrowRight", [], "abc", 3 ..< 3, "abc", 3 ..< 3), .unread)
        XCTAssertEqual(takes("arrowLeft", ["shift"], "xy", 0 ..< 2, "xy", 0 ..< 1), .unread)
        XCTAssertEqual(takes("arrowLeft", [], "שלום", 4 ..< 4, "שלום", 3 ..< 3), .unread)
        XCTAssertEqual(takes("arrowLeft", [], "ac", nil, "ac", nil), .unread)
        XCTAssertEqual(takes("arrowUp", [], "ac", 2 ..< 2, "ac", 0 ..< 0), .unread)
        XCTAssertEqual(takes("arrowLeft", ["option"], "a b", 3 ..< 3, "a b", 2 ..< 2), .unread)
    }

    func testShortcutsLeaveWhatTheyDo() {
        XCTAssertEqual(takes("a", ["command"], "he", 2 ..< 2, "he", 0 ..< 2), .takes)
        XCTAssertEqual(takes("a", ["command"], "he", 2 ..< 2, "he", 2 ..< 2), .other)
        XCTAssertEqual(takes("a", ["command"], "he", 0 ..< 2, "he", 0 ..< 2), .unread)
        XCTAssertEqual(takes("a", ["command"], "", 0 ..< 0, "", 0 ..< 0), .unread)
        XCTAssertEqual(takes("x", ["command"], "abc", 0 ..< 2, "c", 0 ..< 0), .takes)
        XCTAssertEqual(takes("x", ["command"], "abc", 0 ..< 2, "xc", 1 ..< 1), .other)
        let copy = keyTakes("c", ["command"], from: KeyState(text: "ab", selection: 0 ..< 2, copies: 4))
        XCTAssertEqual(verdict(copy, KeyState(text: "ab", selection: 0 ..< 2, copies: 5)), .takes)
        XCTAssertEqual(verdict(copy, KeyState(text: "ab", selection: 0 ..< 2, copies: 4)), .other)
        // a pasteboard the runner cannot read, as on a phone
        XCTAssertEqual(takes("c", ["command"], "ab", 0 ..< 2, "ab", 0 ..< 2), .unread)
        let paste = keyTakes("v", ["command"], from: KeyState(text: "", selection: 0 ..< 0, pasteable: true))
        XCTAssertEqual(verdict(paste, KeyState(text: "ab", selection: 2 ..< 2, pasteable: true)), .takes)
        XCTAssertEqual(verdict(paste, KeyState(text: "v", selection: 1 ..< 1, pasteable: true)), .other)
        XCTAssertEqual(takes("v", ["command"], "", 0 ..< 0, "ab", 2 ..< 2), .unread)
        XCTAssertEqual(takes("z", ["command"], "ab", 2 ..< 2, "a", 1 ..< 1), .unread)
    }

    func testADeleteTakesWhereItHasSomethingToTake() {
        XCTAssertEqual(takes("delete", [], "he", 2 ..< 2, "h", 1 ..< 1), .takes)
        XCTAssertEqual(takes("delete", [], "he", 2 ..< 2, "he", 2 ..< 2), .other)
        XCTAssertEqual(takes("delete", [], "he", 0 ..< 0, "he", 0 ..< 0), .unread)
        XCTAssertEqual(takes("delete", [], "", 0 ..< 0, "", 0 ..< 0), .unread)
    }

    func testKeysTheAppActsOnAreNotRead() {
        for key in ["escape", "enter", "tab", "arrowDown"] {
            XCTAssertEqual(takes(key, [], "ab", 1 ..< 1, "ab", 1 ..< 1), .unread, key)
        }
    }

    func testWhatAKeyGoneInAsItsPlainKeyIsTakenBackBy() {
        let at = { (text: String, cursor: Int) in KeyState(text: text, selection: cursor ..< cursor) }
        XCTAssertEqual(takeBack(at("xy", 2), at("xy", 1)), "arrowRight")
        XCTAssertEqual(takeBack(at("he", 2), at("hea", 3)), "delete")
        XCTAssertEqual(takeBack(at("ab", 1), at("aVb", 2)), "delete")
        XCTAssertNil(takeBack(at("he", 2), at("h", 1)))
        XCTAssertNil(takeBack(at("ab", 2), at("abcd", 4)))
        XCTAssertNil(takeBack(KeyState(text: "ab", selection: 0 ..< 2), at("c", 1)))
    }
}

final class PressSeenTests: XCTestCase {
    func testASelectAllThatReachedNoAppIsSentAgainAndTheDeleteThenTakesAll() {
        // as on the hosted Mac: "he", ⌘A lost, delete, 5 read "h5"
        let blind = KeyField("he")
        blind.drops = [1]
        for (key, modifiers) in [("a", Set(["command"])), ("delete", []), ("5", [])] { blind.press(key, modifiers) }
        _ = blind.read()
        XCTAssertEqual(blind.text, "h5")

        let field = KeyField("he")
        field.drops = [1]
        XCTAssertEqual(press("a", ["command"], into: field), Pressed(seen: true, sent: 2))
        XCTAssertEqual(press("delete", into: field), Pressed(seen: true, sent: 1))
        XCTAssertEqual(press("5", into: field), Pressed(seen: true, sent: 1))
        XCTAssertEqual(field.text, "5")
    }

    func testALetterLostAfterAnArrowIsSentAgain() {
        let field = KeyField("abc", cursor: 2)
        field.drops = [2]
        XCTAssertEqual(press("arrowRight", into: field), Pressed(seen: true, sent: 1))
        XCTAssertEqual(press("d", into: field), Pressed(seen: true, sent: 2))
        XCTAssertEqual(field.text, "abcd")
    }

    func testAShiftArrowThatMovedTheCursorAloneIsTakenBackAndSentAgain() {
        let field = KeyField("xy")
        field.plain = [1]
        XCTAssertEqual(press("arrowLeft", ["shift"], into: field), Pressed(seen: true, sent: 2))
        XCTAssertEqual(field.sent, ["shift+arrowLeft", "arrowRight", "shift+arrowLeft"])
        XCTAssertEqual(field.selection, 1 ..< 2)
        XCTAssertEqual(press("delete", into: field), Pressed(seen: true, sent: 1))
        XCTAssertEqual(field.text, "x")
    }

    func testACapitalThatCameSmallIsTakenBackAndSentAgain() {
        let field = KeyField("ac")
        field.plain = [1]
        XCTAssertEqual(press("b", ["shift"], into: field), Pressed(seen: true, sent: 2))
        XCTAssertEqual(field.text, "acB")
    }

    func testALetterTheKeyboardsShiftMadeACapitalIsTakenBackAndSentAgain() {
        let field = KeyField("ac")
        field.shifted = [1]
        XCTAssertEqual(press("x", into: field), Pressed(seen: true, sent: 2))
        XCTAssertEqual(field.sent, ["x", "delete", "x"])
        XCTAssertEqual(field.text, "acx")
    }

    func testAKeyThatComesLateIsWaitedForAndGoesOnce() {
        let field = KeyField("ab")
        field.lateS = 1.2
        XCTAssertEqual(press("c", into: field), Pressed(seen: true, sent: 1))
        XCTAssertEqual(field.text, "abc")
        XCTAssertLessThan(field.now, 1.5)
    }

    func testAKeyNeverSeenGoesTwiceAndIsSaidLost() {
        let field = KeyField("ab")
        field.drops = [1, 2]
        XCTAssertEqual(press("c", into: field), Pressed(seen: false, sent: 2))
        XCTAssertEqual(field.text, "ab")
        XCTAssertGreaterThanOrEqual(field.now, 3)
    }

    func testAKeyThatWentInOtherwiseIsSaidSoAndNotSentAgain() {
        // ⌘X of a selection, gone in as an x in its place: what it replaced cannot be put back
        let field = KeyField("ab")
        field.selection = 0 ..< 2
        field.plain = [1]
        XCTAssertEqual(press("x", ["command"], into: field), Pressed(seen: false, sent: 1))
        XCTAssertEqual(field.text, "x")
    }

    func testAFieldThatLetGoOfTheFocusTakesNoSecondKey() {
        let field = KeyField("ab")
        field.drops = [1]
        let probe = PressProbe(send: { field.press($0, $1); field.focused = false }, read: field.read,
                               clock: { field.now }, pause: { field.now += $0 }, over: { false })
        XCTAssertEqual(try pressSeen("c", [], waitS: 1.5, probe), Pressed(seen: false, sent: 1))
        XCTAssertEqual(field.sent.count, 1)
    }

    func testAKeyWhoseDoingCannotBeReadGoesOnce() {
        let field = KeyField("ab")
        XCTAssertEqual(press("escape", into: field), Pressed(seen: nil, sent: 1))
        field.focused = false
        XCTAssertEqual(press("c", into: field), Pressed(seen: nil, sent: 1))
        XCTAssertEqual(field.now, 0)
    }

    func testNoSecondKeyGoesOnceTheCallerNoLongerWaits() {
        let field = KeyField("ab")
        field.drops = [1]
        XCTAssertEqual(press("c", into: field, over: { field.sent.count >= 1 }), Pressed(seen: false, sent: 1))
        XCTAssertEqual(field.sent.count, 1)
    }
}
