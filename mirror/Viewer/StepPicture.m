// A step's picture: a plain phone and what to do on it, drawn here in strokes and in the window's own ink, of no real phone
// and from no one's artwork. What is to be done stands in the accent; all else is one quiet line.
#import "Place.h"

static const double kPhoneWide = 92, kPhoneTall = 176, kPhoneRound = 16, kLine = 2;
static const double kRowTall = 20, kRowGap = 6, kInset = 10;

static NSColor *ink(void) {
  return MVSolid(NSColor.labelColor);
}

static NSColor *soft(void) {
  return MVQuietColor();
}

static NSColor *accent(void) {
  return MVSolid(NSColor.controlAccentColor);
}

static void stroke(NSBezierPath *path, NSColor *color, double wide) {
  [color setStroke];
  path.lineWidth = wide;
  path.lineCapStyle = NSLineCapStyleRound;
  path.lineJoinStyle = NSLineJoinStyleRound;
  [path stroke];
}

static NSBezierPath *rounded(NSRect rect, double round) {
  return [NSBezierPath bezierPathWithRoundedRect:rect xRadius:round yRadius:round];
}

/// A phone standing at `left`, and the place inside it for what it shows.
static NSRect drawPhone(double left, NSRect bounds) {
  NSRect phone = NSMakeRect(left, NSMidY(bounds) - kPhoneTall / 2, kPhoneWide, kPhoneTall);
  stroke(rounded(phone, kPhoneRound), ink(), kLine);
  [soft() setFill];
  [rounded(NSMakeRect(NSMidX(phone) - 12, NSMaxY(phone) - 12, 24, 4), 2) fill];
  return NSInsetRect(phone, kInset, 20);
}

/// Rows of a settings list, the one at `at` standing out, counted from the top.
static NSRect drawRows(NSRect inside, int count, int at) {
  NSRect chosen = NSZeroRect;
  for (int i = 0; i < count; i++) {
    NSRect row = NSMakeRect(NSMinX(inside), NSMaxY(inside) - (i + 1) * kRowTall - i * kRowGap, NSWidth(inside), kRowTall);
    if (i == at) {
      chosen = row;
      stroke(rounded(row, 5), accent(), kLine);
    } else {
      NSBezierPath *line = [NSBezierPath bezierPath];
      [line moveToPoint:NSMakePoint(NSMinX(row) + 2, NSMidY(row))];
      [line lineToPoint:NSMakePoint(NSMaxX(row) - 14, NSMidY(row))];
      stroke(line, soft(), kLine);
    }
  }
  return chosen;
}

/// A switch that is on, at the end of a row.
static void drawSwitch(NSRect row) {
  NSRect track = NSMakeRect(NSMaxX(row) - 24, NSMidY(row) - 6, 20, 12);
  [accent() setFill];
  [rounded(track, 6) fill];
  [NSColor.whiteColor setFill];
  [[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(NSMaxX(track) - 11, NSMinY(track) + 1, 10, 10)] fill];
}

/// Rings around a point, for a tap.
static void drawTap(NSPoint at) {
  for (int ring = 0; ring < 2; ring++) {
    double r = 7 + ring * 7;
    stroke([NSBezierPath bezierPathWithOvalInRect:NSMakeRect(at.x - r, at.y - r, 2 * r, 2 * r)], accent(), kLine - ring);
  }
}

/// A question on the phone, with the button to press standing out.
static void drawAsking(NSRect inside, BOOL checkbox, BOOL leftButton) {
  NSRect box = NSMakeRect(NSMinX(inside) - 3, NSMidY(inside) - 40, NSWidth(inside) + 6, 80);
  stroke(rounded(box, 8), ink(), kLine);
  NSBezierPath *words = [NSBezierPath bezierPath];
  for (int i = 0; i < 2; i++) {
    double y = NSMaxY(box) - 14 - i * 9;
    [words moveToPoint:NSMakePoint(NSMinX(box) + 9, y)];
    [words lineToPoint:NSMakePoint(NSMaxX(box) - (i ? 24 : 9), y)];
  }
  stroke(words, soft(), kLine);
  if (checkbox) stroke(rounded(NSMakeRect(NSMinX(box) + 9, NSMinY(box) + 32, 11, 11), 3), accent(), kLine);
  double wide = (NSWidth(box) - 24) / 2;
  for (int i = 0; i < 2; i++) {
    NSRect button = NSMakeRect(NSMinX(box) + 8 + i * (wide + 8), NSMinY(box) + 8, wide, 16);
    BOOL pressed = (i == 0) == leftButton;
    stroke(rounded(button, 5), pressed ? accent() : soft(), kLine);
    if (pressed) drawTap(NSMakePoint(NSMidX(button), NSMidY(button) - 22));
  }
}

/// This Mac, at the right of a picture.
static NSRect drawMac(NSRect bounds) {
  NSRect screen = NSMakeRect(NSMaxX(bounds) - 112, NSMidY(bounds) - 26, 112, 72);
  stroke(rounded(screen, 7), ink(), kLine);
  stroke(rounded(NSMakeRect(NSMinX(screen) - 10, NSMinY(screen) - 9, 132, 7), 3), ink(), kLine);
  return screen;
}

static void drawCable(NSPoint from, NSPoint to, BOOL dashed) {
  NSBezierPath *cable = [NSBezierPath bezierPath];
  [cable moveToPoint:from];
  [cable curveToPoint:to controlPoint1:NSMakePoint(from.x + 40, from.y - 44) controlPoint2:NSMakePoint(to.x - 40, to.y - 44)];
  if (dashed) {
    const CGFloat pattern[] = {5, 6};
    [cable setLineDash:pattern count:2 phase:0];
  }
  stroke(cable, accent(), kLine);
}

