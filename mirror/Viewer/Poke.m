// A window's own events, sent to itself: how it is driven with no person and nothing brought forward, and how it is looked at.
#import "Viewer.h"
#import "Window.h"
#import <dlfcn.h>

// as long as a mouse's: a touch that lifts in the instant it lands is no tap to a device
static const double kClickSeconds = 0.08;

void MVRealClick(NSWindow *window, NSPoint at) {
  // shortcut: the event record's window and the setter of its place in it are private, and a window kept off every screen
  // is under no pointer for the server to name. Tests only: if either goes, a click reaches nothing and the check fails.
  static const CGEventField kWindowOfEvent = 51;
  void (*setPlace)(CGEventRef, CGPoint) = dlsym(RTLD_DEFAULT, "CGEventSetWindowLocation");
  NSPoint onScreen = [window convertPointToScreen:at];
  CGPoint global = CGPointMake(onScreen.x, NSScreen.screens.firstObject.frame.size.height - onScreen.y);
  for (NSNumber *type in @[@(kCGEventLeftMouseDown), @(kCGEventLeftMouseUp)]) {
    CGEventRef click = CGEventCreateMouseEvent(NULL, type.intValue, global, kCGMouseButtonLeft);
    CGEventSetIntegerValueField(click, kWindowOfEvent, window.windowNumber);
    if (setPlace) setPlace(click, CGPointMake(at.x, window.frame.size.height - at.y));
    CGEventPostToPid(getpid(), click);
    CFRelease(click);
  }
}

@implementation MVWindow (Poke)

- (void)postMouse:(NSEventType)type x:(double)x y:(double)y {
  NSPoint inView = NSMakePoint(x * self.screenView.bounds.size.width, (1 - y) * self.screenView.bounds.size.height);
  NSPoint at = [self.screenView convertPoint:inView toView:nil];
  [NSApp postEvent:[NSEvent mouseEventWithType:type location:at modifierFlags:0 timestamp:0 windowNumber:self.nsWindow.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1] atStart:NO];
}

/// A click on a control where it stands, as a mouse's: through the window's own hit testing, and no shortcut to what it does.
- (void)pokeClick:(NSString *)name {
  NSButton *button = [self.bar buttonNamed:name] ?: MVFindControl(self.nsWindow.contentView, name);
  if (!button.window) return MVEmitFrom(self.screenView, @{@"op": @"clicked", @"name": name, @"found": @NO});
  NSPoint at = [button convertPoint:NSMakePoint(NSMidX(button.bounds), NSMidY(button.bounds)) toView:nil];
  NSView *frame = self.nsWindow.contentView.superview;
  NSView *under = [frame hitTest:[frame.superview convertPoint:at fromView:nil]];
  MVRealClick(self.nsWindow, at);
  MVEmitFrom(self.screenView, @{@"op": @"clicked", @"name": name, @"found": @YES, @"under": NSStringFromClass(under.class) ?: @"", @"isIt": @(under == button || [under isDescendantOf:button])});
}

- (void)pokeX:(double)x y:(double)y right:(BOOL)right {
  [self postMouse:right ? NSEventTypeRightMouseDown : NSEventTypeLeftMouseDown x:x y:y];
  // as long as a mouse's: a touch that lifts in the instant it lands is no tap to a device
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kClickSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [self postMouse:right ? NSEventTypeRightMouseUp : NSEventTypeLeftMouseUp x:x y:y];
  });
}

/// A button held, or drawn from one place to another, by the events a mouse sends: a step a display's tick apart.
- (void)pokeX:(double)x y:(double)y toX:(double)x2 toY:(double)y2 seconds:(double)seconds {
  [self postMouse:NSEventTypeLeftMouseDown x:x y:y];
  int steps = x == x2 && y == y2 ? 0 : MAX(1, (int)(seconds / 0.016));
  for (int i = 1; i <= steps; i++) {
    double at = (double)i / steps;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(at * seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [self postMouse:NSEventTypeLeftMouseDragged x:x + (x2 - x) * at y:y + (y2 - y) * at];
    });
  }
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((seconds + 0.02) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [self postMouse:NSEventTypeLeftMouseUp x:x2 y:y2];
  });
}

- (BOOL)snapshot:(NSString *)file {
  return MVWriteWindow(self.nsWindow, file);
}

/// The pointer over the picture: a window kept behind has no pointer to track.
- (void)pokeHoverX:(double)x y:(double)y {
  NSView *view = self.screenView;
  NSPoint at = [view convertPoint:NSMakePoint(x * view.bounds.size.width, (1 - y) * view.bounds.size.height) toView:nil];
  [view mouseMoved:[NSEvent mouseEventWithType:NSEventTypeMouseMoved location:at modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:self.nsWindow.windowNumber context:nil eventNumber:0 clickCount:0 pressure:0]];
}

- (BOOL)snapshotScreen:(NSString *)file {
  return MVWriteWindowPart(self.nsWindow, [self.screenView convertRect:self.screenView.bounds toView:nil], file);
}

- (void)pokeButton:(NSString *)name {
  [(MVView *)self.screenView pressButton:name];
}

- (void)pokeText:(NSString *)text {
  // what a keyboard's letters end in: a window kept behind is never the key window, so no real key gets this far
  [(MVView *)self.screenView typeText:text];
}

- (void)pokeKey:(NSString *)characters {
  NSEvent *e = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:self.nsWindow.windowNumber context:nil characters:characters charactersIgnoringModifiers:characters isARepeat:NO keyCode:0];
  // to the window itself: this app need not be the active one for an acceptance run
  [self.nsWindow sendEvent:e];
}

@end
