// What gives a place its depth: the one button in colour, a tinted tile for each part of a page, the wash behind a picture
// and the way a new step arrives. A colour here is drawn, as AppKit greys a bezel in a window behind others, which this
// window usually is.
#import "Place.h"

static const double kWordsHold = 4.5, kSymbolHolds = 3, kDarkenBy = 0.95, kPressedBy = 0.14, kButtonRound = 7, kDisabledAlpha = 0.45;
static const double kTileRound = 6, kWashAlpha = 0.1, kWashRound = 8;
static const double kSlideSeconds = 0.3, kFadeSeconds = 0.2;

static double channel(double value) {
  return value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4);
}

static double againstWhite(NSColor *color) {
  double light = 0.2126 * channel(color.redComponent) + 0.7152 * channel(color.greenComponent) + 0.0722 * channel(color.blueComponent);
  return 1.05 / (light + 0.05);
}

/// Darkened only as far as white on it needs: any accent a person chose keeps its hue. In sRGB throughout: a blended colour
/// comes back in Generic RGB, whose numbers this sum would read as better than they look.
static NSColor *holding(NSColor *color, double ratio) {
  NSColor *fill = [MVSolid(color) colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  for (int step = 0; step < 16 && againstWhite(fill) < ratio; step++) fill = [NSColor colorWithSRGBRed:fill.redComponent * kDarkenBy green:fill.greenComponent * kDarkenBy blue:fill.blueComponent * kDarkenBy alpha:1];
  return fill;
}

NSColor *MVFillFor(NSColor *color) {
  return holding(color, kWordsHold);
}

@implementation MVAccentButton

- (void)setQuiet:(BOOL)quiet {
  _quiet = quiet;
  self.needsDisplay = YES;
}

- (void)setEnabled:(BOOL)enabled {
  super.enabled = enabled;
  self.needsDisplay = YES;
}

- (void)drawRect:(NSRect)dirty {
  if (_quiet) return [super drawRect:dirty];
  NSColor *fill = MVFillFor(self.hasDestructiveAction ? NSColor.systemRedColor : NSColor.controlAccentColor);
  if (self.isHighlighted) fill = [fill blendedColorWithFraction:kPressedBy ofColor:NSColor.blackColor];
  if (!self.enabled) fill = [fill colorWithAlphaComponent:kDisabledAlpha];
  [fill setFill];
  NSRect shape = NSInsetRect(self.bounds, 1, (NSHeight(self.bounds) - self.intrinsicContentSize.height) / 2 + 1);
  [[NSBezierPath bezierPathWithRoundedRect:shape xRadius:kButtonRound yRadius:kButtonRound] fill];
  NSDictionary *look = @{NSFontAttributeName: [NSFont systemFontOfSize:NSFont.systemFontSize weight:NSFontWeightSemibold], NSForegroundColorAttributeName: NSColor.whiteColor};
  NSSize words = [self.title sizeWithAttributes:look];
  [self.title drawAtPoint:NSMakePoint(NSMidX(shape) - words.width / 2, NSMidY(shape) - words.height / 2) withAttributes:look];
}

@end

@interface MVTileView : NSView
@property(nonatomic, copy) NSString *symbol;
@property(nonatomic) NSColor *color;
@end

@implementation MVTileView
- (void)drawRect:(NSRect)dirty {
  // a symbol, which keeps more of its colour than words would
  [holding(self.color, kSymbolHolds) setFill];
  [[NSBezierPath bezierPathWithRoundedRect:self.bounds xRadius:kTileRound yRadius:kTileRound] fill];
  double side = NSWidth(self.bounds) * 0.62;
  NSImage *image = MVSymbol(self.symbol, NSColor.whiteColor, side, NSFontWeightSemibold);
  NSSize size = image.size;
  [image drawInRect:NSMakeRect(NSMidX(self.bounds) - size.width / 2, NSMidY(self.bounds) - size.height / 2, size.width, size.height)];
}

- (NSAccessibilityRole)accessibilityRole {
  return NSAccessibilityUnknownRole;
}
@end

NSView *MVTile(NSString *symbol, NSColor *color, CGFloat side) {
  MVTileView *tile = [MVTileView new];
  tile.symbol = symbol;
  tile.color = color;
  [tile.widthAnchor constraintEqualToConstant:side].active = YES;
  [tile.heightAnchor constraintEqualToConstant:side].active = YES;
  return tile;
}

@interface MVWashView : NSView
@end

@implementation MVWashView
- (BOOL)wantsUpdateLayer {
  return YES;
}

- (void)updateLayer {
  self.layer.backgroundColor = [MVSolid(NSColor.controlAccentColor) colorWithAlphaComponent:kWashAlpha].CGColor;
}
@end

NSView *MVWash(void) {
  NSView *wash = [MVWashView new];
  wash.wantsLayer = YES;
  wash.layer.cornerRadius = kWashRound;
  wash.layer.cornerCurve = kCACornerCurveContinuous;
  return wash;
}

void MVSlideIn(NSView *view, double from) {
  view.wantsLayer = YES;
  MVFade(view.layer, 0, 1, kFadeSeconds);
  if (!MVMoves()) return;
  CASpringAnimation *slide = [[CASpringAnimation alloc] initWithPerceptualDuration:kSlideSeconds bounce:0];
  slide.keyPath = @"transform.translation.x";
  slide.fromValue = @(from);
  slide.toValue = @0;
  slide.duration = slide.settlingDuration;
  [view.layer addAnimation:slide forKey:@"slide"];
}
