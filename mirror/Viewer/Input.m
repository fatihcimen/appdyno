// What a person does on the window, as the viewer's messages. Coordinates go out as fractions of the
// picture, which is the whole device's screen: the far end multiplies by the size the device has now, so
// that no mapping by the stream's size can miss a button.
#import "Viewer.h"
#import "Window.h"
#import <Carbon/Carbon.h>

static const double kDot = 30, kLongPressSeconds = 0.7, kPinchStart = 0.14, kPinchLeast = 8;

BOOL MVNormalize(NSPoint point, NSSize bounds, CGSize picture, double *x, double *y) {
  if (picture.width <= 0 || picture.height <= 0 || bounds.width <= 0 || bounds.height <= 0) return NO;
  NSRect shown = AVMakeRectWithAspectRatioInsideRect(picture, NSMakeRect(0, 0, bounds.width, bounds.height));
  // inclusive: a drag held at the edge of the picture is still on it
  if (point.x < NSMinX(shown) || point.x > NSMaxX(shown) || point.y < NSMinY(shown) || point.y > NSMaxY(shown)) return NO;
  *x = (point.x - shown.origin.x) / shown.size.width;
  *y = 1 - (point.y - shown.origin.y) / shown.size.height;
  return YES;
}

uint16_t MVUsageOfKeyCode(uint16_t keyCode) {
  switch (keyCode) {
    case kVK_Return: return 0x28;
    case kVK_ANSI_KeypadEnter: return 0x28;
    case kVK_Escape: return 0x29;
    case kVK_Delete: return 0x2a;
    case kVK_Tab: return 0x2b;
    case kVK_ForwardDelete: return 0x4c;
    case kVK_RightArrow: return 0x4f;
    case kVK_LeftArrow: return 0x50;
    case kVK_DownArrow: return 0x51;
    case kVK_UpArrow: return 0x52;
    case kVK_Home: return 0x4a;
    case kVK_End: return 0x4d;
    case kVK_PageUp: return 0x4b;
    case kVK_PageDown: return 0x4e;
    default: return 0;
  }
}

BOOL MVIsTypedText(NSString *characters, NSEventModifierFlags flags) {
  if (flags & (NSEventModifierFlagCommand | NSEventModifierFlagControl)) return NO;
  if (characters.length == 0) return NO;
  unichar first = [characters characterAtIndex:0];
  // below space and delete are controls; the private range holds the arrows and function keys
  return first >= 0x20 && first != 0x7f && !(first >= 0xf700 && first <= 0xf8ff);
}

double MVPinchGap(double gap, double magnification, double most) {
  return MIN(MAX(gap * (1 + magnification), kPinchLeast), most);
}

static NSPoint clampTo(NSPoint p, NSSize size) {
  return NSMakePoint(MIN(MAX(p.x, 0), size.width), MIN(MAX(p.y, 0), size.height));
}

static CALayer *dotLayer(CALayer *parent) {
  CALayer *dot = [CALayer layer];
  dot.bounds = CGRectMake(0, 0, kDot, kDot);
  dot.cornerRadius = kDot / 2;
  dot.backgroundColor = [NSColor colorWithWhite:1 alpha:0.42].CGColor;
  dot.borderColor = [NSColor colorWithWhite:0 alpha:0.28].CGColor;
  dot.borderWidth = 1;
  dot.zPosition = 20;
  [parent addSublayer:dot];
  return dot;
}

@implementation MVView {
  BOOL _down;
  NSPoint _scrollAt;
  BOOL _scrolling;
  NSPoint _pinchAt;
  double _pinchGap;
  CALayer *_dot, *_dot2;
}

- (BOOL)acceptsFirstResponder {
  return YES;
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}

- (NSMenu *)deviceMenu {
  return MVControlMenu(@"Device", self.controls);
}

/// A person's: a menu of a window is reached only by a click on it, or a shortcut in the key window.
- (void)pressButton:(id)sender {
  NSString *name = [sender respondsToSelector:@selector(representedObject)] ? [sender representedObject] : sender;
  if (self.inputOn && !self.armed) {
    self.armed = YES;
    return;
  }
  if (self.takesPointer && [name isKindOfClass:NSString.class]) MVEmit(@{@"op": @"button", @"name": name});
}

- (BOOL)takesPointer {
  return self.inputOn && self.armed;
}

- (BOOL)takesKeys {
  return self.takesPointer && self.window && NSApp.keyWindow == self.window;
}

- (void)sendPhase:(int)phase at:(NSPoint)point clampToEdge:(BOOL)clamp {
  [self sendPhase:phase at:point second:nil clampToEdge:clamp];
}

