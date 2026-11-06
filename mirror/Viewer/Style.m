// Words and controls of the hub's panes, at Apple's macOS sizes. Nothing here is vibrant: the window is usually behind the
// one a person types in, and what is read in it stays as strong there as in front.
#import "Window.h"
#import "Words.h"

// the Inspector's width, less what it leaves at its sides
static const double kPaneWordsWide = 288;
// a spring settles in about 1.5 times its perceptual length, and it is the settling that the ceiling of 300 ms is about
static const double kPulseSeconds = 0.16, kPulseBounce = 0.2;

@interface MVLabel : NSTextField
@end

@implementation MVLabel
- (BOOL)allowsVibrancy {
  return NO;
}

/// Words are put in the Mac's language here, where every word on a pane passes, whoever said it.
- (void)setStringValue:(NSString *)value {
  [super setStringValue:MVWord(value)];
}
@end

@implementation MVBarButton
- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}

- (BOOL)allowsVibrancy {
  return NO;
}
@end

NSColor *MVSolid(NSColor *color) {
  return [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *look) {
    __block NSColor *solid;
    [look performAsCurrentDrawingAppearance:^{
      solid = [color colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
    }];
    return solid;
  }];
}

static void dress(NSTextField *field, MVStyle style) {
  const struct {
    CGFloat size;
    NSFontWeight weight;
    BOOL quiet;
  } kStyles[] = {
      [MVStyleHero] = {22, NSFontWeightSemibold, NO},
      [MVStyleTitle] = {15, NSFontWeightSemibold, NO},
      [MVStyleBody] = {13, NSFontWeightRegular, NO},
      [MVStyleStrong] = {13, NSFontWeightSemibold, NO},
      [MVStyleCallout] = {12, NSFontWeightRegular, NO},
      [MVStyleHeading] = {12, NSFontWeightSemibold, YES},
      [MVStyleSub] = {11, NSFontWeightRegular, YES},
  };
  field.font = [NSFont systemFontOfSize:kStyles[style].size weight:kStyles[style].weight];
  field.textColor = kStyles[style].quiet ? MVQuietColor() : MVInkColor();
}

NSTextField *MVText(NSString *text, MVStyle style) {
  NSTextField *field = [MVLabel labelWithString:MVWord(text)];
  field.lineBreakMode = NSLineBreakByTruncatingTail;
  dress(field, style);
  return field;
}

NSTextField *MVWrappedText(NSString *text, MVStyle style) {
  NSTextField *field = [MVLabel wrappingLabelWithString:MVWord(text)];
  field.selectable = NO;
  field.maximumNumberOfLines = 3;
  field.lineBreakMode = NSLineBreakByWordWrapping;
  field.preferredMaxLayoutWidth = kPaneWordsWide;
  dress(field, style);
  return field;
}

NSImage *_Nullable MVSymbol(NSString *name, NSColor *color, CGFloat size, NSFontWeight weight) {
  NSImage *found = [NSImage imageWithSystemSymbolName:name accessibilityDescription:nil];
  // what a Mac below 14 has in its place: a tile or a state with nothing on it says nothing
  if (!found) found = [NSImage imageWithSystemSymbolName:@{@"cable.connector.slash": @"cable.connector", @"gauge.with.dots.needle.33percent": @"gauge.medium"}[name] ?: name accessibilityDescription:nil];
  NSImage *shape = [found imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:size weight:weight]];
  if (!shape) return nil;
  NSColor *ink = MVSolid(color);
  return [NSImage imageWithSize:shape.size flipped:NO drawingHandler:^BOOL(NSRect rect) {
    [shape drawInRect:rect];
    [ink set];
    NSRectFillUsingOperation(rect, NSCompositingOperationSourceIn);
    return YES;
  }];
}

@implementation MVInk {
  NSImage *_image;
}

- (instancetype)initWithSymbol:(NSString *)symbol color:(NSColor *)color size:(CGFloat)size {
  if ((self = [super initWithFrame:NSZeroRect])) {
    _size = size;
    [self paint:symbol color:color];
  }
  return self;
}

- (void)paint:(NSString *)symbol color:(NSColor *)color {
  _image = MVSymbol(symbol, color, self.size, NSFontWeightRegular);
  [self invalidateIntrinsicContentSize];
  self.needsDisplay = YES;
}

- (NSSize)intrinsicContentSize {
  return _image.size;
}

- (BOOL)allowsVibrancy {
  return NO;
}

/// A click on it is the button's it stands on.
- (NSView *)hitTest:(NSPoint)point {
  return nil;
}

- (void)drawRect:(NSRect)dirty {
  NSSize shown = _image.size;
  [_image drawInRect:NSMakeRect((self.bounds.size.width - shown.width) / 2, (self.bounds.size.height - shown.height) / 2, shown.width, shown.height)];
}
@end

NSString *MVNeedSymbol(NSString *_Nullable need) {
  NSDictionary *symbols = @{@"locked": @"lock.fill", @"asleep": @"moon.zzz.fill", @"not-connected": @"cable.connector.slash", @"not-trusted": @"hand.raised.fill"};
  return symbols[need ?: @""] ?: @"exclamationmark.triangle.fill";
}

void MVAnnounce(NSString *words) {
  NSAccessibilityPostNotificationWithUserInfo(NSApp, NSAccessibilityAnnouncementRequestedNotification, @{NSAccessibilityAnnouncementKey: MVWord(words), NSAccessibilityPriorityKey: @(NSAccessibilityPriorityHigh)});
}

CABasicAnimation *MVSpring(NSString *keyPath, double seconds, double bounce) {
  if (@available(macOS 14, *)) {
    CASpringAnimation *spring = [[CASpringAnimation alloc] initWithPerceptualDuration:seconds bounce:bounce];
    spring.keyPath = keyPath;
    spring.duration = spring.settlingDuration;
    return spring;
  }
  CABasicAnimation *eased = [CABasicAnimation animationWithKeyPath:keyPath];
  eased.duration = seconds;
  eased.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
  return eased;
}

void MVPulse(NSView *view) {
  if (!MVMoves()) return;
  view.wantsLayer = YES;
  CABasicAnimation *pulse = MVSpring(@"transform.scale", kPulseSeconds, kPulseBounce);
  pulse.fromValue = @1.02;
  pulse.toValue = @1;
  [view.layer addAnimation:pulse forKey:@"pulse"];
}

static BOOL gHeldStill;

void MVHoldStill(BOOL held) {
  gHeldStill = held;
}

BOOL MVMoves(void) {
  return !gHeldStill && !NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
}

void MVFade(CALayer *layer, double from, double to, double seconds) {
  if (MVMoves()) {
    CABasicAnimation *fade = [CABasicAnimation animationWithKeyPath:@"opacity"];
    fade.fromValue = @(from);
    fade.toValue = @(to);
    fade.duration = seconds;
    fade.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
    [layer addAnimation:fade forKey:@"fade"];
  }
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  layer.opacity = to;
  [CATransaction commit];
}
