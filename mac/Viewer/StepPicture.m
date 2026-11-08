// A step's picture: a plain phone and what to do on it, drawn here in strokes and in the window's own ink, of no real phone
// and from no one's artwork. What is to be done stands in the accent; all else is one quiet line.
#import "Place.h"

static const double kPhoneWide = 92, kPhoneTall = 176, kPhoneRound = 16, kLine = 2;
static const double kRowTall = 20, kRowGap = 6, kInset = 10;
static const double kBeatSeconds = 1.6, kBeats = 3, kMacWide = 112, kSwitchOff = 0.35;

static NSColor *ink(void) {
  return NSColor.whiteColor;
}

static NSColor *soft(void) {
  return [NSColor colorWithWhite:1 alpha:0.72];
}

static NSColor *accent(void) {
  return MVHeroMark();
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
static NSRect switchIn(NSRect row) {
  return NSMakeRect(NSMaxX(row) - 24, NSMidY(row) - 6, 20, 12);
}

static void drawSwitch(NSRect track) {
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
static NSPoint drawAsking(NSRect inside, BOOL checkbox, BOOL leftButton) {
  NSPoint pressedAt = NSZeroPoint;
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
    if (!pressed) continue;
    pressedAt = NSMakePoint(NSMidX(button), NSMidY(button));
    drawTap(pressedAt);
  }
  return pressedAt;
}

/// This Mac, at the right of a picture.
static NSRect drawMac(NSRect bounds) {
  NSRect screen = NSMakeRect(NSMaxX(bounds) - kMacWide, NSMidY(bounds) - 26, kMacWide, 72);
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

/// Most of a circle and its arrowhead, around nothing: the phone restarts.
/// By hand, as `NSBezierPath.CGPath` is macOS 14.
static CGPathRef _Nonnull cgPath(NSBezierPath *path) {
  CGMutablePathRef out = CGPathCreateMutable();
  NSPoint at[3];
  for (NSInteger i = 0; i < path.elementCount; i++) {
    NSBezierPathElement element = [path elementAtIndex:i associatedPoints:at];
    if (element == NSBezierPathElementMoveTo) CGPathMoveToPoint(out, NULL, at[0].x, at[0].y);
    else if (element == NSBezierPathElementLineTo) CGPathAddLineToPoint(out, NULL, at[0].x, at[0].y);
    else if (element == NSBezierPathElementCurveTo) CGPathAddCurveToPoint(out, NULL, at[0].x, at[0].y, at[1].x, at[1].y, at[2].x, at[2].y);
    else CGPathCloseSubpath(out);
  }
  return (CGPathRef)CFAutorelease(out);
}

static NSBezierPath *restartPath(void) {
  const double radius = 14, end = 20, wing = 9;
  NSBezierPath *round = [NSBezierPath bezierPath];
  [round appendBezierPathWithArcWithCenter:NSZeroPoint radius:radius startAngle:70 endAngle:360 + end];
  NSPoint tip = round.currentPoint;
  // the circle's heading at its end, and a head swept back from it either way
  double heading = (end + 90) * M_PI / 180;
  for (NSNumber *side in @[@(-1), @1]) {
    double back = heading + side.doubleValue * 2.6;
    [round moveToPoint:tip];
    [round lineToPoint:NSMakePoint(tip.x + wing * cos(back), tip.y + wing * sin(back))];
  }
  return round;
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
  stroke(tick, accent(), 4);
}

@implementation MVStepPicture {
  CALayer *_moving;
  NSPoint _tapAt, _restartAt;
  NSRect _track;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) self.wantsLayer = YES;
  return self;
}

- (void)setStep:(NSString *)step {
  if ([step isEqual:_step]) return;
  _step = [step copy];
  [_moving removeFromSuperlayer];
  _moving = nil;
  _tapAt = _restartAt = NSZeroPoint;
  _track = NSZeroRect;
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
    NSRect screen = drawMac(all);
    NSRect inside = drawPhone(NSMinX(all) + 4, all);
    drawCable(NSMakePoint(NSMaxX(inside) + kInset, NSMidY(all) - 66), NSMakePoint(NSMinX(screen) + 30, NSMinY(screen) - 9), YES);
  } else if ([step isEqual:@"get-adb"] || [step isEqual:@"get-xcode"]) {
    NSRect around = all;
    around.size.width = NSMidX(all) + kMacWide / 2 - NSMinX(all);
    drawGetting(drawMac(around));
  } else if ([step isEqual:@"developer-options"]) {
    NSRect row = drawRows(drawPhone(middle, all), 5, 3);
    _tapAt = NSMakePoint(NSMidX(row), NSMidY(row));
    drawTap(_tapAt);
    NSString *seven = @"7×";
    [seven drawAtPoint:NSMakePoint(middle + kPhoneWide + 10, NSMidY(row) - 12) withAttributes:@{NSFontAttributeName: [NSFont systemFontOfSize:20 weight:NSFontWeightSemibold], NSForegroundColorAttributeName: accent()}];
  } else if ([step isEqual:@"allow"] || [step isEqual:@"trust"]) {
    BOOL allow = [step isEqual:@"allow"];
    _tapAt = drawAsking(drawPhone(middle, all), allow, !allow);
  } else if ([step isEqual:@"locked"]) {
    drawLock(NSMakePoint(NSMidX(drawPhone(middle, all)), NSMidY(all)));
  } else if ([step isEqual:@"asleep"]) {
    drawMoon(NSMakePoint(NSMidX(drawPhone(middle, all)) - 3, NSMidY(all)));
  } else if ([step isEqual:@"ready"]) {
    drawTick(NSMakePoint(NSMidX(drawPhone(middle, all)), NSMidY(all)));
  } else {
    // every other step is a switch to turn on: which row says only that it is not the first
    int at = [step isEqual:@"usb-debugging"] ? 2 : [step isEqual:@"xiaomi-security"] ? 3
                                               : [step isEqual:@"xiaomi-install"]    ? 1
                                                                                     : 0;
    _track = switchIn(drawRows(drawPhone(middle, all), 5, at));
    // it stands in the layer that slides it, or here where nothing may move: both, and the one shows through the other
    if (!MVMoves()) drawSwitch(_track);
    if ([step isEqual:@"developer-mode"]) {
      _restartAt = NSMakePoint(middle + kPhoneWide + 26, NSMidY(all));
      // it stands in the layer that turns it, or here where nothing may move
      if (!MVMoves()) {
        NSBezierPath *still = restartPath();
        NSAffineTransform *there = [NSAffineTransform transform];
        [there translateXBy:_restartAt.x yBy:_restartAt.y];
        [still transformUsingAffineTransform:there];
        stroke(still, accent(), kLine);
      }
    }
  }
  if (!_moving && MVMoves()) dispatch_async(dispatch_get_main_queue(), ^{
    [self startMoving];
  });
}

