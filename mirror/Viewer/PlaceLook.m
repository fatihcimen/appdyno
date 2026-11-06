// What gives a place its depth: capsules that keep their colour, a tile for each part of a page, the gradient behind a picture
// and the way a new step arrives. A colour here is drawn, as AppKit greys a bezel in a window behind others, which this
// window usually is.
#import "Place.h"

static const double kWordsHold = 4.5, kSymbolHolds = 3, kDarkenBy = 0.95, kPressedBy = 0.14, kDisabledAlpha = 0.5;
static const double kButtonHigh = 28, kButtonWide = 14, kSoftAlpha = 0.14, kWordsLift = 0.5, kPlainAlpha = 0.09, kRimAlpha = 0.28;
static const double kTileRound = 0.28, kTileLift = 0.14, kWashRound = 12;
static const double kChipHigh = 22, kChipWide = 9, kChipAlpha = 0.14;
static const double kHeadTile = 44, kHeadGap = 14;
static const double kSlideSeconds = 0.3, kFadeSeconds = 0.2;

static double channel(double value) {
  return value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4);
}

static double againstWhite(NSColor *color) {
  double light = 0.2126 * channel(color.redComponent) + 0.7152 * channel(color.greenComponent) + 0.0722 * channel(color.blueComponent);
  return 1.05 / (light + 0.05);
}

