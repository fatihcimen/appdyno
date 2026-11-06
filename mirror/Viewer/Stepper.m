// A list that ticks itself: what is done, what is now and what is later, on one line. It stands for the phone's steps and for
// Get Started alike, and it reads as a path to follow, not as a form to fill in.
#import "Place.h"

static const double kRowHigh = 36, kMarkWide = 24, kRadius = 10, kLine = 2;
static const double kPulseSeconds = 1.4, kPulses = 3, kPulseGrows = 1.7;

@interface MVStepMark : NSView
@property(nonatomic, copy) NSString *state;
@property(nonatomic) NSUInteger number;
@property(nonatomic) BOOL joinsUp, joinsDown;
@end

@implementation MVStepMark {
  CAShapeLayer *_pulse;
}

- (NSRect)circle {
  return NSMakeRect(NSMidX(self.bounds) - kRadius, NSMidY(self.bounds) - kRadius, 2 * kRadius, 2 * kRadius);
}

- (void)drawJoints {
  [[MVQuietColor() colorWithAlphaComponent:0.5] setStroke];
  NSRect circle = self.circle;
  double x = NSMidX(self.bounds);
  NSBezierPath *line = [NSBezierPath bezierPath];
  line.lineWidth = kLine;
  if (self.joinsUp) {
    [line moveToPoint:NSMakePoint(x, NSMaxY(circle) + 3)];
    [line lineToPoint:NSMakePoint(x, NSMaxY(self.bounds))];
  }
  if (self.joinsDown) {
    [line moveToPoint:NSMakePoint(x, NSMinY(self.bounds))];
    [line lineToPoint:NSMakePoint(x, NSMinY(circle) - 3)];
  }
  [line stroke];
}

- (void)drawRect:(NSRect)dirty {
  [self drawJoints];
  NSRect circle = self.circle;
  if ([self.state isEqual:@"done"]) {
    [MVFillFor(MVGreen()) setFill];
    [[NSBezierPath bezierPathWithOvalInRect:circle] fill];
    NSBezierPath *tick = [NSBezierPath bezierPath];
    NSPoint at = NSMakePoint(NSMidX(circle), NSMidY(circle));
    [tick moveToPoint:NSMakePoint(at.x - 5, at.y)];
    [tick lineToPoint:NSMakePoint(at.x - 1.5, at.y - 4)];
    [tick lineToPoint:NSMakePoint(at.x + 5.5, at.y + 4)];
    tick.lineWidth = 2;
    tick.lineCapStyle = NSLineCapStyleRound;
    tick.lineJoinStyle = NSLineJoinStyleRound;
    [NSColor.whiteColor setStroke];
    [tick stroke];
  } else if ([self.state isEqual:@"now"]) {
    NSBezierPath *ring = [NSBezierPath bezierPathWithOvalInRect:NSInsetRect(circle, 1, 1)];
    ring.lineWidth = kLine;
    [MVAccent() setStroke];
    [ring stroke];
    [MVAccent() setFill];
    [[NSBezierPath bezierPathWithOvalInRect:NSInsetRect(circle, 6, 6)] fill];
  } else {
    NSString *number = [NSString stringWithFormat:@"%lu", (unsigned long)self.number];
    NSDictionary *look = @{NSFontAttributeName: [NSFont monospacedDigitSystemFontOfSize:12 weight:NSFontWeightMedium], NSForegroundColorAttributeName: MVQuietColor()};
    NSSize size = [number sizeWithAttributes:look];
    [number drawAtPoint:NSMakePoint(NSMidX(circle) - size.width / 2, NSMidY(circle) - size.height / 2) withAttributes:look];
  }
}

/// Only when it becomes the step, and only for a few beats: nothing moves at rest.
- (void)pulse {
  if (!MVMoves() || _pulse) return;
  self.wantsLayer = YES;
  _pulse = [CAShapeLayer layer];
  CGPathRef path = CGPathCreateWithEllipseInRect(CGRectMake(0, 0, 2 * kRadius, 2 * kRadius), NULL);
  _pulse.path = path;
  CGPathRelease(path);
  _pulse.bounds = CGRectMake(0, 0, 2 * kRadius, 2 * kRadius);
  _pulse.position = CGPointMake(NSMidX(self.bounds), NSMidY(self.bounds));
  _pulse.fillColor = NSColor.clearColor.CGColor;
  _pulse.strokeColor = MVAccent().CGColor;
  _pulse.lineWidth = kLine;
  _pulse.opacity = 0;
  [self.layer addSublayer:_pulse];
  CABasicAnimation *grow = [CABasicAnimation animationWithKeyPath:@"transform.scale"];
  grow.fromValue = @1;
  grow.toValue = @(kPulseGrows);
  CABasicAnimation *fade = [CABasicAnimation animationWithKeyPath:@"opacity"];
  fade.fromValue = @0.8;
  fade.toValue = @0;
  CAAnimationGroup *beat = [CAAnimationGroup animation];
  beat.animations = @[grow, fade];
  beat.duration = kPulseSeconds;
  beat.repeatCount = kPulses;
  beat.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
  [_pulse addAnimation:beat forKey:@"pulse"];
}

- (void)layout {
  [super layout];
  if ([self.state isEqual:@"now"]) [self pulse];
}

@end

@implementation MVStepper {
  NSString *_drawn;
  NSString *_now;
}

- (void)showItems:(NSArray<NSDictionary *> *)items {
  NSMutableArray<NSString *> *key = [NSMutableArray array];
  for (NSDictionary *item in items) [key addObject:[NSString stringWithFormat:@"%@=%@", item[@"title"], item[@"state"]]];
  NSString *drawn = [key componentsJoinedByString:@"|"];
  // a look at a phone that changed nothing changes nothing, a pulse least of all
  if ([drawn isEqual:_drawn]) return;
  _drawn = drawn;
  for (NSView *view in self.arrangedSubviews) [view removeFromSuperview];
  [items enumerateObjectsUsingBlock:^(NSDictionary *item, NSUInteger at, BOOL *stop) {
    MVStepMark *mark = [MVStepMark new];
    mark.state = item[@"state"];
    mark.number = at + 1;
    mark.joinsUp = at > 0;
    mark.joinsDown = at + 1 < items.count;
    [mark.widthAnchor constraintEqualToConstant:kMarkWide].active = YES;
    [mark.heightAnchor constraintEqualToConstant:kRowHigh].active = YES;
    BOOL now = [item[@"state"] isEqual:@"now"], later = [item[@"state"] isEqual:@"later"];
    NSTextField *words = MVText(item[@"title"], now ? MVStyleStrong : MVStyleBody);
    if (later) words.textColor = MVQuietColor();
    NSStackView *line = [NSStackView stackViewWithViews:@[mark, words]];
    line.spacing = 8;
    NSView *row = MVPlaceRow(line, item[@"end"] ? @[item[@"end"]] : @[]);
    [self addArrangedSubview:row];
    [row.widthAnchor constraintEqualToAnchor:self.widthAnchor].active = YES;
  }];
}

@end

MVStepper *MVNewStepper(void) {
  MVStepper *stepper = [MVStepper new];
  stepper.orientation = NSUserInterfaceLayoutOrientationVertical;
  stepper.alignment = NSLayoutAttributeLeading;
  stepper.spacing = 0;
  return stepper;
}
