import CoreGraphics
import Foundation

/// Letters and digits only: a formatting field shows "(599) 999-9900" for "5999999900".
public func lettersAndDigits(_ text: String) -> String {
    String(text.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }.map(Character.init))
}

/// Enter goes after the text when asked, but never after a read-back that says the field holds other text: a search or
/// a form would act on it.
public func submitsText(asked: Bool, verified: Bool?) -> Bool { asked && verified != false }

/// Whether a field holds the text typed into it, as typed or, where it formats what is typed, in the same
/// letters and digits.
public func holdsText(_ now: String, before: String, text: String, replace: Bool) -> Bool {
    if replace ? now == text : now == before + text || now.contains(text) { return true }
    let held = lettersAndDigits(now), typed = lettersAndDigits(text)
    return replace ? held == typed : held == lettersAndDigits(before) + typed || held.contains(typed)
}

/// Whether text a field read back as other is cleared and typed once more: where what it must hold is `known` (all of
/// it replaced, or an empty field), never a secure field's (no verdict), and never text with a line break, whose
/// Return may have sent a form that would then go twice.
public func retypes(verified: Bool?, known: Bool, text: String) -> Bool {
    verified == false && known && !text.contains(where: \.isNewline)
}

/// What `regainFocus` asks of its caller: whether the field holds the keyboard focus, a tap on it, the time in seconds,
/// a pause, and whether the caller no longer waits.
public struct FocusProbe {
    public let holds: () -> Bool
    public let tap: () throws -> Void
    public let clock: () -> Double
    public let pause: (Double) -> Void
    public let over: () -> Bool
}

/// A field with no identifier as a snapshot shows it: what tells it from another field.
public struct FieldMark {
    public let type: UInt
    public let label: String
    public let placeholder: String
    public let frame: CGRect

    public init(type: UInt, label: String, placeholder: String, frame: CGRect) {
        self.type = type
        self.label = label
        self.placeholder = placeholder
        self.frame = frame
    }
}

/// Whether the field with the keyboard focus now is the one keys were found going to. A field that takes the focus may
/// move and change its size, as Settings' search field rises with the keyboard and makes room for its close button: it
/// is that field where it still overlaps the place it was found at, or where it has its words, as another field of a
/// form has words of its own. None with the focus: the field let go of it.
public func sameField(was: FieldMark, now: FieldMark?) -> Bool {
    guard let now, now.type == was.type else { return false }
    let named = !(was.label.isEmpty && was.placeholder.isEmpty)
    return now.frame.intersects(was.frame) || (named && now.label == was.label && now.placeholder == was.placeholder)
}

/// Whether the field holds the keyboard focus as keys go to it: one that let go of it is tapped once and waited for,
/// `waitS` at most. XCUI's typing into a field without the focus records a failure that ends the runner's test, and
/// the synthesizer's keys go to another field or nowhere: a hosted Mac's field lost it before its text was cleared.
public func regainFocus(waitS: Double, _ field: FocusProbe) throws -> Bool {
    if field.holds() { return true }
    try field.tap()
    let end = field.clock() + waitS
    while !field.holds() {
        if field.clock() >= end || field.over() { return false }
        field.pause(0.08)
    }
    return true
}

/// What `typeEach` asks of its caller: a key typed, the field's text (nil: it is gone), the time in seconds, a pause,
/// and whether the caller no longer waits.
public struct KeysProbe {
    public let send: (String) throws -> Void
    public let read: () -> String?
    public let clock: () -> Double
    public let pause: (Double) -> Void
    public let over: () -> Bool
}

/**
 * Deletes what a field holds with `key` a key at a time, each once the field shows the one before it taken (`read`
 * changed from what it was), until it holds nothing or is gone. A field that formats what is typed drops a key that
 * comes while it rewrites itself: twelve deletes at 60 a second left a hosted Mac's phone field three digits, which the
 * number typed after then joined. False where a delete changed nothing within `waitS`, or the caller no longer waits.
 */
public func deleteEach(_ key: String, waitS: Double, _ keys: KeysProbe) throws -> Bool {
    while let was = keys.read(), !was.isEmpty {
        guard !keys.over() else { return false }
        try keys.send(key)
        let end = keys.clock() + waitS
        while keys.read() == was {
            if keys.clock() >= end || keys.over() { return false }
            keys.pause(0.03)
        }
    }
    return true
}

/**
 * Types `text` a key at a time, each once the field shows the key before it (`read` changed from what it was): a field
 * that formats what is typed drops a key that comes while it rewrites itself, and on a loaded Mac that rewrite
 * outlasted a key's interval at 15 a second. A key the field does not show within `waitS` ends the pacing, as such a
 * field takes keys some other way: the rest go at once. Nothing more is typed once the caller no longer waits, nor once
 * the field is gone, as a code entry that submitted itself.
 */
public func typeEach(_ text: String, waitS: Double, _ keys: KeysProbe) throws {
    var rest = Substring(text)
    while let key = rest.first, !keys.over(), let was = keys.read() {
        try keys.send(String(key))
        rest = rest.dropFirst()
        let end = keys.clock() + waitS
        while keys.read() == was {
            if keys.clock() >= end || keys.over() {
                if !rest.isEmpty, !keys.over() { try keys.send(String(rest)) }
                return
            }
            keys.pause(0.03)
        }
    }
}
