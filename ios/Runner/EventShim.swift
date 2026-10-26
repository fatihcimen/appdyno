import Foundation
import ObjectiveC
import UIKit
import XCTest

/// A tap sent straight to XCTest's event synthesizer (private API): one finger down and up at a screen
/// point, without XCUI's per-tap lookups and interruption checks. Used only when every class and
/// selector is there at run time (APPDYNO_FAST_TAP=0 turns it off); otherwise the public coordinate tap.
enum EventShim {
    private typealias InitRecord = @convention(c) (AnyObject, Selector, NSString, Int) -> AnyObject
    private typealias InitPath = @convention(c) (AnyObject, Selector, CGPoint, Double) -> AnyObject
    private typealias Lift = @convention(c) (AnyObject, Selector, Double) -> Void
    private typealias AddPath = @convention(c) (AnyObject, Selector, AnyObject) -> Void
    private typealias Getter = @convention(c) (AnyObject, Selector) -> AnyObject?
    private typealias Synthesize = @convention(c) (AnyObject, Selector, AnyObject, AnyObject) -> Void

    private static let recordClass: AnyClass? = NSClassFromString("XCSynthesizedEventRecord")
    private static let pathClass: AnyClass? = NSClassFromString("XCPointerEventPath")
    private static let selInitRecord = NSSelectorFromString("initWithName:interfaceOrientation:")
    private static let selInitPath = NSSelectorFromString("initForTouchAtPoint:offset:")
    private static let selLift = NSSelectorFromString("liftUpAtOffset:")
    private static let selAdd = NSSelectorFromString("addPointerEventPath:")
    private static let selSynth = NSSelectorFromString("eventSynthesizer")
    private static let selSynthesize = NSSelectorFromString("synthesizeEvent:completion:")

    /// Everything the fast tap needs exists (checked once).
    static let available: Bool = {
        // on unless APPDYNO_FAST_TAP=0: about half the time of XCUI's tap on a phone (313 vs 603 ms)
        guard ProcessInfo.processInfo.environment["APPDYNO_FAST_TAP"] != "0",
              let r = recordClass, let p = pathClass,
              class_getInstanceMethod(r, selInitRecord) != nil, class_getInstanceMethod(r, selAdd) != nil,
              class_getInstanceMethod(p, selInitPath) != nil, class_getInstanceMethod(p, selLift) != nil,
              XCUIDevice.shared.responds(to: selSynth),
              let s = XCUIDevice.shared.perform(selSynth)?.takeUnretainedValue(),
              s.responds(to: selSynthesize)
        else { return false }
        return true
    }()

    private static func imp<T>(_ obj: AnyObject, _ sel: Selector, _: T.Type) -> T {
        unsafeBitCast((obj as! NSObject).method(for: sel), to: T.self)
    }

    /// Taps at `p` (screen points); false when the synthesizer refused it.
    static func tap(_ p: CGPoint, orientation: Int) -> Bool {
        guard available, let r = recordClass, let pc = pathClass else { return false }
        let rawRecord = r.alloc() as AnyObject
        let record = imp(rawRecord, selInitRecord, InitRecord.self)(rawRecord, selInitRecord, "tap" as NSString, orientation)
        let rawPath = pc.alloc() as AnyObject
        let path = imp(rawPath, selInitPath, InitPath.self)(rawPath, selInitPath, p, 0)
        imp(path, selLift, Lift.self)(path, selLift, 0.05)
        imp(record, selAdd, AddPath.self)(record, selAdd, path)
        guard let synth = XCUIDevice.shared.perform(selSynth)?.takeUnretainedValue() else { return false }
        var done = false
        var ok = false
        let completion: @convention(block) (Bool, NSError?) -> Void = { success, _ in
            ok = success
            done = true
        }
        imp(synth, selSynthesize, Synthesize.self)(synth, selSynthesize, record, completion as AnyObject)
        let end = Date().addingTimeInterval(5)
        // the completion may come on this (main) thread: turn the run loop, never block it
        while !done, Date() < end { RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.005)) }
        return done && ok
    }
}
