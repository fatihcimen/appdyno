// What a person does on the window, as the viewer's messages. Coordinates go out as fractions of the
// picture, which is the whole device's screen: the far end multiplies by the size the device has now, so
// that no mapping by the stream's size can miss a button.
#import "Viewer.h"
#import "Window.h"
#import <Carbon/Carbon.h>

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

@implementation MVView {
  BOOL _down;
  NSPoint _scrollAt;
  BOOL _scrolling;
}

- (BOOL)acceptsFirstResponder {
  return YES;
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}

- (BOOL)takesPointer {
  return self.inputOn && self.armed;
}

- (BOOL)takesKeys {
  return self.takesPointer && self.window.isKeyWindow;
}

- (void)sendPhase:(int)phase at:(NSPoint)point clampToEdge:(BOOL)clamp {
  if (!self.takesPointer) return;
  double x, y;
  NSSize size = self.bounds.size;
  NSPoint p = clamp ? NSMakePoint(MIN(MAX(point.x, 0), size.width), MIN(MAX(point.y, 0), size.height)) : point;
  if (!MVNormalize(p, size, self.picture, &x, &y)) return;
  MVEmit(@{@"op": @"touch", @"p": @(phase), @"x": @(x), @"y": @(y)});
}

- (void)mouseDown:(NSEvent *)event {
  if (self.inputOn && !self.armed) {
    self.armed = YES;
    return;
  }
  NSPoint p = [self convertPoint:event.locationInWindow fromView:nil];
  double x, y;
  _down = MVNormalize(p, self.bounds.size, self.picture, &x, &y);
  if (_down) [self sendPhase:0 at:p clampToEdge:NO];
}

- (void)mouseDragged:(NSEvent *)event {
  if (_down) [self sendPhase:1 at:[self convertPoint:event.locationInWindow fromView:nil] clampToEdge:YES];
}

- (void)mouseUp:(NSEvent *)event {
  if (_down) [self sendPhase:2 at:[self convertPoint:event.locationInWindow fromView:nil] clampToEdge:YES];
  _down = NO;
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

- (void)keyDown:(NSEvent *)event {
  if (!self.takesKeys) return;
  NSString *characters = event.characters;
  if (MVIsTypedText(characters, event.modifierFlags)) {
    MVEmit(@{@"op": @"text", @"s": characters});
    return;
  }
  uint16_t usage = MVUsageOfKeyCode(event.keyCode);
  if (usage) MVEmit(@{@"op": @"key", @"page": @7, @"usage": @(usage), @"state": @1});
}

- (void)keyUp:(NSEvent *)event {
  if (!self.takesKeys) return;
  uint16_t usage = MVUsageOfKeyCode(event.keyCode);
  if (usage) MVEmit(@{@"op": @"key", @"page": @7, @"usage": @(usage), @"state": @2});
}

@end
