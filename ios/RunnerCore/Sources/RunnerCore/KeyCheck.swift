import Foundation

/// What a key can be seen to change where it goes: the text of the field with the keyboard focus, its selection in
/// UTF-16 offsets (the cursor where it is empty; nil where it cannot be read), the pasteboard's change count, which a
/// copy moves (nil where it cannot be read), and whether the pasteboard holds text, which a paste needs.
public struct KeyState: Equatable {
    public let text: String
    public let selection: Range<Int>?
    public let copies: Int?
    public let pasteable: Bool

    public init(text: String, selection: Range<Int>?, copies: Int? = nil, pasteable: Bool = false) {
        self.text = text
        self.selection = selection
        self.copies = copies
        self.pasteable = pasteable
    }
}

/// Text that runs right to left, whose arrows move the cursor the other way.
private func rightToLeft(_ text: String) -> Bool {
    text.unicodeScalars.contains { (0x0590 ... 0x08FF).contains($0.value) || (0xFB1D ... 0xFEFC).contains($0.value) }
}

/// `text` with the UTF-16 range `range` put in place of by `with`.
private func replacing(_ text: String, _ range: Range<Int>, with: String) -> String {
    var units = Array(text.utf16)
    guard range.upperBound <= units.count else { return text }
    units.replaceSubrange(range, with: Array(with.utf16))
    return String(decoding: units, as: UTF16.self)
}

/// Whether a field shows `expected`, or the same letters and digits where it formats what is typed.
private func shows(_ now: String, _ expected: String) -> Bool {
    now == expected || lettersAndDigits(now) == lettersAndDigits(expected)
}

/// What an arrow across the line leaves: the cursor gone that way, a selection ended, or with shift one made from the
/// cursor. Nil where nothing can move that way, or which end of a selection shift moves is not known.
private func arrowTakes(left: Bool, extending: Bool, from before: KeyState) -> ((KeyState) -> Bool)? {
    guard let was = before.selection, !rightToLeft(before.text) else { return nil }
    if !extending, !was.isEmpty { return { $0.selection?.isEmpty == true } }
    let at = was.lowerBound
    guard was.isEmpty, left ? at > 0 : at < before.text.utf16.count else { return nil }
    if extending { return { $0.selection.map { !$0.isEmpty && (left ? $0.upperBound : $0.lowerBound) == at } == true } }
    return { $0.selection.map { $0.isEmpty && (left ? $0.lowerBound < at : $0.lowerBound > at) } == true }
}

/// What a letter with command held leaves: ⌘A all selected, ⌘C the pasteboard written, ⌘X the selection gone, ⌘V text
/// put in. Nil for another, or where it has nothing to do.
private func shortcutTakes(_ key: String, from before: KeyState, _ was: Range<Int>) -> ((KeyState) -> Bool)? {
    let length = before.text.utf16.count
    switch key {
    case "a" where length > 0 && was != 0 ..< length: return { $0.selection == 0 ..< $0.text.utf16.count }
    case "c" where !was.isEmpty && before.copies != nil: return { $0.copies != before.copies }
    case "x" where !was.isEmpty: return { $0.text == replacing(before.text, was, with: "") }
    // shortcut: a paste of text that is the letter v itself reads as the plain key, which is taken back and said
    case "v" where before.pasteable: return { $0 != before && $0.text != replacing(before.text, was, with: key) }
    default: return nil
    }
}

/**
 * What a key into a field that stood as `before` leaves there, as a test of the field after it (`modifiers` by the
 * runner's names): a letter, digit or space typed at the selection in its case, a delete with something to take, an
 * arrow across the line where it can move, a shortcut of command (`shortcutTakes`). Nil where what it does cannot be
 * told: a key whose doing is the app's own (enter, tab, escape, another shortcut), an arrow up or down or with option
 * or command, text that runs right to left, a selection that cannot be read.
 */
