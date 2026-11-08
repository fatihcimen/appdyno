// The device around the picture, drawn once per size: a still window costs nothing for having a frame. Its
// keys are views, so that each is hit, hovered, named and pressed as a control is.
#import "Frame.h"
#import "Window.h"

// an agent coming and going: its ring is a state, and says so without a jump
static const double kRingSeconds = 0.24;

// a held side button is the assistant, as on the device
static const double kHoldSeconds = 0.7;
static const double kPressedAlpha = 0.55;

static NSColor *rgb(uint32_t c, double brightness) {
  double k = brightness;
  return [NSColor colorWithSRGBRed:MIN(1, ((c >> 16) & 255) / 255.0 * k) green:MIN(1, ((c >> 8) & 255) / 255.0 * k) blue:MIN(1, (c & 255) / 255.0 * k) alpha:1];
}

static void fillMetal(CGContextRef c, CGRect rect, uint32_t color, BOOL across) {
  NSGradient *metal = [[NSGradient alloc] initWithColorsAndLocations:rgb(color, 1.75), 0.0, rgb(color, 1.05), 0.16, rgb(color, 0.82), 0.52, rgb(color, 1.0), 0.84, rgb(color, 1.5), 1.0, nil];
  [metal drawInRect:rect angle:across ? 58 : 118];
}

@interface MVFrameKeyView : NSView
@property(nonatomic, copy, nullable) NSString *name;
@property(nonatomic) uint32_t color;
@property(nonatomic) BOOL round;
@property(nonatomic, weak) MVFrameView *owner;
@end

@implementation MVFrameKeyView {
  BOOL _pressed, _over;
  NSTimeInterval _downAt;
}

- (BOOL)isFlipped {
  return YES;
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}

- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  for (NSTrackingArea *old in self.trackingAreas) [self removeTrackingArea:old];
  [self addTrackingArea:[[NSTrackingArea alloc] initWithRect:NSZeroRect options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect owner:self userInfo:nil]];
}

- (void)mouseEntered:(NSEvent *)event {
  _over = YES;
  self.needsDisplay = YES;
}

- (void)mouseExited:(NSEvent *)event {
  _over = NO;
  self.needsDisplay = YES;
}

- (void)mouseDown:(NSEvent *)event {
  _pressed = YES;
  _downAt = event.timestamp;
  self.needsDisplay = YES;
}

- (void)mouseUp:(NSEvent *)event {
  _pressed = NO;
  self.needsDisplay = YES;
  BOOL held = event.timestamp - _downAt >= kHoldSeconds;
  [self.owner press:[self.name isEqual:@"lock"] && held ? @"siri" : self.name];
}

- (void)drawRect:(NSRect)dirty {
  double r = self.round ? self.bounds.size.width / 2 : MIN(self.bounds.size.width, self.bounds.size.height) / 2;
  [NSGraphicsContext saveGraphicsState];
  [[NSBezierPath bezierPathWithRoundedRect:self.bounds xRadius:r yRadius:r] addClip];
  fillMetal(NSGraphicsContext.currentContext.CGContext, self.bounds, self.color, self.bounds.size.width < self.bounds.size.height);
  if (_over || _pressed) {
    [[NSColor colorWithWhite:_pressed ? 0 : 1 alpha:_pressed ? kPressedAlpha : 0.2] setFill];
    NSRectFillUsingOperation(self.bounds, NSCompositingOperationSourceOver);
  }
  [NSGraphicsContext restoreGraphicsState];
}

- (NSAccessibilityRole)accessibilityRole {
  return NSAccessibilityButtonRole;
}

- (BOOL)isAccessibilityElement {
  return YES;
}

- (BOOL)accessibilityPerformPress {
  [self.owner press:self.name];
  return YES;
}

@end