/// A ring going out from where to tap.
- (CALayer *)ringAt:(NSPoint)at {
  CAShapeLayer *ring = [CAShapeLayer layer];
  CGPathRef path = CGPathCreateWithEllipseInRect(CGRectMake(0, 0, 28, 28), NULL);
  ring.path = path;
  CGPathRelease(path);
  ring.bounds = CGRectMake(0, 0, 28, 28);
  ring.position = at;
  ring.fillColor = NSColor.clearColor.CGColor;
  ring.strokeColor = accent().CGColor;
  ring.lineWidth = kLine;
  ring.opacity = 0;
  CABasicAnimation *grow = [CABasicAnimation animationWithKeyPath:@"transform.scale"];
  grow.fromValue = @0.5;
  grow.toValue = @1.7;
  CABasicAnimation *fade = [CABasicAnimation animationWithKeyPath:@"opacity"];
  fade.fromValue = @0.9;
  fade.toValue = @0;
  CAAnimationGroup *beat = [CAAnimationGroup animation];
  beat.animations = @[grow, fade];
  beat.duration = kBeatSeconds;
  beat.repeatCount = kBeats;
  beat.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
  [ring addAnimation:beat forKey:@"tap"];
  return ring;
}

/// The same switch, sliding on and ending as it is drawn.
- (CALayer *)switchIn:(NSRect)track {
  CAShapeLayer *ground = [CAShapeLayer layer];
  CGPathRef shape = CGPathCreateWithRoundedRect(track, 6, 6, NULL);
  ground.path = shape;
  CGPathRelease(shape);
  ground.fillColor = accent().CGColor;
  CAKeyframeAnimation *fill = [CAKeyframeAnimation animationWithKeyPath:@"fillColor"];
  // dim while off: a white knob must stand clear of it in either look
  NSColor *dimmed = [soft() colorWithAlphaComponent:kSwitchOff];
  fill.values = @[(id)dimmed.CGColor, (id)dimmed.CGColor, (id)accent().CGColor, (id)accent().CGColor];
  CALayer *knob = [CALayer layer];
  knob.backgroundColor = NSColor.whiteColor.CGColor;
  knob.cornerRadius = 5;
  knob.bounds = CGRectMake(0, 0, 10, 10);
  double on = NSMaxX(track) - 6, off = NSMinX(track) + 6;
  knob.position = CGPointMake(on, NSMidY(track));
  CAKeyframeAnimation *slide = [CAKeyframeAnimation animationWithKeyPath:@"position.x"];
  slide.values = @[@(off), @(off), @(on), @(on)];
  for (CAKeyframeAnimation *move in @[fill, slide]) {
    move.keyTimes = @[@0, @0.35, @0.55, @1];
    move.duration = kBeatSeconds;
    move.repeatCount = kBeats;
  }
  [ground addAnimation:fill forKey:@"on"];
  [knob addAnimation:slide forKey:@"on"];
  [ground addSublayer:knob];
  return ground;
}

- (CALayer *)turningAt:(NSPoint)at {
  CAShapeLayer *round = [CAShapeLayer layer];
  round.path = cgPath(restartPath());
  round.position = at;
  round.fillColor = NSColor.clearColor.CGColor;
  round.strokeColor = accent().CGColor;
  round.lineWidth = kLine;
  round.lineCap = kCALineCapRound;
  CABasicAnimation *turn = [CABasicAnimation animationWithKeyPath:@"transform.rotation.z"];
  turn.byValue = @(2 * M_PI);
  turn.duration = kBeatSeconds;
  turn.repeatCount = kBeats;
  turn.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
  [round addAnimation:turn forKey:@"turn"];
  return round;
}

/// A few beats as a step arrives, and then it rests, as nothing moves at rest.
- (void)startMoving {
  if (_moving || !self.window || !MVMoves()) return;
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    CALayer *all = [CALayer layer];
    all.frame = self.bounds;
    if (!NSEqualPoints(self->_tapAt, NSZeroPoint)) [all addSublayer:[self ringAt:self->_tapAt]];
    if (!NSIsEmptyRect(self->_track)) [all addSublayer:[self switchIn:self->_track]];
    if (!NSEqualPoints(self->_restartAt, NSZeroPoint)) [all addSublayer:[self turningAt:self->_restartAt]];
    [self.layer addSublayer:all];
    self->_moving = all;
  }];
}

@end
