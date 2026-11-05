// Words and controls of the hub's panes, at Apple's macOS sizes. Nothing here is vibrant: the window is usually behind the
// one a person types in, and what is read in it stays as strong there as in front.
#import "Window.h"
#import "Words.h"

// the Inspector's width, less what it leaves at its sides
static const double kPaneWordsWide = 288;

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

static NSColor *byLook(NSColor *dark, NSColor *light) {
  return [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *look) {
    return [[look bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]] isEqual:NSAppearanceNameDarkAqua] ? dark : light;
  }];
}

NSColor *MVQuietColor(void) {
  return byLook([NSColor colorWithWhite:1 alpha:0.76], [NSColor colorWithWhite:0 alpha:0.7]);
}

// the system's green and orange reach only 2:1 on light glass
NSColor *MVGreen(void) {
  return byLook(NSColor.systemGreenColor, [NSColor colorWithSRGBRed:0.09 green:0.5 blue:0.22 alpha:1]);
}

NSColor *MVOrange(void) {
  return byLook(NSColor.systemOrangeColor, [NSColor colorWithSRGBRed:0.72 green:0.36 blue:0 alpha:1]);
}

static void dress(NSTextField *field, MVStyle style) {
  const struct {
    CGFloat size;
    NSFontWeight weight;
    BOOL quiet;
  } kStyles[] = {
      [MVStyleTitle] = {15, NSFontWeightSemibold, NO},
      [MVStyleBody] = {13, NSFontWeightRegular, NO},
      [MVStyleStrong] = {13, NSFontWeightSemibold, NO},
      [MVStyleCallout] = {12, NSFontWeightRegular, NO},
      [MVStyleHeading] = {12, NSFontWeightSemibold, YES},
      [MVStyleSub] = {11, NSFontWeightRegular, YES},
  };
  field.font = [NSFont systemFontOfSize:kStyles[style].size weight:kStyles[style].weight];
  field.textColor = kStyles[style].quiet ? MVQuietColor() : MVSolid(NSColor.labelColor);
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
  NSImage *shape = [[NSImage imageWithSystemSymbolName:name accessibilityDescription:nil] imageWithSymbolConfiguration:[NSImageSymbolConfiguration configurationWithPointSize:size weight:weight]];
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

BOOL MVMoves(void) {
  return !NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
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