@implementation MVFrameView {
  MVFrameSpec _spec;
  MVFrameLayout _layout;
  int _turns;
  double _pad;
  NSMutableArray<MVFrameKeyView *> *_keys;
  CAShapeLayer *_ring;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    self.layerContentsRedrawPolicy = NSViewLayerContentsRedrawOnSetNeedsDisplay;
    self.layer.masksToBounds = NO;
    self.layer.shadowColor = NSColor.blackColor.CGColor;
    self.layer.shadowOpacity = 0.42;
    self.layer.shadowRadius = 22;
    self.layer.shadowOffset = CGSizeMake(0, -12);
    _keys = [NSMutableArray array];
    _ring = [CAShapeLayer layer];
    _ring.fillColor = NSColor.clearColor.CGColor;
    _ring.lineWidth = 2;
    _ring.hidden = YES;
    _ring.shadowOpacity = 0.6;
    _ring.shadowRadius = 6;
    _ring.shadowOffset = CGSizeZero;
    _ring.zPosition = 10;
    [self.layer addSublayer:_ring];
  }
  return self;
}

- (BOOL)isFlipped {
  return YES;
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}

- (void)press:(nullable NSString *)name {
  if (name) [self.screen pressButton:name];
}

- (CGSize)bodyFor:(CGSize)screen turns:(int)turns {
  if (!self.showsFrame) return screen;
  MVFrameLayout layout = MVLayOutFrame(self.spec, screen, turns);
  double pad = 4 * layout.unit;
  return CGSizeMake(layout.body.width + 2 * pad, layout.body.height + 2 * pad);
}

- (MVFrameSpec)spec {
  return _spec;
}

- (void)setSpec:(MVFrameSpec)spec {
  _spec = spec;
}

- (void)layOutScreen:(CGSize)screen in:(NSRect)place turns:(int)turns {
  _turns = turns;
  _layout = MVLayOutFrame(_spec, screen, turns);
  _pad = self.showsFrame ? 4 * _layout.unit : 0;
  self.frame = place;
  CGRect on = self.showsFrame ? CGRectOffset(_layout.screen, _pad, _pad) : CGRectMake(0, 0, screen.width, screen.height);
  self.screen.frame = on;
  self.screen.layer.cornerRadius = _layout.radius;
  self.screen.layer.masksToBounds = YES;
  for (MVFrameKeyView *key in _keys) [key removeFromSuperview];
  [_keys removeAllObjects];
  if (self.showsFrame) [self addKeys];
  self.layer.shadowOpacity = self.showsFrame ? 0.42 : 0.28;
  CGPathRef body = CGPathCreateWithRoundedRect(self.showsFrame ? CGRectOffset(CGRectMake(0, 0, _layout.body.width, _layout.body.height), _pad, _pad) : on, MIN(_layout.outer, _layout.body.width / 2 - 1), MIN(_layout.outer, _layout.body.height / 2 - 1), NULL);
  self.layer.shadowPath = body;
  CGPathRelease(body);
  // on the screen's corners, in the layer's flipped-up coordinates
  CGRect ringAt = CGRectMake(on.origin.x, place.size.height - CGRectGetMaxY(on), on.size.width, on.size.height);
  double r = MIN(_layout.radius, MIN(on.size.width, on.size.height) / 2 - 1);
  CGPathRef ring = CGPathCreateWithRoundedRect(ringAt, r, r, NULL);
  _ring.path = ring;
  CGPathRelease(ring);
  self.needsDisplay = YES;
}

- (void)addKeys {
  for (int i = 0; i < _spec.keyCount; i++) {
    MVFrameKey key = _spec.keys[i];
    [self addKey:key.name ? @(key.name) : nil at:CGRectOffset(MVFrameKeyRect(_spec, _layout, key, _turns), _pad, _pad) round:NO];
  }
  if (_spec.cutout != MVCutoutHomeButton) return;
  double across = 52 * _layout.unit;
  CGRect screen = _layout.screen;
  BOOL sideways = _layout.body.width > _layout.body.height;
  CGRect place = sideways
                     ? CGRectMake(CGRectGetMaxX(screen) + (_layout.body.width - CGRectGetMaxX(screen) - across) / 2 - 2 * _layout.unit, CGRectGetMidY(screen) - across / 2, across, across)
                     : CGRectMake(CGRectGetMidX(screen) - across / 2, CGRectGetMaxY(screen) + (_layout.body.height - CGRectGetMaxY(screen) - across) / 2 - 2 * _layout.unit, across, across);
  [self addKey:@"home" at:CGRectOffset(place, _pad, _pad) round:YES];
}