- (void)sendPhase:(int)phase at:(NSPoint)point second:(nullable NSValue *)second clampToEdge:(BOOL)clamp {
  if (!self.takesPointer) return;
  double x, y, x2, y2;
  NSSize size = self.bounds.size;
  NSPoint p = clamp ? clampTo(point, size) : point;
  if (!MVNormalize(p, size, self.picture, &x, &y)) return;
  NSMutableDictionary *touch = [NSMutableDictionary dictionaryWithDictionary:@{@"op": @"touch", @"p": @(phase), @"x": @(x), @"y": @(y)}];
  NSPoint other = second ? clampTo(second.pointValue, size) : NSZeroPoint;
  if (second && MVNormalize(other, size, self.picture, &x2, &y2)) {
    touch[@"x2"] = @(x2);
    touch[@"y2"] = @(y2);
  }
  MVEmit(touch);
  [self showDot:phase == 2 ? nil : [NSValue valueWithPoint:p] second:second && phase != 2 ? [NSValue valueWithPoint:other] : nil];
}

/// The dot a finger leaves, where the window can see it.
- (void)showDot:(nullable NSValue *)at second:(nullable NSValue *)second {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  if (at) {
    if (!_dot) _dot = dotLayer(self.layer);
    _dot.position = at.pointValue;
  }
  _dot.hidden = !at;
  if (second) {
    if (!_dot2) _dot2 = dotLayer(self.layer);
    _dot2.position = second.pointValue;
  }
  _dot2.hidden = !second;
  [CATransaction commit];
}

- (void)mouseDown:(NSEvent *)event {
  if (self.inputOn && !self.armed) {
    self.armed = YES;
    return;
  }
  // from the bezel it starts at the screen's edge, as a finger does coming on from outside
  [self sendPhase:0 at:[self convertPoint:event.locationInWindow fromView:nil] clampToEdge:YES];
  _down = self.takesPointer;
}

- (void)mouseDragged:(NSEvent *)event {
  if (_down) [self sendPhase:1 at:[self convertPoint:event.locationInWindow fromView:nil] clampToEdge:YES];
}

- (void)mouseUp:(NSEvent *)event {
  if (_down) [self sendPhase:2 at:[self convertPoint:event.locationInWindow fromView:nil] clampToEdge:YES];
  _down = NO;
}

/// A long press, however short the click: the finger lifts when it has been down long enough.
- (void)rightMouseDown:(NSEvent *)event {
  if (self.inputOn && !self.armed) {
    self.armed = YES;
    return;
  }
  NSPoint at = [self convertPoint:event.locationInWindow fromView:nil];
  [self sendPhase:0 at:at clampToEdge:YES];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLongPressSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [self sendPhase:2 at:at clampToEdge:YES];
  });
}

/// A trackpad's pinch as two fingers either side of the pointer, moving as the fingers do.
- (void)magnifyWithEvent:(NSEvent *)event {
  if (!self.takesPointer || _down) return;
  NSPoint at = [self convertPoint:event.locationInWindow fromView:nil];
  if (event.phase == NSEventPhaseBegan) {
    _pinchAt = clampTo(at, self.bounds.size);
    _pinchGap = MIN(self.bounds.size.width, self.bounds.size.height) * kPinchStart;
  }
  _pinchGap = MVPinchGap(_pinchGap, event.magnification, MAX(self.bounds.size.width, self.bounds.size.height));
  NSPoint a = NSMakePoint(_pinchAt.x - _pinchGap, _pinchAt.y), b = NSMakePoint(_pinchAt.x + _pinchGap, _pinchAt.y);
  BOOL ended = event.phase == NSEventPhaseEnded || event.phase == NSEventPhaseCancelled;
  [self sendPhase:event.phase == NSEventPhaseBegan ? 0 : ended ? 2 : 1 at:a second:[NSValue valueWithPoint:b] clampToEdge:YES];
}

// a trackpad's two fingers, or a wheel, as one finger dragging: the device scrolls as it does for a finger
- (void)scrollWheel:(NSEvent *)event {
  if (!self.takesPointer || _down) return;
  // the coasting after the fingers lift is the device's own to do
  if (event.momentumPhase != NSEventPhaseNone) return;
  NSPoint at = [self convertPoint:event.locationInWindow fromView:nil];
  BOOL wheel = event.phase == NSEventPhaseNone;
  double dx = event.scrollingDeltaX * (event.hasPreciseScrollingDeltas ? 1 : 12);
  double dy = event.scrollingDeltaY * (event.hasPreciseScrollingDeltas ? 1 : 12);
  if (wheel || event.phase == NSEventPhaseBegan) {
    _scrollAt = at;
    _scrolling = YES;
    [self sendPhase:0 at:at clampToEdge:NO];
  }
  if (!_scrolling) return;
  _scrollAt.x += dx;
  _scrollAt.y -= dy;
  [self sendPhase:1 at:_scrollAt clampToEdge:YES];
  if (wheel || event.phase == NSEventPhaseEnded || event.phase == NSEventPhaseCancelled) {
    [self sendPhase:2 at:_scrollAt clampToEdge:YES];
    _scrolling = NO;
  }
}

@end
