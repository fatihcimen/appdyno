import Foundation
import ObjectiveC
import XCTest

/// The one place the runner uses private XCTest API: XCUI waits for the app to go idle before and after
/// every event and snapshot, and an app with a running animation (a spinner, a ticking timer) never
/// does, so each call waits for a long timeout. The settle decides about quiet itself, so these waits
/// are turned off. Each method is patched only when it exists with the expected type; otherwise the
/// public behaviour stays (slower, still correct).
enum LogShim {
    final class Nothing: NSObject {
        @objc func logDebugMessage(_ message: String) {}
    }

    private static let nothing = Nothing()
    private typealias SetLogger = @convention(c) (AnyObject) -> Void

    /**
     * XCTest hands xcodebuild a line for all it does, and they stay in the result bundle: each key, a secure field's as
     * well, and the value of each field it reads. A person's words have no place in a file, and nothing here reads them.
     */
    static func install() {
        let anywhere = UnsafeMutableRawPointer(bitPattern: -2)
        for name in ["XCSetDebugLogger", "XCTASSetDebugLogger"] {
            guard let set = dlsym(anywhere, name) else { continue }
            unsafeBitCast(set, to: SetLogger.self)(nothing)
        }
    }
}

enum IdleShim {
    /// Which patches took effect, e.g. for the hello.
    private(set) static var applied: [String] = []
    /// The replacements, called once at start with a BOOL-like value in every slot (none may crash).
    private static var installed: [(imp: IMP, args: Int, ret: String)] = []
    private(set) static var selfChecked = false


    static func install() {
        guard applied.isEmpty else { return }
        for cls in ["XCUIApplicationProcess", "XCUIApplicationImpl", "XCUIApplication"] {
            guard let c = NSClassFromString(cls) else { continue }
            skip(c, cls, "shouldSkipPreEventQuiescence")
            skip(c, cls, "shouldSkipPostEventQuiescence")
            noop(c, cls, "waitForQuiescenceIncludingAnimationsIdle:isPreEvent:", types: ["v", "c", "B"], args: 2)
            noop(c, cls, "waitForQuiescenceIncludingAnimationsIdle:usingActivity:isPreEvent:", types: ["v", "c", "B"], args: 3)
            noop(c, cls, "_waitForQuiescenceAsPreEvent:", types: ["v"], args: 1)
        }
        selfCheck()
        NSLog("appdyno runner: idle waits off: %@", applied.joined(separator: ", "))
    }

    private static let selProcess = NSSelectorFromString("currentProcess")
    private static let selAnimationsIdle = NSSelectorFromString("_notifyWhenAnimationsAreIdle:")
    private typealias NotifyIdle = @convention(c) (AnyObject, Selector, AnyObject) -> Void