- (void)addKey:(nullable NSString *)name at:(CGRect)place round:(BOOL)round {
  MVFrameKeyView *view = [[MVFrameKeyView alloc] initWithFrame:place];
  view.name = name;
  view.color = _spec.color;
  view.round = round;
  view.owner = self;
  view.toolTip = name ? MVControlTitle(name) : nil;
  view.accessibilityLabel = name ? MVControlTitle(name) : nil;
  [_keys addObject:view];
  // beneath the picture: the body's edge covers the key's inner half
  [self addSubview:view positioned:NSWindowBelow relativeTo:self.screen];
}

- (void)setEdge:(NSColor *)color {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  BOOL was = !_ring.hidden && _ring.opacity > 0;
  if (color) {
    _ring.strokeColor = color.CGColor;
    _ring.shadowColor = color.CGColor;
    _ring.hidden = NO;
  }
  [CATransaction commit];
  if (was != (color != nil)) MVFade(_ring, was ? 1 : 0, color ? 1 : 0, kRingSeconds);
}

- (void)drawRect:(NSRect)dirty {
  if (!self.showsFrame) return;
  CGContextRef c = NSGraphicsContext.currentContext.CGContext;
  CGRect body = CGRectOffset(CGRectMake(0, 0, _layout.body.width, _layout.body.height), _pad, _pad);
  double outer = MIN(_layout.outer, MIN(body.size.width, body.size.height) / 2 - 1);
  double rim = _spec.rim * _layout.unit;
  NSBezierPath *shell = [NSBezierPath bezierPathWithRoundedRect:body xRadius:outer yRadius:outer];
  [NSGraphicsContext saveGraphicsState];
  [shell addClip];
  fillMetal(c, body, _spec.color, NO);
  [NSGraphicsContext restoreGraphicsState];
  // the lit edge of the band, inside and out
  [[NSColor colorWithWhite:1 alpha:0.28] setStroke];
  NSBezierPath *edge = [NSBezierPath bezierPathWithRoundedRect:CGRectInset(body, 0.75, 0.75) xRadius:outer - 0.75 yRadius:outer - 0.75];
  edge.lineWidth = 0.75;
  [edge stroke];
  CGRect glass = CGRectInset(body, rim, rim);
  double inner = MAX(outer - rim, 1);
  [[NSColor colorWithWhite:0.02 alpha:1] setFill];
  [[NSBezierPath bezierPathWithRoundedRect:glass xRadius:inner yRadius:inner] fill];
  [[NSColor colorWithWhite:1 alpha:0.07] setStroke];
  NSBezierPath *lip = [NSBezierPath bezierPathWithRoundedRect:CGRectInset(glass, 0.5, 0.5) xRadius:inner - 0.5 yRadius:inner - 0.5];
  lip.lineWidth = 0.5;
  [lip stroke];
  if (_spec.cutout == MVCutoutHomeButton) [self drawSpeaker:CGRectOffset(_layout.screen, _pad, _pad)];
}

- (void)drawSpeaker:(CGRect)screen {
  double unit = _layout.unit;
  BOOL sideways = _layout.body.width > _layout.body.height;
  CGRect slit = sideways ? CGRectMake(screen.origin.x - 36 * unit, CGRectGetMidY(screen) - 24 * unit, 5 * unit, 48 * unit)
                         : CGRectMake(CGRectGetMidX(screen) - 24 * unit, screen.origin.y - 36 * unit, 48 * unit, 5 * unit);
  [[NSColor colorWithWhite:0.16 alpha:1] setFill];
  [[NSBezierPath bezierPathWithRoundedRect:slit xRadius:2.5 * unit yRadius:2.5 * unit] fill];
}

- (void)mouseDown:(NSEvent *)event {
  [self.screen mouseDown:event];
}

- (void)mouseDragged:(NSEvent *)event {
  [self.screen mouseDragged:event];
}

- (void)mouseUp:(NSEvent *)event {
  [self.screen mouseUp:event];
}

- (NSMenu *)menuForEvent:(NSEvent *)event {
  return [self.screen deviceMenu];
}

@end
