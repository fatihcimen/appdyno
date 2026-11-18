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