    /// Milliseconds until `app` reported no UIKit animation running, at most `seconds`: XCTest's own check
    /// before an event, which the patches above turn off with the rest of its waits. Nil when the app's
    /// process or the call is missing (APPDYNO_ANIMATION_WAIT=0 too): the touch then goes out at once.
    static func waitForAnimations(of app: XCUIApplication, within seconds: Double) -> Int? {
        guard ProcessInfo.processInfo.environment["APPDYNO_ANIMATION_WAIT"] != "0", app.responds(to: selProcess),
              let process = app.perform(selProcess)?.takeUnretainedValue(), process.responds(to: selAnimationsIdle)
        else { return nil }
        let t0 = Date()
        var idle = false
        // no parameters: safe whatever the reply passes the block
        let reply: @convention(block) () -> Void = { idle = true }
        unsafeBitCast((process as! NSObject).method(for: selAnimationsIdle), to: NotifyIdle.self)(process, selAnimationsIdle, reply as AnyObject)
        let end = t0.addingTimeInterval(seconds)
        // the reply may come on this (main) thread: turn the run loop, never block it
        while !idle, Date() < end { RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.005)) }
        if !idle { NSLog("appdyno runner: animations still running after %.0f s, touching anyway", seconds) }
        return Int(Date().timeIntervalSince(t0) * 1000)
    }

    private static func method(_ c: AnyClass, _ sel: String) -> (Method, String)? {
        guard let m = class_getInstanceMethod(c, NSSelectorFromString(sel)),
              let enc = method_getTypeEncoding(m) else { return nil }
        return (m, String(cString: enc))
    }

    /// A BOOL getter that answers YES.
    private static func skip(_ c: AnyClass, _ cls: String, _ sel: String) {
        guard let (m, enc) = method(c, sel), enc.hasPrefix("B") || enc.hasPrefix("c") else { return }
        let block: @convention(block) (UnsafeRawPointer?) -> Bool = { _ in true }
        method_setImplementation(m, imp_implementationWithBlock(block))
        applied.append("\(cls).\(sel)")
    }

    /// A wait that returns at once (YES when it returns a BOOL).
    private static func noop(_ c: AnyClass, _ cls: String, _ sel: String, types: [String], args: Int) {
        guard let (m, enc) = method(c, sel), let ret = enc.first.map(String.init), types.contains(ret),
              method_getNumberOfArguments(m) == UInt32(args + 2) else { return }
        // plain integers and raw pointers only: a replacement never retains or releases an argument, whatever
        // the real method passes in each slot (a BOOL taken for an object crashed the runner)
        let imp: IMP
        switch (ret, args) {
        case ("v", 1):
            let b: @convention(block) (UnsafeRawPointer?, UInt) -> Void = { _, _ in }
            imp = imp_implementationWithBlock(b)
        case ("v", 2):
            let b: @convention(block) (UnsafeRawPointer?, UInt, UInt) -> Void = { _, _, _ in }
            imp = imp_implementationWithBlock(b)
        case ("v", 3):
            let b: @convention(block) (UnsafeRawPointer?, UInt, UInt, UInt) -> Void = { _, _, _, _ in }
            imp = imp_implementationWithBlock(b)
        case (_, 2):
            let b: @convention(block) (UnsafeRawPointer?, UInt, UInt) -> Bool = { _, _, _ in true }
            imp = imp_implementationWithBlock(b)
        case (_, 3):
            let b: @convention(block) (UnsafeRawPointer?, UInt, UInt, UInt) -> Bool = { _, _, _, _ in true }
            imp = imp_implementationWithBlock(b)
        default:
            return
        }
        method_setImplementation(m, imp)
        installed.append((imp, args, ret))
        applied.append("\(cls).\(sel)")
    }

    /// Every replacement called with 1 (a BOOL YES) in every argument slot: it must neither crash nor retain.
    private static func selfCheck() {
        let receiver = UnsafeRawPointer(bitPattern: 0x10)!
        let sel = Selector(("selfCheck"))
        for r in installed {
            switch (r.ret, r.args) {
            case ("v", 1): unsafeBitCast(r.imp, to: (@convention(c) (UnsafeRawPointer, Selector, UInt) -> Void).self)(receiver, sel, 1)
            case ("v", 2): unsafeBitCast(r.imp, to: (@convention(c) (UnsafeRawPointer, Selector, UInt, UInt) -> Void).self)(receiver, sel, 1, 1)
            case ("v", 3): unsafeBitCast(r.imp, to: (@convention(c) (UnsafeRawPointer, Selector, UInt, UInt, UInt) -> Void).self)(receiver, sel, 1, 1, 1)
            case (_, 2): _ = unsafeBitCast(r.imp, to: (@convention(c) (UnsafeRawPointer, Selector, UInt, UInt) -> Bool).self)(receiver, sel, 1, 1)
            case (_, 3): _ = unsafeBitCast(r.imp, to: (@convention(c) (UnsafeRawPointer, Selector, UInt, UInt, UInt) -> Bool).self)(receiver, sel, 1, 1, 1)
            default: break
            }
        }
        selfChecked = true
    }
}