/// Darkened only as far as white on it needs: its hue stays. In sRGB throughout: a blended colour comes back in Generic RGB,
/// whose numbers this sum would read as better than they look.
static NSColor *holding(NSColor *color, double ratio) {
  NSColor *fill = [MVSolid(color) colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  for (int step = 0; step < 24 && againstWhite(fill) < ratio; step++) fill = [NSColor colorWithSRGBRed:fill.redComponent * kDarkenBy green:fill.greenComponent * kDarkenBy blue:fill.blueComponent * kDarkenBy alpha:1];
  return fill;
}

NSColor *MVFillFor(NSColor *color) {
  return holding(color, kWordsHold);
}

static NSFont *buttonFont(void) {
  return [NSFont systemFontOfSize:NSFont.systemFontSize weight:NSFontWeightSemibold];
}

static void fillGradient(NSBezierPath *shape, NSColor *from, NSColor *to, double angle) {
  [[[NSGradient alloc] initWithStartingColor:from endingColor:to] drawInBezierPath:shape angle:angle];
}

@implementation MVAccentButton

- (void)setQuiet:(BOOL)quiet {
  _quiet = quiet;
  self.needsDisplay = YES;
}

- (void)setHue:(NSColor *)hue {
  _hue = hue;
  self.needsDisplay = YES;
}

- (void)setEnabled:(BOOL)enabled {
  super.enabled = enabled;
  self.needsDisplay = YES;
}

- (void)setTitle:(NSString *)title {
  super.title = title;
  [self invalidateIntrinsicContentSize];
}

- (NSSize)intrinsicContentSize {
  return NSMakeSize(ceil([self.title sizeWithAttributes:@{NSFontAttributeName: buttonFont()}].width) + 2 * kButtonWide, kButtonHigh);
}

- (NSColor *)wordsColor {
  if (!_quiet) return NSColor.whiteColor;
  return _hue ? [MVSolid(_hue) blendedColorWithFraction:kWordsLift ofColor:MVSolid(MVInkColor())] : MVInkColor();
}

- (void)fill:(NSBezierPath *)shape {
  if (self.hasDestructiveAction && !_quiet) {
    [MVFillFor(MVRed()) setFill];
    [shape fill];
  } else if (!_quiet) {
    fillGradient(shape, MVFillFor(MVFillFrom()), MVFillFor(MVFillTo()), 0);
  } else {
    [(_hue ? [_hue colorWithAlphaComponent:kSoftAlpha] : MVRule(kPlainAlpha)) setFill];
    [shape fill];
  }
}

- (void)drawRect:(NSRect)dirty {
  NSRect box = NSInsetRect(self.bounds, 0.5, MAX((NSHeight(self.bounds) - kButtonHigh) / 2, 0) + 0.5);
  NSBezierPath *shape = [NSBezierPath bezierPathWithRoundedRect:box xRadius:NSHeight(box) / 2 yRadius:NSHeight(box) / 2];
  [NSGraphicsContext saveGraphicsState];
  if (!self.enabled) CGContextSetAlpha(NSGraphicsContext.currentContext.CGContext, kDisabledAlpha);
  [self fill:shape];
  if (!_quiet) {
    [[NSColor colorWithWhite:1 alpha:kRimAlpha] setStroke];
    shape.lineWidth = 1;
    [shape stroke];
  }
  if (self.isHighlighted) {
    [[NSColor colorWithWhite:0 alpha:kPressedBy] setFill];
    [shape fill];
  }
  NSDictionary *look = @{NSFontAttributeName: buttonFont(), NSForegroundColorAttributeName: MVSolid(self.wordsColor)};
  NSSize words = [self.title sizeWithAttributes:look];
  [self.title drawAtPoint:NSMakePoint(NSMidX(box) - words.width / 2, NSMidY(box) - words.height / 2) withAttributes:look];
  [NSGraphicsContext restoreGraphicsState];
}

@end

@interface MVTileView : NSView
@property(nonatomic, copy) NSString *symbol, *letter;
@property(nonatomic) NSColor *color;
@end

@implementation MVTileView
- (void)drawRect:(NSRect)dirty {
  // the palette's own colour, held only as far as a white symbol needs
  NSColor *low = holding(self.color, kSymbolHolds);
  NSColor *high = [low blendedColorWithFraction:kTileLift ofColor:NSColor.whiteColor];
  double round = NSWidth(self.bounds) * kTileRound;
  fillGradient([NSBezierPath bezierPathWithRoundedRect:self.bounds xRadius:round yRadius:round], high, low, -90);
  [[NSColor colorWithWhite:1 alpha:kRimAlpha] setStroke];
  [[NSBezierPath bezierPathWithRoundedRect:NSInsetRect(self.bounds, 0.5, 0.5) xRadius:round - 0.5 yRadius:round - 0.5] stroke];
  double side = NSWidth(self.bounds) * 0.56;
  if (self.letter) {
    NSDictionary *look = @{NSFontAttributeName: MVRoundedFont(side, NSFontWeightBold), NSForegroundColorAttributeName: NSColor.whiteColor};
    NSSize size = [self.letter sizeWithAttributes:look];
    [self.letter drawAtPoint:NSMakePoint(NSMidX(self.bounds) - size.width / 2, NSMidY(self.bounds) - size.height / 2) withAttributes:look];
    return;
  }
  NSImage *image = MVSymbol(self.symbol, NSColor.whiteColor, side, NSFontWeightSemibold);
  NSSize size = image.size;
  [image drawInRect:NSMakeRect(NSMidX(self.bounds) - size.width / 2, NSMidY(self.bounds) - size.height / 2, size.width, size.height)];
}

- (NSAccessibilityRole)accessibilityRole {
  return NSAccessibilityUnknownRole;
}
@end

static MVTileView *newTile(NSColor *color, CGFloat side) {
  MVTileView *tile = [MVTileView new];
  tile.color = color;
  [tile.widthAnchor constraintEqualToConstant:side].active = YES;
  [tile.heightAnchor constraintEqualToConstant:side].active = YES;
  return tile;
}

NSView *MVTile(NSString *symbol, NSColor *color, CGFloat side) {
  MVTileView *tile = newTile(color, side);
  tile.symbol = symbol;
  return tile;
}

NSView *MVLetterTile(NSString *letter, NSColor *color, CGFloat side) {
  MVTileView *tile = newTile(color, side);
  tile.letter = letter;
  return tile;
}

@interface MVChipView : NSView
@property(nonatomic) NSColor *color;
@end

@implementation MVChipView
/// As wide as what it says: nothing beside it may stretch it.
- (NSSize)intrinsicContentSize {
  return NSMakeSize(self.subviews.firstObject.fittingSize.width + 2 * kChipWide, kChipHigh);
}

- (void)drawRect:(NSRect)dirty {
  double round = NSHeight(self.bounds) / 2;
  [[self.color colorWithAlphaComponent:kChipAlpha] setFill];
  [[NSBezierPath bezierPathWithRoundedRect:self.bounds xRadius:round yRadius:round] fill];
}
@end

NSView *MVChip(NSString *symbol, NSString *words, NSColor *color) {
  MVChipView *chip = [MVChipView new];
  chip.color = color;
  MVInk *mark = [[MVInk alloc] initWithSymbol:symbol color:color size:10];
  NSTextField *text = MVText(words, MVStyleSub);
  text.textColor = color;
  NSStackView *row = [NSStackView stackViewWithViews:@[mark, text]];
  row.spacing = 4;
  row.translatesAutoresizingMaskIntoConstraints = NO;
  [chip addSubview:row];
  [chip setContentHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
  [chip setContentCompressionResistancePriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
  [NSLayoutConstraint activateConstraints:@[
    [row.centerXAnchor constraintEqualToAnchor:chip.centerXAnchor],
    [row.centerYAnchor constraintEqualToAnchor:chip.centerYAnchor],
  ]];
  return chip;
}

void MVChipSay(NSView *chip, NSString *words) {
  for (NSView *part in ((NSStackView *)chip.subviews.firstObject).arrangedSubviews)
    if ([part isKindOfClass:NSTextField.class]) ((NSTextField *)part).stringValue = words;
  [chip invalidateIntrinsicContentSize];
}

@interface MVWashView : NSView
@end

@implementation MVWashView
- (void)drawRect:(NSRect)dirty {
  fillGradient([NSBezierPath bezierPathWithRoundedRect:self.bounds xRadius:kWashRound yRadius:kWashRound], MVFillFor(MVFillFrom()), MVFillFor(MVFillTo()), -60);
}
@end

NSView *MVWash(void) {
  return [MVWashView new];
}

NSView *MVPlaceHead(NSString *symbol, NSColor *color, NSString *title, NSString *sentence) {
  NSStackView *words = [NSStackView stackViewWithViews:@[MVText(title, MVStyleHero), MVParagraph(sentence, MVStyleBody)]];
  words.orientation = NSUserInterfaceLayoutOrientationVertical;
  words.alignment = NSLayoutAttributeLeading;
  words.spacing = 2;
  NSStackView *head = [NSStackView stackViewWithViews:@[MVTile(symbol, color, kHeadTile), words]];
  head.spacing = kHeadGap;
  return head;
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