/// An arrow down into a screen: something comes to this Mac.
static void drawGetting(NSRect screen) {
  NSBezierPath *arrow = [NSBezierPath bezierPath];
  NSPoint top = NSMakePoint(NSMidX(screen), NSMaxY(screen) - 14), end = NSMakePoint(NSMidX(screen), NSMinY(screen) + 16);
  [arrow moveToPoint:top];
  [arrow lineToPoint:end];
  [arrow moveToPoint:NSMakePoint(end.x - 11, end.y + 11)];
  [arrow lineToPoint:end];
  [arrow lineToPoint:NSMakePoint(end.x + 11, end.y + 11)];
  stroke(arrow, accent(), kLine + 1);
}

/// Two thirds of a circle and an arrowhead: the phone restarts.
static void drawRestart(NSPoint at) {
  const double radius = 14, end = 20, wing = 9;
  NSBezierPath *round = [NSBezierPath bezierPath];
  [round appendBezierPathWithArcWithCenter:at radius:radius startAngle:70 endAngle:360 + end];
  NSPoint tip = round.currentPoint;
  // the circle's heading at its end, and a head swept back from it either way
  double heading = (end + 90) * M_PI / 180;
  for (NSNumber *side in @[@(-1), @1]) {
    double back = heading + side.doubleValue * 2.6;
    [round moveToPoint:tip];
    [round lineToPoint:NSMakePoint(tip.x + wing * cos(back), tip.y + wing * sin(back))];
  }
  stroke(round, accent(), kLine);
}

static void drawLock(NSPoint at) {
  NSRect body = NSMakeRect(at.x - 15, at.y - 18, 30, 24);
  [accent() setFill];
  [rounded(body, 5) fill];
  NSBezierPath *hoop = [NSBezierPath bezierPath];
  [hoop appendBezierPathWithArcWithCenter:NSMakePoint(at.x, NSMaxY(body) + 2) radius:9 startAngle:0 endAngle:180];
  stroke(hoop, accent(), 3);
}

static void drawMoon(NSPoint at) {
  NSBezierPath *moon = [NSBezierPath bezierPath];
  [moon appendBezierPathWithArcWithCenter:at radius:16 startAngle:60 endAngle:300];
  [moon appendBezierPathWithArcWithCenter:NSMakePoint(at.x + 11, at.y) radius:19 startAngle:250 endAngle:110 clockwise:YES];
  [moon closePath];
  [accent() setFill];
  [moon fill];
}

static void drawTick(NSPoint at) {
  NSBezierPath *tick = [NSBezierPath bezierPath];
  [tick moveToPoint:NSMakePoint(at.x - 15, at.y)];
  [tick lineToPoint:NSMakePoint(at.x - 4, at.y - 12)];
  [tick lineToPoint:NSMakePoint(at.x + 17, at.y + 14)];
  stroke(tick, MVGreen(), 4);
}

@implementation MVStepPicture

- (void)setStep:(NSString *)step {
  _step = [step copy];
  self.needsDisplay = YES;
}

- (BOOL)isAccessibilityElement {
  return YES;
}

- (NSAccessibilityRole)accessibilityRole {
  return NSAccessibilityImageRole;
}

- (void)drawRect:(NSRect)dirty {
  NSRect all = self.bounds;
  NSString *step = _step ?: @"plug";
  double middle = NSMidX(all) - kPhoneWide / 2;
  if ([step isEqual:@"plug"]) {
    NSRect screen = NSOffsetRect(drawMac(all), 0, 0);
    NSRect inside = drawPhone(NSMinX(all) + 4, all);
    drawCable(NSMakePoint(NSMaxX(inside) + kInset, NSMidY(all) - 66), NSMakePoint(NSMinX(screen) + 30, NSMinY(screen) - 9), YES);
  } else if ([step isEqual:@"get-adb"] || [step isEqual:@"get-xcode"]) {
    NSRect big = NSInsetRect(all, 16, 0);
    drawGetting(drawMac(big));
  } else if ([step isEqual:@"developer-options"]) {
    NSRect row = drawRows(drawPhone(middle, all), 5, 3);
    drawTap(NSMakePoint(NSMidX(row), NSMidY(row)));
    NSString *seven = @"7×";
    [seven drawAtPoint:NSMakePoint(middle + kPhoneWide + 10, NSMidY(row) - 12) withAttributes:@{NSFontAttributeName: [NSFont systemFontOfSize:20 weight:NSFontWeightSemibold], NSForegroundColorAttributeName: accent()}];
  } else if ([step isEqual:@"allow"]) {
    drawAsking(drawPhone(middle, all), YES, NO);
  } else if ([step isEqual:@"trust"]) {
    drawAsking(drawPhone(middle, all), NO, YES);
  } else if ([step isEqual:@"locked"]) {
    drawLock(NSMakePoint(NSMidX(drawPhone(middle, all)), NSMidY(all)));
  } else if ([step isEqual:@"asleep"]) {
    drawMoon(NSMakePoint(NSMidX(drawPhone(middle, all)) - 3, NSMidY(all)));
  } else if ([step isEqual:@"ready"]) {
    drawTick(NSMakePoint(NSMidX(drawPhone(middle, all)), NSMidY(all)));
  } else {
    // every other step is a switch to turn on: which row says only that it is not the first
    int at = [step isEqual:@"usb-debugging"] ? 2 : [step isEqual:@"xiaomi-security"] ? 3 : [step isEqual:@"xiaomi-install"] ? 1 : 0;
    drawSwitch(drawRows(drawPhone(middle, all), 5, at));
    if ([step isEqual:@"developer-mode"]) drawRestart(NSMakePoint(middle + kPhoneWide + 26, NSMidY(all)));
  }
}

@end
