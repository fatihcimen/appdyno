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