public func keyTakes(_ key: String, _ modifiers: Set<String>, from before: KeyState) -> ((KeyState) -> Bool)? {
    guard let was = before.selection else { return nil }
    let plain = modifiers.isSubset(of: ["shift"])
    switch key {
    case "arrowLeft", "arrowRight":
        return plain ? arrowTakes(left: key == "arrowLeft", extending: !modifiers.isEmpty, from: before) : nil
    case "delete":
        guard modifiers.isEmpty, !was.isEmpty || was.lowerBound > 0 else { return nil }
        return { $0.text != before.text }
    case "space":
        return plain ? { $0.text == replacing(before.text, was, with: " ") } : nil
    case _ where key.count != 1:
        return nil
    case _ where modifiers == ["command"]:
        return shortcutTakes(key, from: before, was)
    default:
        let expected = replacing(before.text, was, with: modifiers.isEmpty ? key : key.uppercased())
        return plain ? { shows($0.text, expected) } : nil
    }
}

/// The plain key that takes back a key gone in as the plain key of its letter or arrow, as XCTest's first key with a
/// modifier to an app came (shift+arrow moved the cursor alone): the other arrow after a cursor moved, delete after one
/// character typed at it. Nil where the field changed otherwise.
public func takeBack(_ before: KeyState, _ now: KeyState) -> String? {
    guard let was = before.selection, was.isEmpty, let at = now.selection, at.isEmpty else { return nil }
    if now.text == before.text, at != was { return at.lowerBound < was.lowerBound ? "arrowRight" : "arrowLeft" }
    let old = Array(before.text.utf16), new = Array(now.text.utf16)
    guard was.lowerBound <= old.count, at.lowerBound > was.lowerBound, at.lowerBound <= new.count,
          new.count == old.count + at.lowerBound - was.lowerBound,
          new[..<was.lowerBound] == old[..<was.lowerBound], new[at.lowerBound...] == old[was.lowerBound...],
          String(decoding: new[was.lowerBound ..< at.lowerBound], as: UTF16.self).count == 1
    else { return nil }
    return "delete"
}

/// What `pressSeen` asks of its caller: a key sent with its modifiers, what keys can change (nil: no field holds the
/// focus, or one that cannot be read back, as a secure field), the time in seconds, a pause, and whether the caller no
/// longer waits.
public struct PressProbe {
    public let send: (String, Set<String>) throws -> Void
    public let read: () -> KeyState?
    public let clock: () -> Double
    public let pause: (Double) -> Void
    public let over: () -> Bool
}

/// A key `pressSeen` sent: whether the field shows it (nil: what it does cannot be read), and how many times it went.
public struct Pressed: Equatable {
    public let seen: Bool?
    public let sent: Int
}

/// The field once it `passes`, else as it stands after `waitS`, or once the caller no longer waits; nil once no
/// field holds the focus.
private func until(_ passes: (KeyState) -> Bool, waitS: Double, _ p: PressProbe) -> KeyState? {
    let end = p.clock() + waitS
    while true {
        guard let now = p.read() else { return nil }
        if passes(now) || p.over() || p.clock() >= end { return now }
        p.pause(0.05)
    }
}

/**
 * A key into the field with the focus, read back: seen once the field shows what it does (`keyTakes`), within `waitS`
 * of its sending. A key the field shows nothing of after that is sent once more, as on a hosted Mac XCTest's keys
 * reached no app now and then (⌘A selected nothing, so the delete after it took one letter; a letter after an arrow
 * went nowhere). One gone in as its plain key is taken back (`takeBack`) and sent once more. Not seen then, or with the
 * field letting go of the focus, it is said so. A key whose doing cannot be read is sent once.
 */
public func pressSeen(_ key: String, _ modifiers: Set<String>, waitS: Double, _ p: PressProbe) throws -> Pressed {
    guard let before = p.read(), let takes = keyTakes(key, modifiers, from: before) else {
        try p.send(key, modifiers)
        return Pressed(seen: nil, sent: 1)
    }
    var sent = 0
    while sent < 2, !p.over() {
        try p.send(key, modifiers)
        sent += 1
        guard let now = until(takes, waitS: waitS, p) else { break }
        if takes(now) { return Pressed(seen: true, sent: sent) }
        if now == before { continue }
        guard sent < 2, !p.over(), let back = takeBack(before, now) else { break }
        try p.send(back, [])
        guard until({ $0 == before }, waitS: waitS, p) == before else { break }
    }
    return Pressed(seen: false, sent: sent)
}
